import { Hono } from 'hono';
import { applyReason, createReason, deleteReason, listReasons } from '../../server/removalReasons';
import { requireModerator } from '../../server/modAuth';
import { getItem } from '../../server/triage';
import { claimItem, releaseItem } from '../../server/presence';

export const removalReasonsApi = new Hono();

removalReasonsApi.get('/', async (c) => {
  await requireModerator();
  return c.json({ reasons: await listReasons() });
});

removalReasonsApi.post('/', async (c) => {
  const mod = await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const title = typeof body.title === 'string' ? body.title : '';
  const bodyTemplate = typeof body.bodyTemplate === 'string' ? body.bodyTemplate : '';
  const autoComment = body.autoComment === true;
  const dmUser = body.dmUser === true;
  if (!title || !bodyTemplate) {
    return c.json({ error: 'title and bodyTemplate are required' }, 400);
  }
  const reason = await createReason({ title, bodyTemplate, autoComment, dmUser }, mod.user);
  return c.json({ reason });
});

removalReasonsApi.delete('/:id', async (c) => {
  const mod = await requireModerator();
  await deleteReason(c.req.param('id'), mod.user);
  return c.json({ deleted: true, ok: true });
});

removalReasonsApi.post('/:id/apply', async (c) => {
  const mod = await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const thingId = typeof body.thingId === 'string' ? body.thingId : '';
  if (!thingId) {
    return c.json({ error: 'thingId is required' }, 400);
  }
  const claim = await claimItem(thingId, mod.user);
  if (!claim.claimed) {
    return c.json({ message: `This item is being reviewed by u/${claim.modName}.` }, 409);
  }
  const item = await getItem(thingId);
  try {
    await applyReason(
      {
        reasonId: c.req.param('id'),
        thingId,
        author: item?.author ?? (typeof body.author === 'string' ? body.author : ''),
        title: item?.title ?? (typeof body.title === 'string' ? body.title : undefined),
      },
      mod.user,
    );
    return c.json({ applied: true });
  } finally {
    await releaseItem(thingId, mod.user);
  }
});
