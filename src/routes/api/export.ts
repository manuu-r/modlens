import { Hono } from 'hono';
import { redis, scheduler } from '@devvit/web/server';
import { requireModerator } from '../../server/modAuth';
import { numberFrom } from '../../server/json';
import { redisKeys } from '../../server/redisKeys';
import type { ExportFormat, ExportKind } from '../../shared/types';

export const exportApi = new Hono();

const VALID_KINDS: ExportKind[] = ['notes', 'domains', 'audit', 'modlog'];
const VALID_FORMATS: ExportFormat[] = ['csv', 'json'];

function asKind(value: unknown): ExportKind {
  return typeof value === 'string' && (VALID_KINDS as string[]).includes(value)
    ? (value as ExportKind)
    : 'audit';
}

function asFormat(value: unknown): ExportFormat {
  return typeof value === 'string' && (VALID_FORMATS as string[]).includes(value)
    ? (value as ExportFormat)
    : 'json';
}

exportApi.post('/', async (c) => {
  await requireModerator();
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const request = {
    kind: asKind(body.kind),
    format: asFormat(body.format),
    ...(typeof body.range === 'string' ? { range: body.range } : {}),
  };
  const token = crypto.randomUUID();
  await redis.hSet(redisKeys.exportMeta(token), {
    request: JSON.stringify(request),
    createdAt: String(Date.now()),
    chunks: '0',
  });
  await scheduler.runJob({
    name: 'export-chunk',
    runAt: new Date(),
    data: { token, request },
  });
  return c.json({
    ok: true,
    token,
    cursor: '0',
    format: request.format,
  });
});

exportApi.get('/:token', async (c) => {
  await requireModerator();
  const token = c.req.param('token');
  const cursor = Number(c.req.query('cursor') ?? 0);
  const meta = await redis.hGetAll(redisKeys.exportMeta(token));
  const completed = Boolean(meta.completedAt);
  const totalChunks = numberFrom(meta.chunks);
  const chunk = await redis.get(redisKeys.exportChunk(token, cursor));
  if (chunk == null) {
    return c.json({
      ok: true,
      token,
      body: '',
      format: (meta.format as ExportFormat) || 'json',
      done: completed,
      pending: !completed,
    });
  }
  const nextCursor = cursor + 1;
  const done = completed && nextCursor >= totalChunks;
  return c.json({
    ok: true,
    token,
    body: chunk,
    format: (meta.format as ExportFormat) || 'json',
    done,
    ...(done ? {} : { nextCursor: String(nextCursor) }),
  });
});
