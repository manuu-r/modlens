import { context, reddit, redis } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/shared-types/tid.js';
import { write as writeAudit } from './audit';
import { decode, encode } from './json';
import { redisKeys } from './redisKeys';
import { getItem as getTriageItem } from './triage';

export interface RemovalReason {
  id: string;
  title: string;
  bodyTemplate: string;
  autoComment: boolean;
  dmUser: boolean;
  createdAt: number;
  createdBy: string;
}

export async function listReasons(): Promise<RemovalReason[]> {
  const raw = await redis.hGetAll(redisKeys.removalReasons());
  const reasons: RemovalReason[] = [];
  for (const value of Object.values(raw)) {
    const reason = decode<RemovalReason | null>(value, null);
    if (reason) reasons.push(reason);
  }
  return reasons.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getReason(id: string): Promise<RemovalReason | null> {
  const raw = await redis.hGet(redisKeys.removalReasons(), id);
  return decode<RemovalReason | null>(raw, null);
}

export async function createReason(
  input: { title: string; bodyTemplate: string; autoComment: boolean; dmUser: boolean },
  actor: string,
): Promise<RemovalReason> {
  const reason: RemovalReason = {
    id: `rr_${crypto.randomUUID()}`,
    title: input.title.trim().slice(0, 120),
    bodyTemplate: input.bodyTemplate.trim().slice(0, 2000),
    autoComment: input.autoComment,
    dmUser: input.dmUser,
    createdAt: Date.now(),
    createdBy: actor,
  };
  await redis.hSet(redisKeys.removalReasons(), { [reason.id]: encode(reason) });
  await writeAudit({ actor, action: 'removalReason.create', target: reason.id, after: reason });
  return reason;
}

export async function deleteReason(id: string, actor: string): Promise<void> {
  const before = await getReason(id);
  await redis.hDel(redisKeys.removalReasons(), [id]);
  await writeAudit({ actor, action: 'removalReason.delete', target: id, before: before ?? null });
}

export type ApplyReasonInput = {
  reasonId: string;
  thingId: string;
  author: string;
  title: string | undefined;
};

export async function applyReason(input: ApplyReasonInput, actor: string): Promise<void> {
  const reason = await getReason(input.reasonId);
  if (!reason) throw new Error(`Removal reason ${input.reasonId} not found`);

  const subredditName = context.subredditName ?? '';
  const body = interpolate(reason.bodyTemplate, {
    username: input.author,
    subreddit: subredditName,
    post_title: input.title ?? '',
    mod: actor,
  });

  const triageItem = await getTriageItem(input.thingId);

  await reddit.remove(input.thingId as T1 | T3, false);

  if (triageItem) {
    await redis.zRem(redisKeys.triageItems(), [input.thingId]);
    await redis.zRem(redisKeys.triageBucket(triageItem.bucket), [input.thingId]);
    await redis.del(redisKeys.triageItem(input.thingId));
  }

  const errors: string[] = [];

  if (reason.autoComment) {
    try {
      await reddit.submitComment({ id: input.thingId as T1 | T3, text: body });
    } catch (err) {
      errors.push(`comment failed: ${String(err)}`);
      console.warn('removalReasons: submitComment failed', err);
    }
  }

  if (reason.dmUser) {
    try {
      await reddit.sendPrivateMessage({
        to: input.author,
        subject: `Your submission was removed from r/${subredditName}`,
        text: body,
      });
    } catch (err) {
      errors.push(`dm failed: ${String(err)}`);
      console.warn('removalReasons: sendPrivateMessage failed', err);
    }
  }

  await writeAudit({
    actor,
    action: 'removal.applied',
    target: input.thingId,
    after: {
      reasonId: reason.id,
      reasonTitle: reason.title,
      author: input.author,
      autoComment: reason.autoComment,
      dmUser: reason.dmUser,
      errors: errors.length ? errors : undefined,
    },
  });
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}
