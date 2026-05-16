import { Hono } from 'hono';
import type { SettingsValidationRequest, SettingsValidationResponse } from '@devvit/web/shared';
import { validateWebhookUrl } from '../server/alerts';

export const settingsRoutes = new Hono();

settingsRoutes.post('/validate-webhook', async (c) => {
  const input = await c.req.json<SettingsValidationRequest<string>>();
  const result = validateWebhookUrl(input.value ?? '');
  if (!result.ok) {
    return c.json<SettingsValidationResponse>({ success: false, error: result.error });
  }
  return c.json<SettingsValidationResponse>({ success: true });
});
