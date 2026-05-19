import { context, reddit, redis } from '@devvit/web/server';
import type { ModActionType } from '@devvit/reddit';
import { isT3, type T3 } from '@devvit/shared-types/tid.js';
import type { DomainEntry, InsightRange, ModlogEntry, ModlogInsights } from '../shared/types';
import { getDomain, recordDomainRemoved } from './domains';
import { once } from './idempotency';
import { decode, encode, memo, numberFrom } from './json';
import { normalizeHost, redisKeys } from './redisKeys';

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const hourKey = (date: Date) => date.toISOString().slice(0, 13);

const RANGE_DAYS: Record<InsightRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
const REMOVAL_ACTIONS = new Set(['removelink', 'spamlink']);
const REDDIT_HOSTS = new Set([
  'reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'www.reddit.com',
]);

export type ModActionLike = {
  id: string;
  type: ModActionType | string;
  moderatorName: string;
  createdAt: Date | string | number;
  target?:
    | {
        id?: string | undefined;
        author?: string | undefined;
        permalink?: string | undefined;
        title?: string | undefined;
      }
    | undefined;
  description?: string | undefined;
  details?: string | undefined;
};

function actionDate(action: ModActionLike): Date {
  return action.createdAt instanceof Date ? action.createdAt : new Date(action.createdAt);
}

function externalHost(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  const host = normalizeHost(rawUrl);
  return host && !REDDIT_HOSTS.has(host) ? host : undefined;
}

async function resolveExternalTargetUrl(action: ModActionLike): Promise<string | undefined> {
  const directHost = externalHost(action.target?.permalink);
  if (directHost) {
    return action.target?.permalink;
  }
  if (!REMOVAL_ACTIONS.has(String(action.type)) || !action.target?.id || !isT3(action.target.id)) {
    return undefined;
  }
  try {
    const post = await reddit.getPostById(action.target.id as T3);
    return externalHost(post.url) ? post.url : undefined;
  } catch {
    return undefined;
  }
}

function targetLabel(action: ModActionLike): string {
  return (
    action.target?.id ??
    action.target?.author ??
    action.target?.title ??
    action.target?.permalink ??
    action.description ??
    action.details ??
    String(action.type)
  );
}

function readModlogEntry(id: string): Promise<ModlogEntry | null> {
  return redis
    .hGet(redisKeys.modlogEntry(id), 'entry')
    .then((raw) => decode<ModlogEntry | null>(raw, null));
}

export async function recordModAction(action: ModActionLike): Promise<boolean> {
  if (await redis.hGet(redisKeys.modlogEntry(action.id), 'entry')) {
    return false;
  }
  const shouldCount = await once(`modlog:${action.id}`, 60 * 60 * 24);

  const createdAt = actionDate(action);
  const ts = createdAt.getTime();
  const externalUrl = await resolveExternalTargetUrl(action);
  const host = externalHost(externalUrl);
  const entry: ModlogEntry = {
    id: action.id,
    actor: action.moderatorName,
    action: String(action.type),
    target: targetLabel(action),
    ts,
    ...(action.target?.author ? { targetAuthor: action.target.author } : {}),
    ...(action.target?.id ? { targetId: action.target.id } : {}),
    ...(action.target?.permalink ? { targetPermalink: action.target.permalink } : {}),
    ...(host ? { targetHost: host } : {}),
    ...(action.description ? { description: action.description } : {}),
    ...(action.details ? { details: action.details } : {}),
  };

  await redis.hSet(redisKeys.modlogEntry(entry.id), { entry: encode(entry) });
  await redis.zAdd(redisKeys.modlogEntries(), { member: entry.id, score: ts });
  if (!shouldCount) {
    return false;
  }

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
    const permalinkHost = externalHost(action.target.permalink);
    if (permalinkHost) {
      await redis.zAdd(redisKeys.modlogByDomain(permalinkHost), { member: action.id, score: ts });
    }
  }
  if (host) {
    await redis.zAdd(redisKeys.modlogByDomain(host), { member: action.id, score: ts });
    if (REMOVAL_ACTIONS.has(String(action.type)) && externalUrl) {
      await recordDomainRemoved(externalUrl);
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

    const recentEntries = await collectEntriesSince(Date.now() - days * 86_400_000);
    const topRemovedDomains = await collectTopDomains(recentEntries, 10);
    const topTargetedUsers = collectTopUsers(recentEntries, 10);

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

async function collectEntriesSince(sinceMs: number): Promise<ModlogEntry[]> {
  const entries: ModlogEntry[] = [];
  const batchSize = 250;
  const scanLimit = 5_000;
  let offset = 0;

  while (offset < scanLimit) {
    const rows = await redis.zRange(redisKeys.modlogEntries(), offset, offset + batchSize - 1, {
      by: 'rank',
      reverse: true,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.score < sinceMs) {
        return entries;
      }
      const entry = await readModlogEntry(row.member);
      if (entry) entries.push(entry);
    }
    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  return entries;
}

async function collectTopDomains(entries: ModlogEntry[], limit: number): Promise<DomainEntry[]> {
  const counts = new Map<string, { count: number; lastSeenAt: number }>();
  for (const entry of entries) {
    if (!REMOVAL_ACTIONS.has(entry.action) || !entry.targetHost) continue;
    const current = counts.get(entry.targetHost);
    counts.set(entry.targetHost, {
      count: (current?.count ?? 0) + 1,
      lastSeenAt: Math.max(current?.lastSeenAt ?? 0, entry.ts),
    });
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].lastSeenAt - a[1].lastSeenAt)
    .slice(0, limit);

  const out: DomainEntry[] = [];
  for (const [host, data] of top) {
    const existing = await getDomain(host);
    out.push({
      ...existing,
      removedCount: data.count,
      lastSeenAt: data.lastSeenAt,
    });
  }
  return out;
}

function collectTopUsers(
  entries: ModlogEntry[],
  limit: number,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.targetAuthor) continue;
    counts.set(entry.targetAuthor, (counts.get(entry.targetAuthor) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
