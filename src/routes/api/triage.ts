import { Hono } from 'hono';
import { decideItem, listBucket } from '../../server/triage';
import { requireModerator } from '../../server/modAuth';
import type { TriageBucket, TriageDecision } from '../../shared/types';
import { claimItem, releaseItem } from '../../server/presence';

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
  const thingId = c.req.param('thingId');
  const claim = await claimItem(thingId, moderator.user);
  if (!claim.claimed) {
    return c.json({ message: `This item is being reviewed by u/${claim.modName}.` }, 409);
  }
  try {
    const item = await decideItem(thingId, decision, moderator.user);
    return c.json({ item, decision });
  } finally {
    await releaseItem(thingId, moderator.user);
  }
});
