import { Hono } from 'hono';
import { getConfig, listRecentAlerts, saveConfig, testAlert } from '../../server/alerts';
import { requireModerator } from '../../server/modAuth';
import type { AlertConfig } from '../../shared/types';

export const alertsApi = new Hono();

alertsApi.get('/config', async (c) => {
  await requireModerator();
  return c.json({ config: await getConfig() });
});

alertsApi.post('/config', async (c) => {
  await requireModerator();
  const body = await c.req.json<Record<string, unknown>>();
  const config = (body.config && typeof body.config === 'object' ? body.config : body) as AlertConfig;
  return c.json({ config: await saveConfig(config) });
});

alertsApi.get('/test', async (c) => {
  await requireModerator();
  return c.json({ delivered: true, targets: await testAlert() });
});

alertsApi.get('/recent', async (c) => {
  await requireModerator();
  const limit = Number(c.req.query('limit') ?? 25);
  return c.json({ alerts: await listRecentAlerts(limit) });
});
