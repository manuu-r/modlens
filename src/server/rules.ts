import { context, redis } from '@devvit/web/server';
import type {
  Condition,
  FactBag,
  ReasonRef,
  RuleConfig,
  RuleDryRunResult,
  TriageBucket,
  TriageItem,
} from '../shared/types';
import type { DomainTag } from '../shared/tags';
import { isDomainTag } from '../shared/tags';
import { decode, encode, numberFrom } from './json';
import { isRedditHost, normalizeHost, redisKeys } from './redisKeys';

const bucketRank: Record<TriageBucket, number> = {
  normal: 0,
  aged: 1,
  high: 2,
};

export const defaultRules: RuleConfig[] = [
  {
    id: 'new_account',
    name: 'New account',
    priority: 10,
    when: { all: [{ fact: 'account.ageDays', op: '<', value: 30 }] },
    then: { scoreDelta: 20, reason: 'new account (<30d)' },
  },
  {
    id: 'prior_removals',
    name: 'Prior removals',
    priority: 20,
    when: { all: [{ fact: 'user.summary.removalCount', op: '>=', value: 3 }] },
    then: { scoreDelta: 35, bucket: 'high', reason: 'prior removals in this sub' },
  },
  {
    id: 'bad_domain',
    name: 'Bad site',
    priority: 30,
    when: { all: [{ fact: 'post.domain.tag', op: 'in', value: ['watchlist', 'spammy', 'scam'] }] },
    then: { scoreDelta: 30, bucket: 'high', reason: 'risky site tag' },
  },
  {
    id: 'repeat_reports',
    name: 'Repeat reports',
    priority: 40,
    when: { all: [{ fact: 'item.reports', op: '>=', value: 2 }] },
    then: { scoreDelta: 25, bucket: 'aged', reason: 'multiple reports' },
  },
  {
    id: 'edited_link_added',
    name: 'Edited link added',
    priority: 50,
    when: { all: [{ fact: 'item.editedLinkAdded', op: '==', value: true }] },
    then: { scoreDelta: 35, bucket: 'aged', reason: 'external link added in edit' },
  },
];

function factValue(facts: FactBag, path: string): unknown {
  return facts[path as keyof FactBag];
}

function compare(condition: Condition, actual: unknown): boolean {
  const expected = condition.value;
  switch (condition.op) {
    case '<':
      return Number(actual) < Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>=':
      return Number(actual) >= Number(expected);
    case '>':
      return Number(actual) > Number(expected);
    case 'in':
      return Array.isArray(expected) && actual != null && expected.includes(String(actual));
    case 'notIn':
      return Array.isArray(expected) && (actual == null || !expected.includes(String(actual)));
  }
}

function matches(rule: RuleConfig, facts: FactBag): boolean {
  const all = rule.when.all ?? [];
  const any = rule.when.any ?? [];
  const allMatch = all.every((condition) => compare(condition, factValue(facts, condition.fact)));
  const anyMatch =
    any.length === 0 || any.some((condition) => compare(condition, factValue(facts, condition.fact)));
  return allMatch && anyMatch;
}

export async function listRules(): Promise<RuleConfig[]> {
  const rows = await redis.zRange(redisKeys.rulesOrder(), 0, -1, { by: 'rank' });
  const rules: RuleConfig[] = [];
  for (const row of rows) {
    const raw = await redis.hGet(redisKeys.rule(row.member), 'rule');
    const rule = decode<RuleConfig | null>(raw, null);
    if (rule) {
      rules.push(rule);
    }
  }
  return rules.sort((a, b) => a.priority - b.priority);
}

export async function getRule(id: string): Promise<RuleConfig | null> {
  return decode<RuleConfig | null>(await redis.hGet(redisKeys.rule(id), 'rule'), null);
}

export async function saveRule(rule: RuleConfig): Promise<RuleConfig> {
  await redis.hSet(redisKeys.rule(rule.id), { rule: encode(rule) });
  await redis.zAdd(redisKeys.rulesOrder(), { member: rule.id, score: rule.priority });
  return rule;
}

export async function deleteRule(id: string): Promise<void> {
  await redis.del(redisKeys.rule(id));
  await redis.zRem(redisKeys.rulesOrder(), [id]);
}

export async function seedDefaults(): Promise<void> {
  for (const rule of defaultRules) {
    const existing = await getRule(rule.id);
    if (!existing) {
      await saveRule(rule);
    }
  }
}

function leadingFact(rule: RuleConfig): string | undefined {
  return rule.when.all?.[0]?.fact ?? rule.when.any?.[0]?.fact;
}

export async function scoreFacts(facts: FactBag): Promise<{
  score: number;
  bucket: TriageBucket;
  reasons: string[];
  reasonRefs: ReasonRef[];
  matchedRuleIds: string[];
}> {
  const rules = await listRules();
  const activeRules = rules.length > 0 ? rules : defaultRules;
  let score = 0;
  let bucket: TriageBucket = 'normal';
  const reasons: string[] = [];
  const reasonRefs: ReasonRef[] = [];
  const matchedRuleIds: string[] = [];

  for (const rule of activeRules) {
    if (!matches(rule, facts)) {
      continue;
    }
    score += rule.then.scoreDelta;
    reasons.push(rule.then.reason);
    const ref: ReasonRef = { label: rule.then.reason, sourceRuleId: rule.id };
    const fact = leadingFact(rule);
    if (fact) ref.sourceFact = fact;
    reasonRefs.push(ref);
    matchedRuleIds.push(rule.id);
    if (rule.then.bucket && bucketRank[rule.then.bucket] > bucketRank[bucket]) {
      bucket = rule.then.bucket;
    }
  }

  if (score >= 50 && bucketRank[bucket] < bucketRank.high) {
    bucket = 'high';
  } else if (score >= 25 && bucket === 'normal') {
    bucket = 'aged';
  }

  return { score, bucket, reasons, reasonRefs, matchedRuleIds };
}

async function userAgeDays(author: string): Promise<{ ageDays: number; karma: number; linkKarma: number; verified: boolean }> {
  void author;
  return { ageDays: 999999, karma: 0, linkKarma: 0, verified: false };
}

async function userRemovalCounts(author: string): Promise<{ removalCount: number; spamCount: number }> {
  if (!author || author === '[deleted]') {
    return { removalCount: 0, spamCount: 0 };
  }
  const summary = await redis.hGetAll(redisKeys.userSummary(author));
  const removalsFromModlog = await redis.zCard(redisKeys.modlogByUser(author));
  return {
    removalCount: Math.max(numberFrom(summary.removalCount), removalsFromModlog),
    spamCount: numberFrom(summary.spamCount),
  };
}

async function domainFacts(url: string | undefined): Promise<{ tag?: DomainTag; removedCount: number }> {
  if (!url) {
    return { removedCount: 0 };
  }
  const host = normalizeHost(url);
  if (!host || isRedditHost(host)) {
    return { removedCount: 0 };
  }
  const [meta, stats] = await Promise.all([
    redis.hGetAll(redisKeys.domain(host)),
    redis.hGetAll(redisKeys.domainStats(host)),
  ]);
  const tag = meta.tag && isDomainTag(meta.tag) ? meta.tag : undefined;
  return {
    ...(tag ? { tag } : {}),
    removedCount: numberFrom(stats.removedCount),
  };
}

export async function buildFacts(item: TriageItem): Promise<FactBag> {
  const [account, removals, domain] = await Promise.all([
    userAgeDays(item.author),
    userRemovalCounts(item.author),
    domainFacts(item.url),
  ]);
  return {
    'account.ageDays': account.ageDays,
    'account.commentKarma': account.karma,
    'account.linkKarma': account.linkKarma,
    'account.hasVerifiedEmail': account.verified,
    'user.summary.removalCount': removals.removalCount,
    'user.summary.spamCount': removals.spamCount,
    ...(domain.tag ? { 'post.domain.tag': domain.tag } : {}),
    'post.domain.removedCount': domain.removedCount,
    'item.reports': item.reports?.length ?? 0,
    ...(item.reports?.some((report) => report.toLowerCase().includes('edited link added'))
      ? { 'item.editedLinkAdded': true }
      : {}),
  };
}

export async function dryRunRule(rule: RuleConfig, items: TriageItem[]): Promise<RuleDryRunResult[]> {
  const candidates = items.length > 0 ? items : await loadDryRunCandidates();
  const results: RuleDryRunResult[] = [];
  for (const item of candidates) {
    const facts = await buildFacts(item);
    const matched = matches(rule, facts);
    results.push({
      thingId: item.thingId,
      matched,
      scoreDelta: matched ? rule.then.scoreDelta : 0,
      ...(matched && rule.then.bucket ? { bucket: rule.then.bucket } : {}),
      ...(matched ? { reason: rule.then.reason } : {}),
    });
  }
  return results;
}

async function loadDryRunCandidates(limit = 200): Promise<TriageItem[]> {
  const rows = await redis.zRange(redisKeys.triageItems(), 0, Math.max(limit - 1, 0), {
    by: 'rank',
    reverse: true,
  });
  const items: TriageItem[] = [];
  for (const row of rows) {
    const raw = await redis.hGet(redisKeys.triageItem(row.member), 'item');
    const item = decode<TriageItem | null>(raw, null);
    if (item) items.push(item);
  }
  return items;
}

export async function recentRuleMatches(ruleId: string, limit = 10): Promise<TriageItem[]> {
  const rows = await redis.zRange(redisKeys.ruleMatches(ruleId), 0, Math.max(limit - 1, 0), {
    by: 'rank',
    reverse: true,
  });
  const items: TriageItem[] = [];
  for (const row of rows) {
    const raw = await redis.hGet(redisKeys.triageItem(row.member), 'item');
    const item = decode<TriageItem | null>(raw, null);
    if (item) items.push(item);
  }
  return items;
}

// Helper for callers that still want subreddit context detection.
export function currentSubreddit(): string | undefined {
  return context.subredditName;
}
