import { Hono } from 'hono';
import { list } from '../../server/audit';
import { requireModerator } from '../../server/modAuth';

export const auditApi = new Hono();

auditApi.get('/', async (c) => {
  await requireModerator();
  const cursor = c.req.query('cursor');
  const actor = c.req.query('actor');
  const action = c.req.query('action');
  const target = c.req.query('target');
  const site = c.req.query('site');
  return c.json(
    await list({
      ...(cursor ? { cursor } : {}),
      ...(actor ? { actor } : {}),
      ...(action ? { action } : {}),
      ...(target ? { target } : {}),
      ...(site ? { site } : {}),
      limit: Number(c.req.query('limit') ?? 50),
    })
  );
});
