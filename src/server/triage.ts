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

export async function enqueueItem(input: EnqueueInput): Promise<TriageItem> {
  const base: TriageItem = {
    thingId: input.id,
    kind: input.kind,
    author: input.author,
    score: 0,
    bucket: 'normal',
    createdAt: input.createdAt,
    reasons: [],
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.reports === undefined ? {} : { reports: input.reports }),
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
  await storeItem(item);
  await recordRuleMatches(item.thingId, scored.matchedRuleIds, item.createdAt);
  return item;
}

export async function listBucket(
  bucket: TriageBucket,
  cursor?: string,
  limit = 25
): Promise<{ items: TriageItem[]; nextCursor?: string; total: number }> {
  const offset = cursor ? Math.max(0, Number(cursor)) : 0;
  const rows = await redis.zRange(redisKeys.triageBucket(bucket), 0, -1, {
    by: 'rank',
    reverse: true,
  });
  const slice = rows.slice(offset, offset + limit + 1);
  const items: TriageItem[] = [];
  for (const row of slice.slice(0, limit)) {
    const item = await getItem(row.member);
    if (item) {
      items.push(item);
    }
  }
  return {
    items,
    total: await redis.zCard(redisKeys.triageBucket(bucket)),
    ...(slice.length > limit ? { nextCursor: String(offset + limit) } : {}),
  };
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

