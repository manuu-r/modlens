import { Hono } from 'hono';
import { decideItem, listBucket } from '../../server/triage';
import { requireModerator } from '../../server/modAuth';
import type { TriageBucket, TriageDecision } from '../../shared/types';

export const triageApi = new Hono();

function parseBucket(value: string | undefined): TriageBucket {
  return value === 'aged' || value === 'normal' ? value : 'high';
}

function parseDecision(value: unknown): TriageDecision {
  return value === 'remove' || value === 'ignore' ? value : 'approve';
}

triageApi.get('/', async (c) => {
  await requireModerator();
  const bucket = parseBucket(c.req.query('bucket'));
  const limit = Number(c.req.query('limit') ?? 25);
  const result = await listBucket(bucket, c.req.query('cursor'), limit);
  return c.json({ bucket, ...result });
});

triageApi.post('/:thingId/decision', async (c) => {
  const moderator = await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const decision = parseDecision(body.action);
  const item = await decideItem(c.req.param('thingId'), decision, moderator.user);
  return c.json({ item, decision });
});
