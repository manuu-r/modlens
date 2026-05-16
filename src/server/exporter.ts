import { redis } from '@devvit/web/server';
import type { AuditEntry, DomainEntry, ExportFormat, ExportKind, Note } from '../shared/types';
import { list as listAudit } from './audit';
import { decode, numberFrom } from './json';
import { redisKeys } from './redisKeys';

export type ExportRequest = {
  kind: ExportKind;
  format: ExportFormat;
  range?: string;
};

const CHUNK_TTL = 3600;

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

async function collectAudit(): Promise<AuditEntry[]> {
  const all: AuditEntry[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i += 1) {
    const page = await listAudit({ ...(cursor ? { cursor } : {}), limit: 200 });
    all.push(...page.entries);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

async function collectNotes(): Promise<Array<Note & { username: string }>> {
  const labels = ['Spammer', 'Warned', 'Trusted', 'Watch', 'BanEvasion'];
  const seen = new Set<string>();
  const out: Array<Note & { username: string }> = [];
  for (const label of labels) {
    const rows = await redis.zRange(redisKeys.notesByLabel(label), 0, -1, { by: 'rank' });
    for (const row of rows) {
      const [username, noteId] = row.member.split(':');
      if (!username || !noteId) continue;
      const key = `${username}:${noteId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = await redis.hGet(redisKeys.userNotes(username), noteId);
      const note = decode<Note | null>(raw, null);
      if (note) {
        out.push({ ...note, username });
      }
    }
  }
  return out;
}

async function collectDomains(): Promise<DomainEntry[]> {
  const rows = await redis.zRange(redisKeys.domainsBySub(), 0, -1, { by: 'rank' });
  const entries: DomainEntry[] = [];
  for (const row of rows) {
    const [meta, stats] = await Promise.all([
      redis.hGetAll(redisKeys.domain(row.member)),
      redis.hGetAll(redisKeys.domainStats(row.member)),
    ]);
    const base: DomainEntry = {
      host: row.member,
      postCount: numberFrom(stats.postCount),
      removedCount: numberFrom(stats.removedCount),
      lastSeenAt: numberFrom(stats.lastSeenAt),
    };
    if (meta.tag) {
      base.tag = meta.tag as NonNullable<DomainEntry['tag']>;
    }
    if (meta.taggedBy) base.taggedBy = meta.taggedBy;
    if (meta.taggedAt) base.taggedAt = numberFrom(meta.taggedAt);
    entries.push(base);
  }
  return entries;
}

async function collectModlog(): Promise<Array<{ day: string; field: string; count: number }>> {
  const today = new Date();
  const rows: Array<{ day: string; field: string; count: number }> = [];
  for (let i = 0; i < 90; i += 1) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const entries = await redis.hGetAll(redisKeys.modlogDay(day));
    for (const [field, value] of Object.entries(entries)) {
      rows.push({ day, field, count: numberFrom(value) });
    }
  }
  return rows;
}

export async function runExport(
  request: ExportRequest,
  token: string,
): Promise<{ chunkCount: number }> {
  let bodyRows: Record<string, unknown>[] = [];
  let headers: string[] = [];

  if (request.kind === 'audit') {
    const entries = await collectAudit();
    headers = ['id', 'ts', 'actor', 'action', 'target', 'before', 'after'];
    bodyRows = entries.map((e) => ({
      id: e.id,
      ts: new Date(e.ts).toISOString(),
      actor: e.actor,
      action: e.action,
      target: e.target,
      before: e.before ?? '',
      after: e.after ?? '',
    }));
  } else if (request.kind === 'notes') {
    const notes = await collectNotes();
    headers = ['username', 'id', 'label', 'authorMod', 'createdAt', 'text', 'refUrl'];
    bodyRows = notes.map((n) => ({
      username: n.username,
      id: n.id,
      label: n.label,
      authorMod: n.authorMod,
      createdAt: new Date(n.createdAt).toISOString(),
      text: n.text,
      refUrl: n.refUrl ?? '',
    }));
  } else if (request.kind === 'domains') {
    const entries = await collectDomains();
    headers = ['host', 'tag', 'taggedBy', 'taggedAt', 'postCount', 'removedCount', 'lastSeenAt'];
    bodyRows = entries.map((e) => ({
      host: e.host,
      tag: e.tag ?? '',
      taggedBy: e.taggedBy ?? '',
      taggedAt: e.taggedAt ? new Date(e.taggedAt).toISOString() : '',
      postCount: e.postCount,
      removedCount: e.removedCount,
      lastSeenAt: e.lastSeenAt ? new Date(e.lastSeenAt).toISOString() : '',
    }));
  } else if (request.kind === 'modlog') {
    const entries = await collectModlog();
    headers = ['day', 'mod', 'actionType', 'count'];
    bodyRows = entries.map((row) => {
      const [mod, action] = row.field.split(':');
      return { day: row.day, mod: mod ?? '', actionType: action ?? '', count: row.count };
    });
  }

  const PAGE_SIZE = 1000;
  let chunkCount = 0;
  for (let i = 0; i < bodyRows.length; i += PAGE_SIZE) {
    const slice = bodyRows.slice(i, i + PAGE_SIZE);
    const body =
      request.format === 'csv'
        ? (i === 0 ? toCsv(slice, headers) : slice.map((r) => headers.map((h) => csvEscape(r[h])).join(',')).join('\n'))
        : JSON.stringify(slice);
    await redis.set(redisKeys.exportChunk(token, chunkCount), body, {
      expiration: new Date(Date.now() + CHUNK_TTL * 1000),
    });
    chunkCount += 1;
  }
  if (chunkCount === 0) {
    const empty = request.format === 'csv' ? headers.join(',') : '[]';
    await redis.set(redisKeys.exportChunk(token, 0), empty, {
      expiration: new Date(Date.now() + CHUNK_TTL * 1000),
    });
    chunkCount = 1;
  }
  await redis.hSet(redisKeys.exportMeta(token), {
    chunks: String(chunkCount),
    format: request.format,
    kind: request.kind,
    completedAt: String(Date.now()),
  });
  return { chunkCount };
}
