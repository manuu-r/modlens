import { settings } from '@devvit/web/server';
import type { FactBag, MicroInsight, MicroInsightSeverity, TriageItem } from '../shared/types';
import { memo } from './json';
import { redisKeys } from './redisKeys';
import { buildFacts } from './rules';
import { getItem } from './triage';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_LABEL_CHARS = 18;
const MAX_LINE_CHARS = 70;

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

type RawInsight = {
  label?: unknown;
  line?: unknown;
  severity?: unknown;
};

export async function getTriageMicroInsight(thingId: string): Promise<MicroInsight | null> {
  const item = await getItem(thingId);
  if (!item) {
    return null;
  }

  const facts = await buildFacts(item);
  const fallback = templateTriageInsight(item, facts);
  const enabled = (await settings.get<boolean>('aiMicroInsightsEnabled')) ?? true;
  const apiKey = (await settings.get<string>('geminiApiKey'))?.trim();
  if (!enabled || !apiKey || fallback.severity === 'neutral') {
    return fallback;
  }

  const model = ((await settings.get<string>('geminiModel')) || DEFAULT_GEMINI_MODEL).trim().replace(/^models\//, '');
  const cacheKey = redisKeys.microInsight('triage', item.thingId, fingerprint(item, facts));
  return memo(cacheKey, 60 * 60 * 6, async () => {
    const generated = await generateGeminiInsight(item, facts, apiKey, model).catch(() => null);
    return generated ?? fallback;
  });
}

function templateTriageInsight(item: TriageItem, facts: FactBag): MicroInsight {
  const removals = facts['user.summary.removalCount'];
  const spam = facts['user.summary.spamCount'];
  const siteTag = facts['post.domain.tag'];
  const siteRemovals = facts['post.domain.removedCount'];
  const reportCount = facts['item.reports'];
  const ageDays = facts['account.ageDays'];

  if (removals >= 3 && siteTag) {
    return micro('High risk', `${removals} removals and ${siteTag} site.`, 'high', 'template');
  }

  if (siteTag === 'spammy' || siteTag === 'scam') {
    return micro('Site risk', `${siteTag} site with ${siteRemovals} removals.`, 'high', 'template');
  }

  if (spam > 0) {
    return micro('Watch user', `${spam} spam notes and ${removals} removals.`, 'medium', 'template');
  }

  if (reportCount >= 2) {
    return micro('Reports', `${reportCount} reports on this item.`, 'medium', 'template');
  }

  if (ageDays <= 7 && item.score > 0) {
    return micro('New account', `${ageDays}d old with queue risk.`, 'medium', 'template');
  }

  if (item.reasons.length > 0) {
    return micro('Check', item.reasons.slice(0, 2).join(', '), item.bucket === 'high' ? 'high' : 'medium', 'template');
  }

  return micro('Low concern', 'No notes or removals found.', 'neutral', 'template');
}

async function generateGeminiInsight(
  item: TriageItem,
  facts: FactBag,
  apiKey: string,
  model: string,
): Promise<MicroInsight | null> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(item, facts) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 48,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) {
    return null;
  }

  return parseGeneratedInsight(text);
}

function buildPrompt(item: TriageItem, facts: FactBag): string {
  return [
    'Return JSON only: {"label":"...","line":"...","severity":"high|medium|low|neutral"}.',
    `Label must be ${MAX_LABEL_CHARS} chars max. Line must be ${MAX_LINE_CHARS} chars max.`,
    'Use no usernames, no quotes, no markdown, no paragraphs.',
    'Only summarize these moderation facts:',
    JSON.stringify({
      bucket: item.bucket,
      score: item.score,
      reasons: item.reasons.slice(0, 4),
      reports: facts['item.reports'],
      accountAgeDays: facts['account.ageDays'],
      userRemovals: facts['user.summary.removalCount'],
      userSpamNotes: facts['user.summary.spamCount'],
      siteTag: facts['post.domain.tag'] ?? null,
      siteRemovals: facts['post.domain.removedCount'],
    }),
  ].join('\n');
}

function parseGeneratedInsight(text: string): MicroInsight | null {
  try {
    const parsed = JSON.parse(text) as RawInsight;
    const label = typeof parsed.label === 'string' ? parsed.label : '';
    const line = typeof parsed.line === 'string' ? parsed.line : '';
    const severity = parseSeverity(parsed.severity);
    if (!label || !line) {
      return null;
    }
    return micro(label, line, severity, 'gemini');
  } catch {
    return null;
  }
}

function parseSeverity(value: unknown): MicroInsightSeverity {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'neutral'
    ? value
    : 'neutral';
}

function micro(
  label: string,
  line: string,
  severity: MicroInsightSeverity,
  source: MicroInsight['source'],
): MicroInsight {
  return {
    label: truncate(cleanOneLine(label), MAX_LABEL_CHARS),
    line: truncate(cleanOneLine(line), MAX_LINE_CHARS),
    severity,
    source,
  };
}

function cleanOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
}

function fingerprint(item: TriageItem, facts: FactBag): string {
  const raw = JSON.stringify({
    score: item.score,
    bucket: item.bucket,
    reasons: item.reasons,
    reports: facts['item.reports'],
    age: facts['account.ageDays'],
    removals: facts['user.summary.removalCount'],
    spam: facts['user.summary.spamCount'],
    siteTag: facts['post.domain.tag'] ?? '',
    siteRemovals: facts['post.domain.removedCount'],
  });
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = Math.imul(31, hash) + raw.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}
