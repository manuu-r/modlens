import { Hono } from 'hono';
import { createItemNote, deleteItemNote, listItemNotes } from '../../server/itemNotes';
import { requireModerator } from '../../server/modAuth';
import type { ThingKind } from '../../shared/types';

export const itemApi = new Hono();

function parseKind(value: unknown): ThingKind {
  return value === 'comment' ? 'comment' : 'post';
}

itemApi.get('/:thingId/notes', async (c) => {
  await requireModerator();
  return c.json({ notes: await listItemNotes(c.req.param('thingId')) });
});

itemApi.post('/:thingId/notes', async (c) => {
  const moderator = await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return c.json({ message: 'Note text is required.' }, 400);
  }
  const refUrl = typeof body.refUrl === 'string' && body.refUrl.trim() ? body.refUrl.trim() : undefined;
  const note = await createItemNote(
    {
      thingId: c.req.param('thingId'),
      kind: parseKind(body.kind),
      text,
      ...(refUrl ? { refUrl } : {}),
    },
    moderator.user,
  );
  return c.json({ note });
});

itemApi.delete('/:thingId/notes/:id', async (c) => {
  const moderator = await requireModerator();
  await deleteItemNote(c.req.param('thingId'), c.req.param('id'), moderator.user);
  return c.json({ deleted: true, ok: true });
});
