import { redis } from '@devvit/web/server';
import type { AuditEntry, JsonValue } from '../shared/types';
import { decode, encode } from './json';
import { redisKeys } from './redisKeys';

export type WriteAuditInput = {
  actor: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
};

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export async function write(input: WriteAuditInput): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: `audit_${crypto.randomUUID()}`,
    actor: input.actor,
    action: input.action,
    target: input.target,
    ts: Date.now(),
    ...(input.before === undefined ? {} : { before: toJsonValue(input.before) }),
    ...(input.after === undefined ? {} : { after: toJsonValue(input.after) }),
  };

  await redis.hSet(redisKeys.auditEntry(entry.id), {
    entry: encode(entry),
  });
  await redis.zAdd(redisKeys.auditLog(), { member: entry.id, score: entry.ts });
  return entry;
}

export async function list(limit = 50): Promise<AuditEntry[]> {
  const rows = await redis.zRange(redisKeys.auditLog(), 0, Math.max(limit - 1, 0), {
    by: 'rank',
    reverse: true,
  });
  const entries: AuditEntry[] = [];
  for (const row of rows) {
    const raw = await redis.hGet(redisKeys.auditEntry(row.member), 'entry');
    const entry = decode<AuditEntry | null>(raw, null);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}
