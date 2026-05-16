import { Hono } from 'hono';
import { buildInsights } from '../../server/modlog';
import { requireModerator } from '../../server/modAuth';
import type { InsightRange } from '../../shared/types';

export const modlogApi = new Hono();

function parseRange(value: string | undefined): InsightRange {
  return value === '7d' || value === '90d' ? value : '30d';
}

modlogApi.get('/insights', async (c) => {
  await requireModerator();
  return c.json(await buildInsights(parseRange(c.req.query('range'))));
});
