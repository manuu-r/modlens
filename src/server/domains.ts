import { redis } from '@devvit/web/server';
import type { DomainTag } from '../shared/tags';
import type { DomainEntry, TriageItem } from '../shared/types';
import { write as writeAudit } from './audit';
import { decode, numberFrom } from './json';
import { normalizeHost, redisKeys } from './redisKeys';

export async function getDomain(host: string): Promise<DomainEntry> {
  const clean = normalizeHost(host) ?? host.toLowerCase().replace(/^www\./, '');
  const [meta, stats] = await Promise.all([
    redis.hGetAll(redisKeys.domain(clean)),
    redis.hGetAll(redisKeys.domainStats(clean)),
  ]);

  return {
    host: clean,
    ...(meta.tag ? { tag: meta.tag as DomainTag } : {}),
    ...(meta.taggedBy ? { taggedBy: meta.taggedBy } : {}),
    ...(meta.taggedAt ? { taggedAt: numberFrom(meta.taggedAt) } : {}),
    ...(meta.notes ? { notes: meta.notes } : {}),
    postCount: numberFrom(stats.postCount),
    removedCount: numberFrom(stats.removedCount),
    lastSeenAt: numberFrom(stats.lastSeenAt),
  };
}

export async function recordDomainSeen(rawUrl: string, delta = 1): Promise<DomainEntry | null> {
  const host = normalizeHost(rawUrl);
  if (!host) {
    return null;
  }

  await redis.hIncrBy(redisKeys.domainStats(host), 'postCount', delta);
  await redis.hSet(redisKeys.domainStats(host), { lastSeenAt: String(Date.now()) });
  const count = await redis.hGet(redisKeys.domainStats(host), 'postCount');
  await redis.zAdd(redisKeys.domainsBySub(), {
    member: host,
    score: numberFrom(count, delta),
  });
  return getDomain(host);
}

export async function recordDomainRemoved(rawUrl: string): Promise<DomainEntry | null> {
  const host = normalizeHost(rawUrl);
  if (!host) {
    return null;
  }

  await redis.hIncrBy(redisKeys.domainStats(host), 'removedCount', 1);
  return getDomain(host);
}

export async function tagDomain(
  host: string,
  input: DomainTag | { tag: DomainTag; notes?: string },
  actor: string,
  notes?: string
): Promise<DomainEntry> {
  const tagInput = typeof input === 'string' ? { tag: input, notes } : input;
  const current = await getDomain(host);
  const now = Date.now();
  await redis.hSet(redisKeys.domain(current.host), {
    tag: tagInput.tag,
    taggedBy: actor,
    taggedAt: String(now),
    ...(tagInput.notes === undefined ? {} : { notes: tagInput.notes }),
  });
  await redis.zAdd(redisKeys.domainsByTag(tagInput.tag), {
    member: current.host,
    score: now,
  });
  const updated = await getDomain(current.host);
  await writeAudit({
    actor,
    action: 'domain.tag',
    target: current.host,
    before: current,
    after: updated,
  });
  return updated;
}

export async function deleteDomainTag(host: string, actor: string): Promise<DomainEntry> {
  const current = await getDomain(host);
  if (current.tag) {
    await redis.hDel(redisKeys.domain(current.host), ['tag', 'taggedBy', 'taggedAt']);
    await redis.zRem(redisKeys.domainsByTag(current.tag), [current.host]);
  }
  const updated = await getDomain(current.host);
  await writeAudit({
    actor,
    action: 'domain.untag',
    target: current.host,
    before: current,
    after: updated,
  });
  return updated;
}

export async function topDomains(limit = 10, tag?: DomainTag): Promise<DomainEntry[]> {
  const key = tag ? redisKeys.domainsByTag(tag) : redisKeys.domainsBySub();
  const rows = await redis.zRange(key, 0, Math.max(limit - 1, 0), {
    by: 'rank',
    reverse: true,
  });
  return Promise.all(rows.map((row) => getDomain(row.member)));
}

export async function recordPostDomain(input: {
  postUrl: string;
  thingId?: string;
}): Promise<DomainEntry | null> {
  void input.thingId;
  return recordDomainSeen(input.postUrl);
}

export async function recordDomainRemoval(rawUrl: string): Promise<DomainEntry | null> {
  return recordDomainRemoved(rawUrl);
}

export async function clearDomainTag(host: string, actor: string): Promise<DomainEntry> {
  return deleteDomainTag(host, actor);
}

export async function domainsByTag(tag: DomainTag, limit = 10): Promise<DomainEntry[]> {
  return topDomains(limit, tag);
}

export type SiteAuthor = {
  name: string;
  itemCount: number;
  lastSeenAt: number;
};

const SITE_SCAN_LIMIT = 300;

async function scanItemsForHost(host: string): Promise<TriageItem[]> {
  const clean = normalizeHost(host) ?? host.toLowerCase().replace(/^www\./, '');
  const rows = await redis.zRange(redisKeys.triageItems(), 0, SITE_SCAN_LIMIT - 1, {
    by: 'rank',
    reverse: true,
  });
  const matched: TriageItem[] = [];
  for (const row of rows) {
    const item = decode<TriageItem | null>(
      await redis.hGet(redisKeys.triageItem(row.member), 'item'),
      null,
    );
    if (!item?.url) continue;
    if (normalizeHost(item.url) === clean) {
      matched.push(item);
    }
  }
  return matched;
}

export async function listSiteItems(host: string, limit = 25): Promise<TriageItem[]> {
  const items = await scanItemsForHost(host);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items.slice(0, Math.max(0, limit));
}

export async function listSiteAuthors(host: string, limit = 25): Promise<SiteAuthor[]> {
  const items = await scanItemsForHost(host);
  const map = new Map<string, SiteAuthor>();
  for (const item of items) {
    const current = map.get(item.author);
    if (current) {
      current.itemCount += 1;
      if (item.createdAt > current.lastSeenAt) {
        current.lastSeenAt = item.createdAt;
      }
    } else {
      map.set(item.author, { name: item.author, itemCount: 1, lastSeenAt: item.createdAt });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.itemCount - a.itemCount || b.lastSeenAt - a.lastSeenAt)
    .slice(0, Math.max(0, limit));
}
