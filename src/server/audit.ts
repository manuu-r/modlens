import { redis } from '@devvit/web/server';
import type { AuditEntry, JsonValue } from '../shared/types';
import { decode, encode } from './json';
import { normalizeHost, redisKeys } from './redisKeys';

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

export type ListAuditOptions = {
  cursor?: string;
  actor?: string;
  action?: string;
  target?: string;
  site?: string;
  limit?: number;
};

function entryMatchesSite(entry: AuditEntry, host: string): boolean {
  if (entry.target.toLowerCase() === host) {
    return true;
  }
  for (const side of [entry.before, entry.after]) {
    if (side && typeof side === 'object' && !Array.isArray(side)) {
      const url = (side as { url?: unknown }).url;
      if (typeof url === 'string') {
        const matched = normalizeHost(url);
        if (matched === host) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function list(options: ListAuditOptions = {}): Promise<{
  entries: AuditEntry[];
  nextCursor?: string;
}> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const entries: AuditEntry[] = [];
  let max = options.cursor ? Number(options.cursor) - 1 : Date.now() + 1;
  const batchSize = 100;
  const siteHost = options.site ? (normalizeHost(options.site) ?? options.site.toLowerCase().replace(/^www\./, '')) : undefined;

  while (entries.length < limit + 1) {
    const rows = await redis.zRange(redisKeys.auditLog(), max, 0, {
      by: 'score',
      reverse: true,
      limit: { offset: 0, count: batchSize },
    });

    if (rows.length === 0) {
      break;
    }

    let nextMax = max;
    for (const row of rows) {
      const raw = await redis.hGet(redisKeys.auditEntry(row.member), 'entry');
      const entry = decode<AuditEntry | null>(raw, null);
      const rowScore = 'score' in row && typeof row.score === 'number' ? row.score : entry?.ts;
      if (rowScore !== undefined) {
        nextMax = Math.min(nextMax, rowScore - 1);
      }
      if (!entry) {
        continue;
      }
      if (options.actor && entry.actor !== options.actor) {
        continue;
      }
      if (options.action && entry.action !== options.action) {
        continue;
      }
      if (options.target && !entry.target.toLowerCase().includes(options.target.toLowerCase())) {
        continue;
      }
      if (siteHost && !entryMatchesSite(entry, siteHost)) {
        continue;
      }
      entries.push(entry);
      if (entries.length >= limit + 1) {
        break;
      }
    }

    if (nextMax >= max) {
      break;
    }
    max = nextMax;
  }

  const page = entries.slice(0, limit);
  const last = page.at(-1);
  return {
    entries: page,
    ...(entries.length > limit && last ? { nextCursor: String(last.ts) } : {}),
  };
}
