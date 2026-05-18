import { redis } from '@devvit/web/server';
import { redisKeys } from './redisKeys';

const PRESENCE_TTL_SECONDS = 120;

export interface PresenceEntry {
  modName: string;
  since: number;
}

export interface PresenceClaim {
  claimed: boolean;
  modName: string;
}

function encodePresence(modName: string, since = Date.now()): string {
  return JSON.stringify({ modName, since } satisfies PresenceEntry);
}

function presenceExpiration(): Date {
  return new Date(Date.now() + PRESENCE_TTL_SECONDS * 1000);
}

export async function claimItem(itemId: string, modName: string): Promise<PresenceClaim> {
  const key = redisKeys.presenceItem(itemId);
  const created = await redis.set(key, encodePresence(modName), {
    nx: true,
    expiration: presenceExpiration(),
  });
  if (created === 'OK') {
    return { claimed: true, modName };
  }

  const existing = await redis.get(key);
  if (existing) {
    const entry = tryDecode(existing);
    if (entry?.modName === modName) {
      await redis.set(key, encodePresence(modName, entry.since), {
        expiration: presenceExpiration(),
      });
      return { claimed: true, modName };
    }
    if (entry) {
      return { claimed: false, modName: entry.modName };
    }
  }

  const retried = await redis.set(key, encodePresence(modName), {
    nx: true,
    expiration: presenceExpiration(),
  });
  if (retried === 'OK') {
    return { claimed: true, modName };
  }
  const owner = tryDecode((await redis.get(key)) ?? '');
  return { claimed: false, modName: owner?.modName ?? modName };
}

export async function touchItem(itemId: string, modName: string): Promise<void> {
  const key = redisKeys.presenceItem(itemId);
  const existing = await redis.get(key);
  const entry = existing ? tryDecode(existing) : null;
  if (!entry || entry.modName !== modName) return;
  await redis.set(key, encodePresence(modName, entry.since), {
    expiration: presenceExpiration(),
  });
}

export async function releaseItem(itemId: string, modName: string): Promise<void> {
  const key = redisKeys.presenceItem(itemId);
  const existing = await redis.get(key);
  const entry = existing ? tryDecode(existing) : null;
  if (entry?.modName === modName) {
    await redis.del(key);
  }
}

export async function getItemPresence(itemId: string): Promise<PresenceEntry | null> {
  const raw = await redis.get(redisKeys.presenceItem(itemId));
  return raw ? tryDecode(raw) : null;
}

export async function getPresenceBatch(itemIds: string[]): Promise<Record<string, PresenceEntry>> {
  const result: Record<string, PresenceEntry> = {};
  await Promise.all(
    itemIds.map(async (id) => {
      const entry = await getItemPresence(id);
      if (entry) result[id] = entry;
    }),
  );
  return result;
}

function tryDecode(raw: string): PresenceEntry | null {
  try {
    return JSON.parse(raw) as PresenceEntry;
  } catch {
    return null;
  }
}
