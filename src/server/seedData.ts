import { context, reddit, redis } from '@devvit/web/server';
import type { T3 } from '@devvit/shared-types/tid.js';
import type { DomainEntry, Note, TriageBucket, TriageItem } from '../shared/types';
import type { DomainTag } from '../shared/tags';
import { once } from './idempotency';
import { encode } from './json';
import { redisKeys } from './redisKeys';

const SEED_REGISTRY = 'dev:seed:registry';
const SEED_USERS = ['spam_account', 'ban_evader_1', 'scam_poster', 'repeat_offender'];
const SEED_HOSTS = ['scam-example.com', 'spam-network.ru', 'trusted-news.com'];

type PostFixture = {
  author: string;
  score: number;
  bucket: TriageBucket;
  reasons: string[];
  title: string;
  body: string;
  reports?: string[];
};

// Reports on aged items make repeat_reports fire (score +25, forces 'aged') so
// the triage-rescore cron doesn't move them to 'normal' after seeding.
// High items need their authors to have removalCount >= 3 (see NOTES below)
// so prior_removals keeps them in 'high'.
const POST_FIXTURES: PostFixture[] = [
  {
    author: 'spam_account',
    score: 85,
    bucket: 'high',
    reasons: ['prior removals in this sub', 'new account (<30d)'],
    title: '[TEST] High risk — repeat spam poster',
    body: 'ModLens dev seed post. Safe to approve or remove.',
  },
  {
    author: 'ban_evader_1',
    score: 75,
    bucket: 'high',
    reasons: ['prior removals in this sub', 'new account (<30d)'],
    title: '[TEST] High risk — suspected ban evasion',
    body: 'ModLens dev seed post. Safe to approve or remove.',
  },
  {
    author: 'scam_poster',
    score: 90,
    bucket: 'high',
    reasons: ['prior removals in this sub', 'multiple reports'],
    title: '[TEST] High risk — scam link post',
    body: 'ModLens dev seed post. Safe to approve or remove.',
    reports: ['Spam', 'Misinformation'],
  },
  {
    author: 'repeat_offender',
    score: 70,
    bucket: 'high',
    reasons: ['prior removals in this sub', 'new account (<30d)'],
    title: '[TEST] High risk — repeat offender',
    body: 'ModLens dev seed post. Safe to approve or remove.',
  },
  {
    author: 'test_user_aged',
    score: 45,
    bucket: 'aged',
    reasons: ['multiple reports', 'new account (<30d)'],
    title: '[TEST] Aged — reported intro post',
    body: 'ModLens dev seed post. Safe to approve or remove.',
    reports: ['Spam', 'Looks suspicious'],
  },
  {
    author: 'low_karma_user',
    score: 45,
    bucket: 'aged',
    reasons: ['multiple reports', 'new account (<30d)'],
    title: '[TEST] Aged — low karma user',
    body: 'ModLens dev seed post. Safe to approve or remove.',
    reports: ['Spam', 'Misinformation'],
  },
  {
    author: 'comment_author',
    score: 45,
    bucket: 'aged',
    reasons: ['multiple reports', 'new account (<30d)'],
    title: '[TEST] Aged — reported post',
    body: 'ModLens dev seed post. Safe to approve or remove.',
    reports: ['Rule violation', 'Spam'],
  },
  {
    author: 'new_poster',
    score: 20,
    bucket: 'normal',
    reasons: ['new account (<30d)'],
    title: '[TEST] Normal — new account first post',
    body: 'ModLens dev seed post. Safe to approve or remove.',
  },
  {
    author: 'regular_user',
    score: 20,
    bucket: 'normal',
    reasons: ['new account (<30d)'],
    title: '[TEST] Normal — regular post',
    body: 'ModLens dev seed post. Safe to approve or remove.',
  },
  {
    author: 'basic_poster',
    score: 20,
    bucket: 'normal',
    reasons: ['new account (<30d)'],
    title: '[TEST] Normal — clean post',
    body: 'ModLens dev seed post. Safe to approve or remove.',
  },
];

// removalCount must be >= 3 for the 'prior_removals' default rule to fire and
// keep these items pinned to the 'high' bucket through triage-rescore cycles.
type NoteFixture = { user: string; label: string; text: string; removalCount: number; spamCount: number };

const NOTES: NoteFixture[] = [
  { user: 'spam_account',   label: 'Spammer',    text: 'Repeated spam links in past 7 days. Third offense.',              removalCount: 4, spamCount: 1 },
  { user: 'ban_evader_1',   label: 'BanEvasion', text: 'Suspected evasion — same posting pattern as banned u/old_account_123.', removalCount: 3, spamCount: 0 },
  { user: 'repeat_offender',label: 'Watch',      text: 'Self-promotion across 4 different posts this month.',             removalCount: 4, spamCount: 0 },
  { user: 'scam_poster',    label: 'Spammer',    text: 'Consistently posts crypto/prize scam links.',                    removalCount: 5, spamCount: 2 },
];

type DomainFixture = {
  host: string;
  tag: DomainTag;
  taggedBy: string;
  notes: string;
  postCount: number;
  removedCount: number;
};

const DOMAINS: DomainFixture[] = [
  { host: 'spam-network.ru', tag: 'spammy', taggedBy: 'mod_seed', notes: 'Known spam link farm.', postCount: 23, removedCount: 21 },
  { host: 'scam-example.com', tag: 'scam', taggedBy: 'mod_seed', notes: 'Fake prize/crypto scam site.', postCount: 11, removedCount: 11 },
  { host: 'trusted-news.com', tag: 'trusted', taggedBy: 'mod_seed', notes: 'Reputable news source.', postCount: 47, removedCount: 2 },
];

async function seedItems(subredditName: string): Promise<number> {
  const ts = Date.now();
  for (const fixture of POST_FIXTURES) {
    const post = await reddit.submitPost({
      subredditName,
      title: fixture.title,
      text: fixture.body,
    });

    // Pre-claim idempotency slot so onPostSubmit trigger skips this post
    await once(`evt:${post.id}`);

    const item: TriageItem = {
      thingId: post.id,
      kind: 'post',
      author: fixture.author,
      score: fixture.score,
      bucket: fixture.bucket,
      createdAt: ts,
      reasons: fixture.reasons,
      url: post.url,
      title: post.title,
      ...(fixture.reports !== undefined ? { reports: fixture.reports } : {}),
    };

    // Remove from any bucket the trigger might have already written to
    for (const b of ['high', 'aged', 'normal'] as const) {
      await redis.zRem(redisKeys.triageBucket(b), [post.id]);
    }
    await redis.hSet(redisKeys.triageItem(post.id), { item: encode(item) });
    await redis.zAdd(redisKeys.triageItems(), { member: post.id, score: item.score });
    await redis.zAdd(redisKeys.triageBucket(item.bucket), { member: post.id, score: item.createdAt });
    await redis.zAdd(SEED_REGISTRY, { member: post.id, score: ts });
  }
  return POST_FIXTURES.length;
}

async function seedNotes(): Promise<number> {
  const ts = Date.now();
  for (const n of NOTES) {
    const id = `note_seed_${n.user}`;
    const note: Note = {
      id,
      label: n.label as Note['label'],
      text: n.text,
      authorMod: 'mod_seed',
      createdAt: ts,
      mirrorStatus: 'synced',
    };
    await redis.hSet(redisKeys.userNotes(n.user), { [id]: encode(note) });
    await redis.zAdd(redisKeys.userNoteIds(n.user), { member: id, score: ts });
    await redis.hSet(redisKeys.userSummary(n.user), {
      lastLabel: n.label,
      lastActionAt: String(ts),
      spamCount: String(n.spamCount),
      removalCount: String(n.removalCount),
    });
  }
  return NOTES.length;
}

async function seedDomains(): Promise<number> {
  const ts = Date.now();
  for (const d of DOMAINS) {
    const entry: DomainEntry = {
      host: d.host,
      tag: d.tag,
      taggedBy: d.taggedBy,
      taggedAt: ts,
      notes: d.notes,
      postCount: d.postCount,
      removedCount: d.removedCount,
      lastSeenAt: ts,
    };
    await redis.hSet(redisKeys.domain(d.host), {
      tag: d.tag,
      taggedBy: d.taggedBy,
      taggedAt: String(ts),
      notes: d.notes,
    });
    await redis.hSet(redisKeys.domainStats(d.host), {
      postCount: String(d.postCount),
      removedCount: String(d.removedCount),
      lastSeenAt: String(ts),
    });
    await redis.zAdd(redisKeys.domainsByTag(entry.tag!), { member: d.host, score: d.removedCount });
    await redis.zAdd(redisKeys.domainsBySub(), { member: d.host, score: d.postCount });
  }
  return DOMAINS.length;
}

export async function seedAll(): Promise<{ triage: number; notes: number; domains: number }> {
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error('No subreddit context for seed.');
  }
  const triage = await seedItems(subredditName);
  const [notes, domains] = await Promise.all([seedNotes(), seedDomains()]);
  return { triage, notes, domains };
}

export async function clearSeedData(): Promise<{ removed: number }> {
  const rows = await redis.zRange(SEED_REGISTRY, 0, -1, { by: 'rank' });
  let removed = 0;

  for (const row of rows) {
    const id = row.member;
    const raw = await redis.hGet(redisKeys.triageItem(id), 'item');
    if (raw) {
      const item = JSON.parse(raw) as TriageItem;
      await redis.zRem(redisKeys.triageBucket(item.bucket), [id]);
    }
    await redis.zRem(redisKeys.triageItems(), [id]);
    await redis.del(redisKeys.triageItem(id));
    try {
      await reddit.remove(id as T3, false);
    } catch {
      // post may already be gone
    }
    removed += 1;
  }
  await redis.del(SEED_REGISTRY);

  for (const user of SEED_USERS) {
    const noteId = `note_seed_${user}`;
    await redis.hDel(redisKeys.userNotes(user), [noteId]);
    await redis.zRem(redisKeys.userNoteIds(user), [noteId]);
    await redis.del(redisKeys.userSummary(user));
  }

  for (const host of SEED_HOSTS) {
    await redis.del(redisKeys.domain(host));
    await redis.del(redisKeys.domainStats(host));
    for (const tag of ['spammy', 'scam', 'trusted', 'watchlist'] as const) {
      await redis.zRem(redisKeys.domainsByTag(tag), [host]);
    }
    await redis.zRem(redisKeys.domainsBySub(), [host]);
  }

  return { removed };
}

export async function getSeedCounts(): Promise<{ triage: number; notes: number; domains: number }> {
  const rows = await redis.zRange(SEED_REGISTRY, 0, -1, { by: 'rank' });
  let triage = 0;
  for (const row of rows) {
    const exists = await redis.hGet(redisKeys.triageItem(row.member), 'item');
    if (exists) triage += 1;
  }

  let notes = 0;
  for (const n of NOTES) {
    const exists = await redis.hGet(redisKeys.userNotes(n.user), `note_seed_${n.user}`);
    if (exists) notes += 1;
  }

  let domains = 0;
  for (const d of DOMAINS) {
    const exists = await redis.hGet(redisKeys.domain(d.host), 'tag');
    if (exists) domains += 1;
  }

  return { triage, notes, domains };
}
