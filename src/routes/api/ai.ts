import { Hono } from 'hono';
import { getTriageContext } from '../../server/contextSummary';
import { getTriageMicroInsight } from '../../server/microInsights';
import { requireModerator } from '../../server/modAuth';

export const aiApi = new Hono();

aiApi.get('/triage/:thingId', async (c) => {
  await requireModerator();
  const insight = await getTriageMicroInsight(c.req.param('thingId'));
  if (!insight) {
    return c.json({ message: 'Triage item not found.' }, 404);
  }
  return c.json({ insight });
});

aiApi.get('/triage/:thingId/context', async (c) => {
  await requireModerator();
  const summary = await getTriageContext(c.req.param('thingId'));
  if (!summary) {
    return c.json({ message: 'Triage item not found.' }, 404);
  }
  return c.json({ summary });
});
