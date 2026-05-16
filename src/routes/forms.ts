import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { isT1, isT3 } from '@devvit/shared-types/tid.js';
import { isDomainTag } from '../shared/tags';
import { isUserNoteLabel } from '../shared/labels';
import { tagDomain } from '../server/domains';
import { requireModerator } from '../server/modAuth';
import { createNote } from '../server/notes';
import { saveRule } from '../server/rules';
import { saveConfig } from '../server/alerts';
import type { AlertConfig, Condition, ConditionOp, RuleConfig, TriageBucket } from '../shared/types';
import { CONDITION_OPS } from '../shared/types';

export const forms = new Hono();

const firstString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
};

const firstNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0];
  const parsed = Number(firstString(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};

async function resolveUsername(value: string): Promise<string> {
  if (isT3(value)) {
    const post = await reddit.getPostById(value);
    return post.authorName;
  }
  if (isT1(value)) {
    const comment = await reddit.getCommentById(value);
    return comment.authorName;
  }
  return value.replace(/^u\//i, '').trim();
}

forms.post('/add-note', async (c) => {
  const moderator = await requireModerator();
  const values = await c.req.json<Record<string, unknown>>();
  const labelValue = firstString(values.label);
  const label = labelValue && isUserNoteLabel(labelValue) ? labelValue : 'Watch';
  const target = await resolveUsername(firstString(values.target) ?? firstString(values.name) ?? '');
  const text = firstString(values.text) ?? '';
  const refUrl = firstString(values.refUrl);
  if (!target) {
    return c.json<UiResponse>({ showToast: 'ModLens note failed: missing username.' });
  }
  await createNote(target, { label, text, ...(refUrl ? { refUrl } : {}) }, moderator.user);
  return c.json<UiResponse>({
    showToast: { text: `Note saved for u/${target}.`, appearance: 'success' },
  });
});

forms.post('/tag-domain', async (c) => {
  const moderator = await requireModerator();
  const values = await c.req.json<Record<string, unknown>>();
  const host = firstString(values.host) ?? '';
  const tagValue = firstString(values.tag);
  const tag = tagValue && isDomainTag(tagValue) ? tagValue : 'watchlist';
  const notes = firstString(values.notes);
  const domain = await tagDomain(host, { tag, ...(notes ? { notes } : {}) }, moderator.user);
  return c.json<UiResponse>({
    showToast: { text: `Site ${domain.host} tagged as ${tag}.`, appearance: 'success' },
  });
});

forms.post('/rule-builder', async (c) => {
  const moderator = await requireModerator();
  const values = await c.req.json<Record<string, unknown>>();

  const name = firstString(values.name)?.trim() ?? 'New rule';
  const priority = firstNumber(values.priority) ?? 50;
  const factPath = firstString(values.fact) ?? 'account.ageDays';
  const opValue = firstString(values.op) ?? '<';
  const rawValue = firstString(values.value) ?? '7';

  const numericValue = Number(rawValue);
  const op: ConditionOp = (CONDITION_OPS as readonly string[]).includes(opValue)
    ? (opValue as ConditionOp)
    : '<';
  const conditions: Condition[] = [
    {
      fact: factPath,
      op,
      value: Number.isFinite(numericValue) && rawValue.trim() !== '' ? numericValue : rawValue,
    },
  ];

  const bucketRaw = firstString(values.bucket);
  const bucket: TriageBucket | undefined =
    bucketRaw === 'high' || bucketRaw === 'aged' || bucketRaw === 'normal' ? bucketRaw : undefined;
  const scoreDelta = firstNumber(values.scoreDelta) ?? 20;
  const reason = firstString(values.reason) ?? name;

  const rule: RuleConfig = {
    id: firstString(values.id) ?? `rule_${crypto.randomUUID().slice(0, 8)}`,
    name,
    priority,
    when: { all: conditions },
    then: {
      scoreDelta,
      reason,
      ...(bucket ? { bucket } : {}),
    },
  };

  await saveRule(rule);
  console.info(`Rule saved by ${moderator.user}: ${rule.id}`);
  return c.json<UiResponse>({
    showToast: { text: `Rule "${name}" saved.`, appearance: 'success' },
  });
});

forms.post('/alert-config', async (c) => {
  const moderator = await requireModerator();
  const values = await c.req.json<Record<string, unknown>>();

  const enabled = Array.isArray(values.enabledTypes)
    ? values.enabledTypes.filter((t): t is string => typeof t === 'string')
    : ['queue_backlog_high', 'repeat_offender', 'bad_domain'];
  const threshold = firstNumber(values.highBacklogThreshold) ?? 25;

  const config: AlertConfig = {
    enabledTypes: enabled,
    highBacklogThreshold: threshold,
  };
  await saveConfig(config);
  console.info(`Alert config saved by ${moderator.user}`);
  return c.json<UiResponse>({
    showToast: { text: 'Alert settings saved.', appearance: 'success' },
  });
});
