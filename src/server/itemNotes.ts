import { redis } from '@devvit/web/server';
import type { ItemNote, ThingKind } from '../shared/types';
import { write as writeAudit } from './audit';
import { decode, encode } from './json';
import { redisKeys } from './redisKeys';

const MAX_ITEM_NOTES = 50;

export async function listItemNotes(thingId: string): Promise<ItemNote[]> {
  const rows = await redis.zRange(redisKeys.itemNoteIds(thingId), 0, MAX_ITEM_NOTES - 1, {
    by: 'rank',
    reverse: true,
  });
  const notes: ItemNote[] = [];
  for (const row of rows) {
    const raw = await redis.hGet(redisKeys.itemNotes(thingId), row.member);
    const note = decode<ItemNote | null>(raw, null);
    if (note) {
      notes.push(note);
    }
  }
  return notes;
}

export async function createItemNote(
  input: {
    thingId: string;
    kind: ThingKind;
    text: string;
    refUrl?: string;
  },
  actor: string
): Promise<ItemNote> {
  const now = Date.now();
  const note: ItemNote = {
    id: `item_note_${crypto.randomUUID()}`,
    thingId: input.thingId,
    kind: input.kind,
    text: input.text,
    authorMod: actor,
    createdAt: now,
    ...(input.refUrl ? { refUrl: input.refUrl } : {}),
  };

  await redis.hSet(redisKeys.itemNotes(input.thingId), { [note.id]: encode(note) });
  await redis.zAdd(redisKeys.itemNoteIds(input.thingId), { member: note.id, score: now });
  await writeAudit({
    actor,
    action: 'item_note.create',
    target: input.thingId,
    after: note,
  });
  return note;
}

export async function deleteItemNote(thingId: string, noteId: string, actor: string): Promise<void> {
  const raw = await redis.hGet(redisKeys.itemNotes(thingId), noteId);
  const note = decode<ItemNote | null>(raw, null);
  await redis.hDel(redisKeys.itemNotes(thingId), [noteId]);
  await redis.zRem(redisKeys.itemNoteIds(thingId), [noteId]);
  await writeAudit({
    actor,
    action: 'item_note.delete',
    target: thingId,
    before: note ?? null,
  });
}
