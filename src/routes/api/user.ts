import { Hono } from 'hono';
import { isUserNoteLabel } from '../../shared/labels';
import { buildDigest } from '../../server/digest';
import { buildUserPanel, createNote, deleteNote } from '../../server/notes';
import { requireModerator } from '../../server/modAuth';
import { resolveRedditUsername } from '../../server/userIdentity';
import type { DigestWindow } from '../../shared/types';

export const userApi = new Hono();

function parseDigestWindow(value: string | undefined): DigestWindow {
  return value === '7' || value === '90' ? value : '30';
}

userApi.get('/:name/panel', async (c) => {
  await requireModerator();
  return c.json(await buildUserPanel(await resolveRedditUsername(c.req.param('name'))));
});

userApi.get('/:name/digest', async (c) => {
  await requireModerator();
  const name = await resolveRedditUsername(c.req.param('name'));
  return c.json({
    digest: await buildDigest(name, parseDigestWindow(c.req.query('window'))),
  });
});

userApi.post('/:name/notes', async (c) => {
  const moderator = await requireModerator();
  const body = (await c.req.json<Record<string, unknown>>()) as {
    label?: unknown;
    text?: unknown;
    body?: unknown;
    refUrl?: unknown;
  };
  const label = typeof body.label === 'string' && isUserNoteLabel(body.label) ? body.label : 'Watch';
  const text =
    typeof body.text === 'string'
      ? body.text
      : typeof body.body === 'string'
        ? body.body
        : '';
  const refUrl = typeof body.refUrl === 'string' ? body.refUrl : undefined;
  const name = await resolveRedditUsername(c.req.param('name'));
  const note = await createNote(name, { label, text, ...(refUrl ? { refUrl } : {}) }, moderator.user);
  return c.json({ note });
});

userApi.delete('/:name/notes/:id', async (c) => {
  const moderator = await requireModerator();
  const name = await resolveRedditUsername(c.req.param('name'));
  await deleteNote(name, c.req.param('id'), moderator.user);
  return c.json({ deleted: true, ok: true });
});
