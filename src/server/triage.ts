import { reddit, redis } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/shared-types/tid.js';
import type { ThingKind, TriageBucket, TriageDecision, TriageItem } from '../shared/types';
import { write as writeAudit } from './audit';
import { decode, encode } from './json';
import { redisKeys } from './redisKeys';
import { buildFacts, scoreFacts } from './rules';

export type EnqueueInput = {
  id: string;
  kind: ThingKind;
  author: string;
  createdAt: number;
  url?: string;
  title?: string;
  reports?: string[];
};

type BucketCursor = {
  score: number;
  member?: string;
};

type BucketRow = {
  member: string;
  score: number;
};

function encodeBucketCursor(row: BucketRow): string {
  return JSON.stringify({ score: row.score, member: row.member } satisfies Required<BucketCursor>);
}

function parseBucketCursor(cursor: string | undefined): BucketCursor | null {
  if (!cursor) return null;
  const numeric = Number(cursor);
  if (Number.isFinite(numeric)) {
    return { score: numeric };
  }
  try {
    const parsed = JSON.parse(cursor) as Partial<BucketCursor>;
    const score = parsed.score;
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return null;
    }
    return {
      score,
      ...(typeof parsed.member === 'string' ? { member: parsed.member } : {}),
    };
  } catch {
    return null;
  }
}

function isAfterCursor(row: BucketRow, cursor: BucketCursor | null): boolean {
  if (!cursor) return true;
  if (row.score < cursor.score) return true;
  if (row.score > cursor.score) return false;
  return cursor.member ? row.member < cursor.member : false;
}

async function storeItem(item: TriageItem): Promise<void> {
  await redis.hSet(redisKeys.triageItem(item.thingId), { item: encode(item) });
  await redis.zAdd(redisKeys.triageItems(), { member: item.thingId, score: item.score });
  await redis.zAdd(redisKeys.triageBucket(item.bucket), {
    member: item.thingId,
    score: item.createdAt,
  });
}

export async function getItem(thingId: string): Promise<TriageItem | null> {
  return decode<TriageItem | null>(await redis.hGet(redisKeys.triageItem(thingId), 'item'), null);
}

const RULE_MATCH_RING = 50;

async function recordRuleMatches(thingId: string, matchedRuleIds: string[], ts: number): Promise<void> {
  for (const ruleId of matchedRuleIds) {
    await redis.zAdd(redisKeys.ruleMatches(ruleId), { member: thingId, score: ts });
    const total = await redis.zCard(redisKeys.ruleMatches(ruleId));
    if (total > RULE_MATCH_RING) {
      const overflow = total - RULE_MATCH_RING;
      const oldest = await redis.zRange(redisKeys.ruleMatches(ruleId), 0, overflow - 1, { by: 'rank' });
      if (oldest.length > 0) {
        await redis.zRem(redisKeys.ruleMatches(ruleId), oldest.map((row) => row.member));
      }
    }
  }
}

export async function listBucket(
  bucket: TriageBucket,
  cursor?: string,
  limit = 25
): Promise<{ items: TriageItem[]; nextCursor?: string; total: number }> {
  const requestedLimit = Number.isFinite(limit) ? limit : 25;
  const pageSize = Math.min(Math.max(requestedLimit, 1), 100);
  const parsedCursor = parseBucketCursor(cursor);
  const items: TriageItem[] = [];
  const itemRows: BucketRow[] = [];
  let offset = 0;
  const batchSize = Math.max(pageSize + 1, 50);

  while (items.length < pageSize + 1) {
    const rows = await redis.zRange(
      redisKeys.triageBucket(bucket),
      offset,
      offset + batchSize - 1,
      {
        by: 'rank',
        reverse: true,
      },
    );
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      if (!isAfterCursor(row, parsedCursor)) {
        continue;
      }
      const item = await getItem(row.member);
      if (item) {
        items.push(item);
        itemRows.push(row);
        if (items.length >= pageSize + 1) {
          break;
        }
      }
    }

    offset += rows.length;
    if (rows.length < batchSize) {
      break;
    }
  }

  const pageItems = items.slice(0, pageSize);
  const lastRow = itemRows[Math.min(pageItems.length, itemRows.length) - 1];
  return {
    items: pageItems,
    total: await redis.zCard(redisKeys.triageBucket(bucket)),
    ...(items.length > pageSize && lastRow ? { nextCursor: encodeBucketCursor(lastRow) } : {}),
  };
}

function mergeReports(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (!existing?.length) return incoming?.length ? incoming : undefined;
  if (!incoming?.length) return existing;
  return incoming.length > existing.length ? incoming : existing;
}

export async function upsertScoredItem(input: EnqueueInput): Promise<TriageItem> {
  const existing = await getItem(input.id);
  const url = input.url ?? existing?.url;
  const title = input.title ?? existing?.title;
  const reports = mergeReports(existing?.reports, input.reports);
  const base: TriageItem = {
    thingId: input.id,
    kind: input.kind,
    author: input.author,
    score: 0,
    bucket: 'normal',
    createdAt: existing?.createdAt ?? input.createdAt,
    reasons: [],
    ...(url === undefined ? {} : { url }),
    ...(title === undefined ? {} : { title }),
    ...(reports === undefined ? {} : { reports }),
  };
  const facts = await buildFacts(base);
  const scored = await scoreFacts(facts);
  const item: TriageItem = {
    ...base,
    score: scored.score,
    bucket: scored.bucket,
    reasons: scored.reasons,
    ...(scored.reasonRefs.length > 0 ? { reasonRefs: scored.reasonRefs } : {}),
  };

  if (existing && existing.bucket !== item.bucket) {
    await redis.zRem(redisKeys.triageBucket(existing.bucket), [item.thingId]);
  }
  await storeItem(item);
  await recordRuleMatches(item.thingId, scored.matchedRuleIds, item.createdAt);
  return item;
}

export async function enqueueItem(input: EnqueueInput): Promise<TriageItem> {
  return upsertScoredItem(input);
}

export async function decideItem(
  thingId: string,
  action: TriageDecision,
  modName: string
): Promise<TriageItem | null> {
  const item = await getItem(thingId);
  if (!item) {
    return null;
  }

  if (action === 'approve') {
    await reddit.approve(thingId as T1 | T3);
  } else if (action === 'remove') {
    await reddit.remove(thingId as T1 | T3, false);
  }

  await redis.zRem(redisKeys.triageItems(), [thingId]);
  await redis.zRem(redisKeys.triageBucket(item.bucket), [thingId]);
  await redis.del(redisKeys.triageItem(thingId));
  await writeAudit({
    actor: modName,
    action: `triage.${action}`,
    target: thingId,
    before: item,
  });
  return item;
}

export async function rescoreTopN(n = 200): Promise<number> {
  const rows = await redis.zRange(redisKeys.triageItems(), 0, Math.max(n - 1, 0), {
    by: 'rank',
    reverse: true,
  });
  let changed = 0;
  for (const row of rows) {
    const item = await getItem(row.member);
    if (!item) {
      continue;
    }
    const facts = await buildFacts(item);
    const scored = await scoreFacts(facts);
    if (item.score !== scored.score || item.bucket !== scored.bucket) {
      await redis.zRem(redisKeys.triageBucket(item.bucket), [item.thingId]);
      await storeItem({
        ...item,
        score: scored.score,
        bucket: scored.bucket,
        reasons: scored.reasons,
        ...(scored.reasonRefs.length > 0 ? { reasonRefs: scored.reasonRefs } : {}),
      });
      await recordRuleMatches(item.thingId, scored.matchedRuleIds, item.createdAt);
      changed += 1;
    }
  }
  return changed;
}
