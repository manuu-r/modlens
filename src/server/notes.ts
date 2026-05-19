import { context, reddit, redis } from '@devvit/web/server';
import type { AddNoteRequest } from '../shared/api-contract';
import type { DomainEntry, Note, UserSummary } from '../shared/types';
import { isUserNoteLabel, mapToRedditLabel } from '../shared/labels';
import { write as writeAudit } from './audit';
import { buildRecentActivity } from './digest';
import { getDomain } from './domains';
import { decode, encode, numberFrom } from './json';
import { redisKeys } from './redisKeys';

export async function listNotes(name: string): Promise<Note[]> {
  const ids = await redis.zRange(redisKeys.userNoteIds(name), 0, -1, {
    by: 'rank',
    reverse: true,
  });
  const notes: Note[] = [];
  for (const row of ids) {
    const raw = await redis.hGet(redisKeys.userNotes(name), row.member);
    const note = decode<Note | null>(raw, null);
    if (note) {
      notes.push(note);
    }
  }
  return notes;
}

export async function getUserSummary(name: string): Promise<UserSummary> {
  const raw = await redis.hGetAll(redisKeys.userSummary(name));
  const summary: UserSummary = {
    spamCount: numberFrom(raw.spamCount),
    removalCount: numberFrom(raw.removalCount),
  };
  if (raw.lastLabel && isUserNoteLabel(raw.lastLabel)) {
    summary.lastLabel = raw.lastLabel;
  }
  if (raw.lastActionAt) {
    summary.lastActionAt = numberFrom(raw.lastActionAt);
  }
  return summary;
}

export async function createNote(
  name: string,
  input: AddNoteRequest,
  actor: string
): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: `note_${crypto.randomUUID()}`,
    label: input.label,
    text: input.text,
    authorMod: actor,
    createdAt: now,
    mirrorStatus: 'synced',
    ...(input.refUrl === undefined ? {} : { refUrl: input.refUrl }),
  };

  const tx = await redis.watch(redisKeys.userNotes(name), redisKeys.userNoteIds(name));
  await tx.multi();
  await tx.hSet(redisKeys.userNotes(name), { [note.id]: encode(note) });
  await tx.zAdd(redisKeys.userNoteIds(name), { member: note.id, score: now });
  await tx.zAdd(redisKeys.notesByLabel(input.label), {
    member: `${name}:${note.id}`,
    score: now,
  });
  await tx.hSet(redisKeys.userSummary(name), {
    lastLabel: input.label,
    lastActionAt: String(now),
    ...(input.label === 'Spammer' ? { spamCount: '1' } : {}),
  });
  await tx.exec();

  try {
    if (context.subredditName) {
      await reddit.addModNote({
        subreddit: context.subredditName,
        user: name,
        label: mapToRedditLabel(input.label),
        note: input.text,
      });
    }
  } catch (error) {
    console.warn('Mod note mirror failed', error);
    note.mirrorStatus = 'pending';
    await redis.hSet(redisKeys.userNotes(name), { [note.id]: encode(note) });
  }

  await writeAudit({
    actor,
    action: 'note.create',
    target: name,
    after: note,
  });
  return note;
}

export async function deleteNote(name: string, noteId: string, actor: string): Promise<void> {
  const raw = await redis.hGet(redisKeys.userNotes(name), noteId);
  const note = decode<Note | null>(raw, null);
  await redis.hDel(redisKeys.userNotes(name), [noteId]);
  await redis.zRem(redisKeys.userNoteIds(name), [noteId]);
  if (note) {
    await redis.zRem(redisKeys.notesByLabel(note.label), [`${name}:${noteId}`]);
  }
  await writeAudit({
    actor,
    action: 'note.delete',
    target: name,
    before: note ?? null,
  });
}

export async function buildUserPanel(name: string): Promise<{
  name: string;
  notes: Note[];
  summary: UserSummary;
  recentActivity: import('../shared/types').RecentActivityItem[];
  domains: DomainEntry[];
  account: {
    ageDays: number;
    commentKarma: number;
    linkKarma: number;
    hasVerifiedEmail: boolean;
  } | null;
}> {
  const [notes, summary, recentActivity] = await Promise.all([
    listNotes(name),
    getUserSummary(name),
    buildRecentActivity(name, 15),
  ]);

  const domainCounts = new Map<string, number>();
  for (const item of recentActivity) {
    if (item.domain) {
      domainCounts.set(item.domain, (domainCounts.get(item.domain) ?? 0) + 1);
    }
  }
  const topHosts = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const domains: DomainEntry[] = [];
  for (const [host] of topHosts) {
    domains.push(await getDomain(host));
  }

  let account: {
    ageDays: number;
    commentKarma: number;
    linkKarma: number;
    hasVerifiedEmail: boolean;
  } | null = null;
  try {
    const user = name === '[deleted]' ? undefined : await reddit.getUserByUsername(name);
    if (user) {
      account = {
        ageDays: Math.max(0, Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000)),
        commentKarma: user.commentKarma,
        linkKarma: user.linkKarma,
        hasVerifiedEmail: user.hasVerifiedEmail,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ''}` : String(error);
    if (!/404/.test(message) && !/not\s*found/i.test(message)) {
      console.warn('userPanel: getUserByUsername failed', message);
    }
  }

  return {
    name,
    notes,
    summary,
    recentActivity,
    domains,
    account,
  };
}
