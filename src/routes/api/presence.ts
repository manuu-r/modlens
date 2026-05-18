import { Hono } from 'hono';
import { claimItem, getPresenceBatch, releaseItem, touchItem } from '../../server/presence';
import { requireModerator } from '../../server/modAuth';

export const presenceApi = new Hono();

presenceApi.post('/:itemId/claim', async (c) => {
  const mod = await requireModerator();
  return c.json(await claimItem(c.req.param('itemId'), mod.user));
});

presenceApi.post('/:itemId/touch', async (c) => {
  const mod = await requireModerator();
  await touchItem(c.req.param('itemId'), mod.user);
  return c.json({ ok: true });
});

presenceApi.delete('/:itemId/claim', async (c) => {
  const mod = await requireModerator();
  await releaseItem(c.req.param('itemId'), mod.user);
  return c.json({ released: true });
});

presenceApi.post('/batch', async (c) => {
  await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return c.json({ presence: await getPresenceBatch(ids) });
});
