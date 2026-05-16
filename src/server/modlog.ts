import { context, reddit, redis } from '@devvit/web/server';
import type { ModActionType } from '@devvit/reddit';
import type { DomainEntry, InsightRange, ModlogInsights } from '../shared/types';
import { getDomain } from './domains';
import { once } from './idempotency';
import { memo, numberFrom } from './json';
import { normalizeHost, redisKeys } from './redisKeys';

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const hourKey = (date: Date) => date.toISOString().slice(0, 13);

const RANGE_DAYS: Record<InsightRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

export type ModActionLike = {
  id: string;
  type: ModActionType | string;
  moderatorName: string;
  createdAt: Date | string | number;
  target?:
    | {
        author?: string | undefined;
        permalink?: string | undefined;
      }
    | undefined;
};

function actionDate(action: ModActionLike): Date {
  return action.createdAt instanceof Date ? action.createdAt : new Date(action.createdAt);
}

export async function recordModAction(action: ModActionLike): Promise<boolean> {
  if (!(await once(`modlog:${action.id}`, 60 * 60 * 24))) {
    return false;
  }

  const createdAt = actionDate(action);
  const ts = createdAt.getTime();
  await redis.hIncrBy(
    redisKeys.modlogDay(dayKey(createdAt)),
    `${action.moderatorName}:${action.type}`,
    1,
  );
  await redis.hIncrBy(redisKeys.modlogHour(hourKey(createdAt)), String(action.type), 1);
  if (action.target?.author) {
    await redis.zAdd(redisKeys.modlogByUser(action.target.author), {
      member: action.id,
      score: ts,
    });
    if (action.type === 'removelink' || action.type === 'spamlink' || action.type === 'removecomment') {
      await redis.hIncrBy(redisKeys.userSummary(action.target.author), 'removalCount', 1);
      if (action.type === 'spamlink') {
        await redis.hIncrBy(redisKeys.userSummary(action.target.author), 'spamCount', 1);
      }
      await redis.hSet(redisKeys.userSummary(action.target.author), {
        lastActionAt: String(ts),
      });
    }
  }
  if (action.target?.permalink) {
    const host = normalizeHost(action.target.permalink);
    if (host) {
      await redis.zAdd(redisKeys.modlogByDomain(host), { member: action.id, score: ts });
    }
  }
  return true;
}

export async function backfillChunk(
  cursor: string | null,
): Promise<{ nextCursor: string | null; processed: number }> {
  if (!context.subredditName) {
    return { nextCursor: null, processed: 0 };
  }
  const listing = reddit.getModerationLog({
    subredditName: context.subredditName,
    limit: 500,
    ...(cursor ? { after: cursor } : {}),
  });
  const actions = await listing.get(500);
  for (const action of actions) {
    await recordModAction(action);
  }
  const last = actions.at(-1);
  return {
    nextCursor: listing.hasMore && last ? last.id : null,
    processed: actions.length,
  };
}

function rangeHours(days: number): string[] {
  const hours: string[] = [];
  const now = new Date();
  const total = days * 24;
  for (let i = 0; i < total; i += 1) {
    const d = new Date(now.getTime() - i * 3_600_000);
    hours.push(hourKey(d));
  }
  return hours;
}

export async function buildInsights(range: InsightRange): Promise<ModlogInsights> {
  return memo<ModlogInsights>(`modlog:insights:${range}`, 60, async () => {
    const days = RANGE_DAYS[range];
      const dayKeys: string[] = [];
      const now = new Date();
      for (let i = 0; i < days; i += 1) {
        dayKeys.push(dayKey(new Date(now.getTime() - i * 86_400_000)));
      }

      const perModTotals: Record<string, number> = {};
      const actionHistogram: Record<string, number> = {};

      for (const day of dayKeys) {
        const entries = await redis.hGetAll(redisKeys.modlogDay(day));
        for (const [field, value] of Object.entries(entries)) {
          const count = numberFrom(value);
          const [mod, action] = field.split(':');
          if (mod) {
            perModTotals[mod] = (perModTotals[mod] ?? 0) + count;
          }
          if (action) {
            actionHistogram[action] = (actionHistogram[action] ?? 0) + count;
          }
        }
      }

      const hourOfWeek: number[][] = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => 0),
      );
      for (const hourLabel of rangeHours(Math.min(days, 14))) {
        const entries = await redis.hGetAll(redisKeys.modlogHour(hourLabel));
        if (Object.keys(entries).length === 0) continue;
        const total = Object.values(entries).reduce((acc, v) => acc + numberFrom(v), 0);
        const date = new Date(`${hourLabel}:00:00Z`);
        if (Number.isNaN(date.getTime())) continue;
        const dow = date.getUTCDay();
        const hr = date.getUTCHours();
        if (hourOfWeek[dow] && hourOfWeek[dow]![hr] !== undefined) {
          hourOfWeek[dow]![hr] = (hourOfWeek[dow]![hr] ?? 0) + total;
        }
      }

      const topRemovedDomains = await collectTopDomains(dayKeys.slice(0, days), 10);
      const topTargetedUsers = await collectTopUsers(perModTotals, dayKeys, 10);

    return {
      range,
      perModTotals,
      actionHistogram,
      hourOfWeek,
      topRemovedDomains,
      topTargetedUsers,
    };
  });
}

async function collectTopDomains(_dayKeys: string[], limit: number): Promise<DomainEntry[]> {
  // Top removed by querying domainsBySub for hosts, then filtering by removedCount.
  const rows = await redis.zRange(redisKeys.domainsBySub(), 0, 200, {
    by: 'rank',
    reverse: true,
  });
  const enriched: DomainEntry[] = [];
  for (const row of rows) {
    const entry = await getDomain(row.member);
    if (entry.removedCount > 0) {
      enriched.push(entry);
    }
  }
  enriched.sort((a, b) => b.removedCount - a.removedCount);
  return enriched.slice(0, limit);
}

async function collectTopUsers(
  _perModTotals: Record<string, number>,
  _dayKeys: string[],
  limit: number,
): Promise<Array<{ name: string; count: number }>> {
  // Without a global index of targeted users we approximate using userSummary
  // rows touched recently. Aggregate from modlog:byUser:* via the ModLens post's
  // top-removed users index we'd ideally maintain — until that exists we
  // build it from currently-known authors via the audit log targets.
  const recent = await redis.zRange(redisKeys.auditLog(), 0, 500, {
    by: 'rank',
    reverse: true,
  });
  const counts = new Map<string, number>();
  for (const row of recent) {
    const raw = await redis.hGet(redisKeys.auditEntry(row.member), 'entry');
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { target?: string; action?: string };
      if (!parsed.target) continue;
      if (!parsed.action || !parsed.action.startsWith('triage.')) continue;
      counts.set(parsed.target, (counts.get(parsed.target) ?? 0) + 1);
    } catch {
      // ignore
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
