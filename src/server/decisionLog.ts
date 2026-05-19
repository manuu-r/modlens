import { redis } from '@devvit/web/server';
import type {
  DecisionLogEntry,
  FactBag,
  JsonObject,
  MicroInsight,
  TriageBucket,
} from '../shared/types';
import { decode, encode } from './json';
import { redisKeys } from './redisKeys';

const DECISION_LOG_LIMIT = 200;

function factsToJson(facts: FactBag): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export async function recordDecision(input: {
  thingId: string;
  author: string;
  source: DecisionLogEntry['source'];
  scoreBefore: number;
  scoreAfter: number;
  bucketBefore: TriageBucket;
  bucketAfter: TriageBucket;
  matchedRuleIds: string[];
  reasons: string[];
  facts: FactBag;
  insight?: MicroInsight;
}): Promise<DecisionLogEntry> {
  const entry: DecisionLogEntry = {
    id: `decision_${crypto.randomUUID()}`,
    thingId: input.thingId,
    author: input.author,
    ts: Date.now(),
    source: input.source,
    scoreBefore: input.scoreBefore,
    scoreAfter: input.scoreAfter,
    bucketBefore: input.bucketBefore,
    bucketAfter: input.bucketAfter,
    matchedRuleIds: input.matchedRuleIds,
    reasons: input.reasons,
    facts: factsToJson(input.facts),
    ...(input.insight ? { insight: input.insight } : {}),
  };

  await redis.hSet(redisKeys.decisionLogEntry(entry.id), { entry: encode(entry) });
  await redis.zAdd(redisKeys.decisionLog(), { member: entry.id, score: entry.ts });

  const total = await redis.zCard(redisKeys.decisionLog());
  if (total > DECISION_LOG_LIMIT) {
    const overflow = total - DECISION_LOG_LIMIT;
    const oldest = await redis.zRange(redisKeys.decisionLog(), 0, overflow - 1, { by: 'rank' });
    if (oldest.length > 0) {
      const ids = oldest.map((row) => row.member);
      await redis.zRem(redisKeys.decisionLog(), ids);
      for (const id of ids) {
        await redis.del(redisKeys.decisionLogEntry(id));
      }
    }
  }

  return entry;
}

export async function listDecisions(limit = 50): Promise<DecisionLogEntry[]> {
  const rows = await redis.zRange(redisKeys.decisionLog(), 0, Math.max(limit - 1, 0), {
    by: 'rank',
    reverse: true,
  });
  const entries: DecisionLogEntry[] = [];
  for (const row of rows) {
    const raw = await redis.hGet(redisKeys.decisionLogEntry(row.member), 'entry');
    const entry = decode<DecisionLogEntry | null>(raw, null);
    if (entry) entries.push(entry);
  }
  return entries;
}
