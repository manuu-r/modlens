import { redis, settings } from '@devvit/web/server';
import type { AlertConfig, AlertLinks, AlertRecord, JsonObject, JsonValue, TriageItem } from '../shared/types';
import { decode, encode } from './json';
import { normalizeHost, redisKeys } from './redisKeys';

const RECENT_ALERTS_LIMIT = 100;

function buildLinksFromItem(item: TriageItem, domainTag?: string): AlertLinks {
  const links: AlertLinks = {
    queue: `#/triage/${item.bucket}`,
    author: `#/users/${encodeURIComponent(item.author)}`,
  };
  if (item.url) {
    const host = normalizeHost(item.url);
    if (host) {
      links.site = `#/sites/${encodeURIComponent(host)}`;
    }
  }
  void domainTag;
  return links;
}

const defaultConfig: AlertConfig = {
  highBacklogThreshold: 25,
  enabledTypes: [
    'queue_backlog_high',
    'repeat_offender',
    'bad_domain',
    'pattern.author_site_repeats',
    'pattern.new_account_cluster',
    'pattern.site_spike',
    'edited_link_added',
    'modmail_new',
  ],
};

export type AlertType =
  | 'queue_backlog_high'
  | 'repeat_offender'
  | 'bad_domain'
  | 'edited_link_added'
  | 'modmail_new'
  | 'pattern.author_site_repeats'
  | 'pattern.new_account_cluster'
  | 'pattern.site_spike'
  | 'test';

export async function getConfig(): Promise<AlertConfig> {
  const saved = decode<Partial<AlertConfig> | null>(
    await redis.hGet(redisKeys.alertConfig(), 'config'),
    null,
  );
  const discordWebhookUrl = (await settings.get<string>('discordWebhookUrl')) || '';
  const slackWebhookUrl = (await settings.get<string>('slackWebhookUrl')) || '';
  const customWebhookUrl = (await settings.get<string>('customWebhookUrl')) || '';
  const threshold =
    saved?.highBacklogThreshold ??
    (await settings.get<number>('highBacklogThreshold')) ??
    defaultConfig.highBacklogThreshold;
  const enabledTypes = Array.isArray(saved?.enabledTypes)
    ? saved.enabledTypes.filter((type): type is string => typeof type === 'string')
    : defaultConfig.enabledTypes;
  return {
    ...defaultConfig,
    highBacklogThreshold: threshold,
    enabledTypes,
    ...(discordWebhookUrl ? { discordWebhookUrl } : {}),
    ...(slackWebhookUrl ? { slackWebhookUrl } : {}),
    ...(customWebhookUrl ? { customWebhookUrl } : {}),
  };
}

export async function saveConfig(config: AlertConfig): Promise<AlertConfig> {
  await redis.hSet(redisKeys.alertConfig(), { config: JSON.stringify(config) });
  return config;
}

export async function rateLimit(type: string, date = new Date()): Promise<boolean> {
  const bucket = date.toISOString().slice(0, 13);
  const key = redisKeys.alertRate(type, bucket);
  const result = await redis.set(key, '1', { nx: true });
  if (result !== 'OK') {
    return false;
  }
  await redis.expire(key, 3600);
  return true;
}

async function postJson(url: string, body: JsonObject): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (error) {
    console.warn(`Alert webhook to ${url} failed`, error);
    return false;
  }
}

function linkFields(links: AlertLinks): Array<{ name: string; value: string; inline?: boolean }> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (links.queue) fields.push({ name: 'Queue', value: links.queue, inline: true });
  if (links.author) fields.push({ name: 'Author', value: links.author, inline: true });
  if (links.site) fields.push({ name: 'Site', value: links.site, inline: true });
  if (links.item) fields.push({ name: 'Item', value: links.item, inline: true });
  return fields;
}

function discordBody(type: string, payload: JsonObject, links: AlertLinks): JsonObject {
  const fields = linkFields(links).map((f) => ({ ...f })) as unknown as JsonValue;
  return {
    embeds: [
      {
        title: `ModLens: ${type}`,
        description: '```json\n' + JSON.stringify(payload, null, 2).slice(0, 1600) + '\n```',
        fields,
        color: type === 'queue_backlog_high' || type === 'repeat_offender' ? 0xff5555 : 0xffaa00,
      },
    ],
  };
}

function slackBody(type: string, payload: JsonObject, links: AlertLinks): JsonObject {
  const linkLine = linkFields(links)
    .map((f) => `*${f.name}:* \`${f.value}\``)
    .join('  ');
  return {
    text: `ModLens: ${type}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*ModLens*: ${type}${linkLine ? `\n${linkLine}` : ''}\n\`\`\`${JSON.stringify(payload, null, 2).slice(0, 2400)}\`\`\``,
        },
      },
    ],
  };
}

async function recordAlert(type: string, payload: JsonObject, links: AlertLinks, delivered: string[]): Promise<void> {
  const record: AlertRecord = {
    id: `alert_${crypto.randomUUID()}`,
    type,
    ts: Date.now(),
    payload,
    links,
    delivered,
  };
  await redis.hSet(redisKeys.alertRecord(record.id), { record: encode(record) });
  await redis.zAdd(redisKeys.alertsRecent(), { member: record.id, score: record.ts });

  const total = await redis.zCard(redisKeys.alertsRecent());
  if (total > RECENT_ALERTS_LIMIT) {
    const overflow = total - RECENT_ALERTS_LIMIT;
    const oldest = await redis.zRange(redisKeys.alertsRecent(), 0, overflow - 1, { by: 'rank' });
    if (oldest.length > 0) {
      const ids = oldest.map((row) => row.member);
      await redis.zRem(redisKeys.alertsRecent(), ids);
      for (const id of ids) {
        await redis.del(redisKeys.alertRecord(id));
      }
    }
  }
}

export async function listRecentAlerts(limit = 25): Promise<AlertRecord[]> {
  const rows = await redis.zRange(redisKeys.alertsRecent(), 0, Math.max(limit - 1, 0), {
    by: 'rank',
    reverse: true,
  });
  const out: AlertRecord[] = [];
  for (const row of rows) {
    const raw = await redis.hGet(redisKeys.alertRecord(row.member), 'record');
    const record = decode<AlertRecord | null>(raw, null);
    if (record) out.push(record);
  }
  return out;
}

export async function fireAlert(
  type: AlertType | string,
  payload: JsonObject,
  links: AlertLinks = {},
): Promise<string[]> {
  const bypassRateLimit = type === 'modmail_new';
  if (!bypassRateLimit && !(await rateLimit(type))) {
    return [];
  }
  const config = await getConfig();
  if (type !== 'test' && !config.enabledTypes.includes(type)) {
    return [];
  }
  const payloadWithLinks: JsonObject = { ...payload, links: links as unknown as JsonValue };
  const sent: string[] = [];
  if (config.discordWebhookUrl) {
    if (await postJson(config.discordWebhookUrl, discordBody(type, payloadWithLinks, links))) sent.push('discord');
  }
  if (config.slackWebhookUrl) {
    if (await postJson(config.slackWebhookUrl, slackBody(type, payloadWithLinks, links))) sent.push('slack');
  }
  if (config.customWebhookUrl) {
    if (await postJson(config.customWebhookUrl, { type, payload: payloadWithLinks } as JsonObject)) sent.push('custom');
  }
  await recordAlert(type, payloadWithLinks, links, sent);
  return sent;
}

export async function testAlert(): Promise<string[]> {
  return fireAlert('test', { message: 'ModLens test alert', ts: Date.now() }, {});
}

export function validateWebhookUrl(
  value: string,
): { ok: true; warning?: string } | { ok: false; error: string } {
  if (!value.trim()) {
    return { ok: true };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return { ok: false, error: 'Webhook URL must use https.' };
    }
    const allowlisted = ['discord.com', 'discordapp.com', 'slack.com', 'hooks.slack.com'];
    if (!allowlisted.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      return {
        ok: true,
        warning:
          'Custom domains must be added to devvit.json permissions.http.domains before dispatch works.',
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Webhook URL is invalid.' };
  }
}

// Item-arrival evaluator — call from trigger paths after enqueueItem.
export async function evaluateItemForAlerts(
  item: TriageItem,
  authorSummary?: { lastLabel?: string; spamCount?: number; removalCount?: number },
  domainTag?: string,
): Promise<void> {
  const reasons: JsonValue[] = [];
  if (
    authorSummary &&
    (authorSummary.lastLabel === 'Spammer' ||
      authorSummary.lastLabel === 'BanEvasion' ||
      (authorSummary.removalCount ?? 0) >= 5)
  ) {
    reasons.push('repeat-offender author');
  }
  const isBadDomain = domainTag === 'spammy' || domainTag === 'scam';

  const links = buildLinksFromItem(item, domainTag);

  if (reasons.length > 0 && item.bucket === 'high') {
    await fireAlert(
      'repeat_offender',
      {
        thingId: item.thingId,
        author: item.author,
        bucket: item.bucket,
        score: item.score,
        reasons: [...reasons, ...(item.reasons as unknown as JsonValue[])],
        url: item.url ?? null,
      },
      links,
    );
  }
  if (isBadDomain) {
    await fireAlert(
      'bad_domain',
      {
        thingId: item.thingId,
        author: item.author,
        url: item.url ?? null,
        tag: domainTag ?? null,
      },
      links,
    );
  }
}
