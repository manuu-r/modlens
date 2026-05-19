import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { context, reddit, redis, settings } from '@devvit/web/server';
import { isT1, isT3, type T3 } from '@devvit/shared-types/tid.js';
import type { NavigationIntent } from '../shared/types';
import { encode } from '../server/json';
import { requireModerator } from '../server/modAuth';
import { redisKeys } from '../server/redisKeys';
import { canOpenAuthorContext, resolveRedditUsername } from '../server/userIdentity';

export const menu = new Hono();
const NAVIGATION_INTENT_TTL_MS = 2 * 60 * 1000;
const DEV_SEED_SETTING = 'modlensDevSeedActionsEnabled';

async function devSeedActionsEnabled(): Promise<boolean> {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.MODLENS_ENABLE_DEV_SEED === 'true'
  ) {
    return true;
  }
  return (await settings.get<boolean>(DEV_SEED_SETTING)) === true;
}

async function requireDevSeedAccess(): Promise<UiResponse | null> {
  await requireModerator();
  if (await devSeedActionsEnabled()) {
    return null;
  }
  return {
    showToast:
      'Dev seed actions are disabled for this build. Set MODLENS_ENABLE_DEV_SEED=true in a development environment to enable them.',
  };
}

async function ensureModLensPost(): Promise<{ id: string; url: string }> {
  const existing = await redis.get(redisKeys.dashboardPostId());
  if (existing) {
    const post = await reddit.getPostById(existing as T3);
    return { id: post.id, url: post.url };
  }
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error('Missing subreddit context.');
  }
  const post = await reddit.submitCustomPost({
    subredditName,
    title: 'ModLens queue',
    entry: 'default',
    postData: { version: 1 },
    textFallback: { text: 'Open ModLens queue in a supported Reddit client.' },
  });
  await redis.set(redisKeys.dashboardPostId(), post.id);
  return { id: post.id, url: post.url };
}

function withAppPath(url: string, hashPath: string): string {
  return `${url.split('#')[0]}${hashPath}`;
}

async function getTargetAuthor(targetId: string): Promise<string> {
  if (isT3(targetId)) {
    const post = await reddit.getPostById(targetId);
    return resolveRedditUsername(post.authorName, post.authorId);
  }
  if (isT1(targetId)) {
    const comment = await reddit.getCommentById(targetId);
    return resolveRedditUsername(comment.authorName, comment.authorId);
  }
  return targetId;
}

async function rememberNavigationIntent(viewer: string, intent: Omit<NavigationIntent, 'issuedAt'>): Promise<void> {
  await redis.set(
    redisKeys.navigationIntent(viewer),
    encode({
      ...intent,
      issuedAt: Date.now(),
    }),
    { expiration: new Date(Date.now() + NAVIGATION_INTENT_TTL_MS) }
  );
}

async function getTargetUrl(targetId: string): Promise<string> {
  if (isT3(targetId)) {
    const post = await reddit.getPostById(targetId);
    return post.url;
  }
  if (isT1(targetId)) {
    const comment = await reddit.getCommentById(targetId);
    return comment.url;
  }
  return targetId;
}

menu.post('/open-queue', async (c) => {
  const moderator = await requireModerator();
  const post = await ensureModLensPost();
  await rememberNavigationIntent(moderator.user, { hash: '#/triage/high', source: 'menu.openQueue' });
  return c.json<UiResponse>({ navigateTo: { url: withAppPath(post.url, '#/triage/high') } });
});

menu.post('/open-dashboard', async (c) => {
  const moderator = await requireModerator();
  const post = await ensureModLensPost();
  await rememberNavigationIntent(moderator.user, { hash: '#/triage/high', source: 'menu.openQueue' });
  return c.json<UiResponse>({ navigateTo: { url: withAppPath(post.url, '#/triage/high') } });
});

menu.post('/user-context', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const moderator = await requireModerator();
  const author = await getTargetAuthor(request.targetId);
  if (!canOpenAuthorContext(author)) {
    return c.json<UiResponse>({
      showToast: 'ModLens could not identify an active author for this item.',
    });
  }
  const post = await ensureModLensPost();
  const hash = `#/users/${encodeURIComponent(author)}`;
  await rememberNavigationIntent(moderator.user, {
    hash,
    focusedUser: author,
    source: 'menu.userContext',
  });
  return c.json<UiResponse>({
    navigateTo: { url: withAppPath(post.url, hash) },
    showToast: `Opening ModLens context for u/${author}.`,
  });
});

menu.post('/add-note', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const author = await getTargetAuthor(request.targetId);
  return c.json<UiResponse>({
    showForm: {
      name: 'modlens_note',
      form: {
        title: 'ModLens: Add author note',
        description: 'Save a shared note on this author with this post or comment as the reference.',
        acceptLabel: 'Save note',
        fields: [
          { name: 'target', label: 'Author', type: 'string', defaultValue: author, required: true },
          { name: 'refUrl', label: 'Reference item', type: 'string', defaultValue: request.targetId, disabled: true },
          {
            name: 'label',
            label: 'Label',
            type: 'select',
            options: [
              { label: 'Spammer', value: 'Spammer' },
              { label: 'Warned', value: 'Warned' },
              { label: 'Trusted', value: 'Trusted' },
              { label: 'Watch', value: 'Watch' },
              { label: 'Ban evasion', value: 'BanEvasion' },
            ],
            defaultValue: ['Watch'],
            required: true,
          },
          { name: 'text', label: 'Note', type: 'paragraph', required: true },
        ],
      },
    },
  });
});

menu.post('/add-item-note', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  await requireModerator();
  const kind = isT1(request.targetId) ? 'comment' : 'post';
  const refUrl = await getTargetUrl(request.targetId).catch(() => request.targetId);
  return c.json<UiResponse>({
    showForm: {
      name: 'modlens_item_note',
      form: {
        title: 'ModLens: Add item note',
        description: 'Save hidden context on this post or comment for other moderators.',
        acceptLabel: 'Save note',
        fields: [
          { name: 'thingId', label: 'Item', type: 'string', defaultValue: request.targetId, disabled: true },
          { name: 'kind', label: 'Kind', type: 'string', defaultValue: kind, disabled: true },
          { name: 'refUrl', label: 'Reference', type: 'string', defaultValue: refUrl, disabled: true },
          { name: 'text', label: 'Note', type: 'paragraph', required: true },
        ],
      },
    },
  });
});

menu.post('/new-rule', async (c) => {
  return c.json<UiResponse>({
    showForm: {
      name: 'modlens_rule',
      form: {
        title: 'ModLens: Create risk rule',
        description: 'Raise queue priority when account, user, site, or report signals match.',
        acceptLabel: 'Save rule',
        fields: [
          { name: 'name', label: 'Rule name', type: 'string', required: true, defaultValue: 'New rule' },
          { name: 'priority', label: 'Priority (lower runs first)', type: 'number', defaultValue: 50 },
          {
            name: 'fact',
            label: 'Fact',
            type: 'select',
            options: [
              { label: 'Account age (days)', value: 'account.ageDays' },
              { label: 'Comment karma', value: 'account.commentKarma' },
              { label: 'Link karma', value: 'account.linkKarma' },
              { label: 'Verified email', value: 'account.hasVerifiedEmail' },
              { label: "User's prior removals", value: 'user.summary.removalCount' },
              { label: "User's spam notes", value: 'user.summary.spamCount' },
              { label: 'Site tag', value: 'post.domain.tag' },
              { label: 'Site removals', value: 'post.domain.removedCount' },
              { label: 'Reports on item', value: 'item.reports' },
            ],
            defaultValue: ['account.ageDays'],
            required: true,
          },
          {
            name: 'op',
            label: 'Operator',
            type: 'select',
            options: [
              { label: 'less than', value: '<' },
              { label: 'less or equal', value: '<=' },
              { label: 'equal', value: '==' },
              { label: 'not equal', value: '!=' },
              { label: 'greater or equal', value: '>=' },
              { label: 'greater than', value: '>' },
              { label: 'in (comma list)', value: 'in' },
              { label: 'not in (comma list)', value: 'notIn' },
            ],
            defaultValue: ['<'],
            required: true,
          },
          { name: 'value', label: 'Value', type: 'string', required: true, defaultValue: '7' },
          { name: 'scoreDelta', label: 'Score delta on match', type: 'number', defaultValue: 25 },
          {
            name: 'bucket',
            label: 'Force bucket (optional)',
            type: 'select',
            options: [
              { label: '(no override)', value: '' },
              { label: 'High', value: 'high' },
              { label: 'Aged', value: 'aged' },
              { label: 'Normal', value: 'normal' },
            ],
            defaultValue: [''],
          },
          { name: 'reason', label: 'Reason text', type: 'string', required: true, defaultValue: 'risk rule' },
        ],
      },
    },
  });
});

menu.post('/alert-config', async (c) => {
  return c.json<UiResponse>({
    showForm: {
      name: 'modlens_alerts',
      form: {
        title: 'ModLens: Configure alerts',
        description: 'Send only high-signal alerts for queue backlog, repeat offenders, and bad sites.',
        acceptLabel: 'Save',
        fields: [
          {
            name: 'highBacklogThreshold',
            label: 'High-risk backlog threshold',
            type: 'number',
            defaultValue: 25,
          },
          {
            name: 'enabledTypes',
            label: 'Enabled alert types',
            type: 'select',
            options: [
              { label: 'Queue backlog high', value: 'queue_backlog_high' },
              { label: 'Repeat offender entering queue', value: 'repeat_offender' },
              { label: 'Bad site entering queue', value: 'bad_domain' },
              { label: 'Edited item added link', value: 'edited_link_added' },
              { label: 'New modmail', value: 'modmail_new' },
            ],
            defaultValue: ['queue_backlog_high', 'repeat_offender', 'bad_domain', 'edited_link_added', 'modmail_new'],
            multiSelect: true,
          },
        ],
      },
    },
  });
});

menu.post('/tag-domain', async (c) => {
  const request = await c.req.json<MenuItemRequest>();
  const url = await getTargetUrl(request.targetId);
  return c.json<UiResponse>({
    showForm: {
      name: 'modlens_domain',
      form: {
        title: 'ModLens: Tag linked site',
        description: 'Save a site tag for this post URL so future queue items show the same context.',
        acceptLabel: 'Save tag',
        fields: [
          { name: 'host', label: 'Site or URL', type: 'string', defaultValue: url, required: true },
          {
            name: 'tag',
            label: 'Tag',
            type: 'select',
            options: [
              { label: 'Trusted', value: 'trusted' },
              { label: 'Watchlist', value: 'watchlist' },
              { label: 'Spammy', value: 'spammy' },
              { label: 'Scam', value: 'scam' },
            ],
            defaultValue: ['watchlist'],
            required: true,
          },
          { name: 'notes', label: 'Notes', type: 'paragraph' },
        ],
      },
    },
  });
});

menu.post('/dev-seed', async (c) => {
  try {
    const denied = await requireDevSeedAccess();
    if (denied) return c.json<UiResponse>(denied);
    const { seedAll } = await import('../server/seedData.js');
    const counts = await seedAll();
    return c.json<UiResponse>({
      showToast: `Seeded: ${counts.triage} queue items, ${counts.notes} notes, ${counts.domains} domains.`,
    });
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Seed failed: ${String(error)}` });
  }
});

menu.post('/dev-clear', async (c) => {
  try {
    const denied = await requireDevSeedAccess();
    if (denied) return c.json<UiResponse>(denied);
    const { clearSeedData } = await import('../server/seedData.js');
    const result = await clearSeedData();
    return c.json<UiResponse>({
      showToast: `Cleared ${result.removed} seed queue items and associated notes/domains.`,
    });
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Clear failed: ${String(error)}` });
  }
});

menu.post('/dev-status', async (c) => {
  try {
    const denied = await requireDevSeedAccess();
    if (denied) return c.json<UiResponse>(denied);
    const { getSeedCounts } = await import('../server/seedData.js');
    const counts = await getSeedCounts();
    return c.json<UiResponse>({
      showToast: `Seed status: ${counts.triage} queue items, ${counts.notes} notes, ${counts.domains} domains.`,
    });
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Status failed: ${String(error)}` });
  }
});
