export function encode(value: unknown): string {
  return JSON.stringify(value);
}

export function decode<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function numberFrom(value: string | null | undefined, fallback = 0): number {
  if (value == null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

import { redis } from '@devvit/web/server';

export async function memo<T>(key: string, ttlSeconds: number, build: () => Promise<T>): Promise<T> {
  const raw = await redis.get(key);
  if (raw) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // fall through to rebuild
    }
  }
  const value = await build();
  await redis.set(key, JSON.stringify(value), {
    expiration: new Date(Date.now() + ttlSeconds * 1000),
  });
  return value;
}

