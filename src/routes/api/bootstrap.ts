import { Hono } from 'hono';
import { context, redis, settings } from '@devvit/web/server';
import type { NavigationIntent } from '../../shared/types';
import { decode } from '../../server/json';
import { requireModerator } from '../../server/modAuth';
import { redisKeys } from '../../server/redisKeys';
import { getConfig } from '../../server/alerts';

export const bootstrapApi = new Hono();
const NAVIGATION_INTENT_MAX_AGE_MS = 2 * 60 * 1000;

function isFreshNavigationIntent(intent: NavigationIntent | null): intent is NavigationIntent {
  return Boolean(
    intent &&
      intent.hash.startsWith('#/') &&
      Number.isFinite(intent.issuedAt) &&
      Date.now() - intent.issuedAt <= NAVIGATION_INTENT_MAX_AGE_MS
  );
}

bootstrapApi.get('/', async (c) => {
  const moderator = await requireModerator();
  const navigationIntentKey = redisKeys.navigationIntent(moderator.user);
  const rawNavigationIntent = await redis.get(navigationIntentKey);
  if (rawNavigationIntent) {
    await redis.del(navigationIntentKey);
  }
  const navigationIntent = decode<NavigationIntent | null>(rawNavigationIntent, null);
  const features = (await settings.get<string[]>('enabledFeatures')) ?? [
    'triage',
    'domains',
    'alerts',
    'insights',
  ];
  const alertConfig = await getConfig();
  return c.json({
    subreddit: context.subredditName ?? '',
    subredditName: context.subredditName ?? '',
    viewerName: moderator.user,
    isModerator: true,
    modPerms: moderator.modPerms,
    features,
    featureFlags: Object.fromEntries(features.map((feature) => [feature, true])),
    dashboardPostId: await redis.get(redisKeys.dashboardPostId()),
    version: '1.0.0',
    ...(isFreshNavigationIntent(navigationIntent) ? { navigationIntent } : {}),
    alerts: {
      configured: Boolean(
        alertConfig.discordWebhookUrl ||
          alertConfig.slackWebhookUrl ||
          alertConfig.customWebhookUrl
      ),
      highBacklogThreshold: alertConfig.highBacklogThreshold,
    },
    ai: {
      microInsightsEnabled: (await settings.get<boolean>('aiMicroInsightsEnabled')) ?? true,
      geminiConfigured: Boolean((await settings.get<string>('geminiApiKey'))?.trim()),
      model: (await settings.get<string>('geminiModel')) || 'gemini-2.5-flash',
    },
  });
});
