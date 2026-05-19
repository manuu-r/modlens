import { Hono } from 'hono';
import { redis, scheduler } from '@devvit/web/server';
import { fireAlert, getConfig } from '../server/alerts';
import { backfillChunk } from '../server/modlog';
import { redisKeys } from '../server/redisKeys';
import { rescoreTopN } from '../server/triage';

export const cron = new Hono();

type TaskRequest<T> = {
  name: string;
  data: T;
};

type TaskResponse = Record<string, never>;

cron.post('/triage-rescore', async (c) => {
  await rescoreTopN(200);
  return c.json<TaskResponse>({});
});

cron.post('/alert-evaluator', async (c) => {
  const { highBacklogThreshold: threshold } = await getConfig();
  const highCount = await redis.zCard(redisKeys.triageBucket('high'));
  if (highCount >= threshold) {
    await fireAlert(
      'queue_backlog_high',
      { highCount, threshold },
      { queue: '#/triage/high' },
    );
  }
  return c.json<TaskResponse>({});
});

cron.post('/modlog-rollup', async (c) => {
  // Trim any modlog day hashes older than 180 days. (Best effort — we know
  // exact key names so we can DEL without listing.)
  const today = new Date();
  for (let i = 180; i < 365; i += 1) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    await redis.del(redisKeys.modlogDay(day));
  }
  return c.json<TaskResponse>({});
});

cron.post('/backfill-modlog', async (c) => {
  const startedAt = Date.now();
  const input = await c.req.json<TaskRequest<{ cursor?: string | null; processed?: number }>>();
  let cursor: string | null = input.data?.cursor ?? null;
  let processed = input.data?.processed ?? 0;
  // Daisy-chain inside the 20s safety window.
  while (Date.now() - startedAt < 20_000) {
    const result = await backfillChunk(cursor);
    processed += result.processed;
    if (!result.nextCursor) {
      cursor = null;
      break;
    }
    cursor = result.nextCursor;
  }
  if (cursor) {
    await scheduler.runJob({
      name: 'backfill-modlog',
      runAt: new Date(),
      data: { cursor, processed },
    });
  }
  return c.json<TaskResponse>({});
});
