import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { context, reddit, redis, scheduler } from '@devvit/web/server';
import { evaluateItemForAlerts } from '../server/alerts';
import { recordDomainSeen, recordDomainRemoved, getDomain } from '../server/domains';
import { once } from '../server/idempotency';
import { recordModAction } from '../server/modlog';
import { redisKeys } from '../server/redisKeys';
import { seedDefaults } from '../server/rules';
import { enqueueItem, type EnqueueInput } from '../server/triage';
import { getUserSummary } from '../server/notes';
import { normalizeHost } from '../server/redisKeys';
import type { ThingKind } from '../shared/types';

export const triggers = new Hono();

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === 'object' ? (value as AnyRecord) : {};
const stringAt = (record: AnyRecord, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;
const numberAt = (record: AnyRecord, key: string): number | undefined =>
  typeof record[key] === 'number' ? record[key] : undefined;
const nested = (record: AnyRecord, key: string): AnyRecord => asRecord(record[key]);

function reportCount(record: AnyRecord): number {
  return Math.max(1, Math.floor(numberAt(record, 'numReports') ?? 1));
}

function reportReasons(record: AnyRecord, reason: string): string[] {
  return Array.from({ length: reportCount(record) }, () => reason);
}

function reportEventKey(kind: ThingKind, id: string, record: AnyRecord, reason: string): string {
  return `evt:report:${kind}:${id}:${reportCount(record)}:${encodeURIComponent(reason).slice(0, 120)}`;
}

async function ensureModLensPost(): Promise<void> {
  if (await redis.get(redisKeys.dashboardPostId())) {
    return;
  }
  if (!context.subredditName) {
    return;
  }
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: 'ModLens queue',
    entry: 'default',
    postData: { version: 1 },
    textFallback: { text: 'Open ModLens queue in a supported Reddit client.' },
  });
  await redis.set(redisKeys.dashboardPostId(), post.id);
}

async function enqueueAndAlert(input: EnqueueInput): Promise<void> {
  const item = await enqueueItem(input);
  let summary: { spamCount: number; removalCount: number; lastLabel?: string } = {
    spamCount: 0,
    removalCount: 0,
  };
  try {
    const full = await getUserSummary(item.author);
    summary = {
      spamCount: full.spamCount,
      removalCount: full.removalCount,
      ...(full.lastLabel ? { lastLabel: full.lastLabel } : {}),
    };
  } catch {
    // ignore
  }
  const host = item.url ? normalizeHost(item.url) : null;
  const domain = host ? await getDomain(host).catch(() => null) : null;
  await evaluateItemForAlerts(
    item,
    {
      ...(summary.lastLabel ? { lastLabel: summary.lastLabel } : {}),
      spamCount: summary.spamCount,
      removalCount: summary.removalCount,
    },
    domain?.tag,
  );
}

triggers.post('/install', async (c) => {
  const input = await c.req.json<AnyRecord>();
  const subreddit = nested(input, 'subreddit');
  const subredditId = stringAt(subreddit, 'id') ?? context.subredditId ?? 'unknown';
  if (await once(`install:${subredditId}`, 60 * 60 * 24)) {
    await seedDefaults();
    await ensureModLensPost();
    await scheduler.runJob({
      name: 'backfill-modlog',
      runAt: new Date(),
      data: { cursor: null, processed: 0 },
    });
  }
  return c.json<TriggerResponse>({});
});

triggers.post('/upgrade', async (c) => c.json<TriggerResponse>({}));

triggers.post('/post-submit', async (c) => {
  const input = await c.req.json<AnyRecord>();
  const post = nested(input, 'post');
  const id = stringAt(post, 'id') ?? stringAt(input, 'postId') ?? crypto.randomUUID();
  if (!(await once(`evt:${id}`))) {
    return c.json<TriggerResponse>({});
  }
  const url = stringAt(post, 'url');
  if (url) {
    await recordDomainSeen(url);
  }
  const title = stringAt(post, 'title');
  await enqueueAndAlert({
    id,
    kind: 'post',
    author: stringAt(post, 'authorName') ?? stringAt(post, 'author') ?? '[deleted]',
    createdAt: numberAt(post, 'createdAt') ?? Date.now(),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  });
  return c.json<TriggerResponse>({});
});

triggers.post('/comment-submit', async (c) => {
  const input = await c.req.json<AnyRecord>();
  const comment = nested(input, 'comment');
  const id = stringAt(comment, 'id') ?? stringAt(input, 'commentId') ?? crypto.randomUUID();
  if (await once(`evt:${id}`)) {
    await enqueueAndAlert({
      id,
      kind: 'comment',
      author:
        stringAt(comment, 'authorName') ?? stringAt(comment, 'author') ?? '[deleted]',
      createdAt: numberAt(comment, 'createdAt') ?? Date.now(),
    });
  }
  return c.json<TriggerResponse>({});
});

triggers.post('/post-report', async (c) => {
  const input = await c.req.json<AnyRecord>();
  const post = nested(input, 'post');
  const id = stringAt(post, 'id') ?? stringAt(input, 'postId') ?? crypto.randomUUID();
  const reason = stringAt(input, 'reason') ?? 'reported';
  if (await once(reportEventKey('post', id, post, reason))) {
    const url = stringAt(post, 'url');
    const title = stringAt(post, 'title');
    await enqueueAndAlert({
      id,
      kind: 'post',
      author: stringAt(post, 'authorName') ?? '[deleted]',
      createdAt: numberAt(post, 'createdAt') ?? Date.now(),
      reports: reportReasons(post, reason),
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
    });
  }
  return c.json<TriggerResponse>({});
});

triggers.post('/comment-report', async (c) => {
  const input = await c.req.json<AnyRecord>();
  const comment = nested(input, 'comment');
  const id = stringAt(comment, 'id') ?? stringAt(input, 'commentId') ?? crypto.randomUUID();
  const reason = stringAt(input, 'reason') ?? 'reported';
  if (await once(reportEventKey('comment', id, comment, reason))) {
    await enqueueAndAlert({
      id,
      kind: 'comment',
      author: stringAt(comment, 'authorName') ?? stringAt(comment, 'author') ?? '[deleted]',
      createdAt: numberAt(comment, 'createdAt') ?? Date.now(),
      reports: reportReasons(comment, reason),
    });
  }
  return c.json<TriggerResponse>({});
});

triggers.post('/automod-post', async (c) => {
  const input = await c.req.json<AnyRecord>();
  const post = nested(input, 'post');
  const id = stringAt(post, 'id') ?? crypto.randomUUID();
  if (await once(`evt:automod:${id}`)) {
    const url = stringAt(post, 'url');
    await enqueueAndAlert({
      id,
      kind: 'post',
      author: stringAt(post, 'authorName') ?? '[deleted]',
      createdAt: numberAt(post, 'createdAt') ?? Date.now(),
      reports: ['automoderator'],
      ...(url ? { url } : {}),
    });
  }
  return c.json<TriggerResponse>({});
});

triggers.post('/mod-action', async (c) => {
  const input = await c.req.json<AnyRecord>();
  const action = {
    id: stringAt(input, 'id') ?? crypto.randomUUID(),
    type: stringAt(input, 'action') ?? stringAt(input, 'type') ?? 'unknown',
    moderatorName:
      stringAt(input, 'moderatorName') ?? stringAt(input, 'moderator') ?? 'unknown',
    createdAt: numberAt(input, 'createdAt') ?? Date.now(),
    target: nested(input, 'target'),
  };
  await recordModAction(action);
  const target = nested(input, 'target');
  const permalink = stringAt(target, 'permalink');
  if ((action.type === 'removelink' || action.type === 'spamlink') && permalink) {
    await recordDomainRemoved(permalink);
  }
  return c.json<TriggerResponse>({});
});

triggers.post('/modmail', async (c) => c.json<TriggerResponse>({}));
