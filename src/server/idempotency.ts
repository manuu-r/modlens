import { redis } from '@devvit/web/server';
import { redisKeys } from './redisKeys';

export async function once(eventId: string, ttlSeconds = 3600): Promise<boolean> {
  const key = redisKeys.idem(eventId);
  const result = await redis.set(key, '1', { nx: true });
  if (result !== 'OK') {
    return false;
  }

  await redis.expire(key, ttlSeconds);
  return true;
}

