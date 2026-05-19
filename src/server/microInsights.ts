import { redis, settings } from '@devvit/web/server';
import type {
  FactBag,
  MicroInsight,
  MicroInsightSeverity,
  TriageItem,
} from '../shared/types';
import { redisKeys } from './redisKeys';
import { buildFacts, scoreFacts } from './rules';
import { recordDecision } from './decisionLog';
import { getItem } from './triage';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_LABEL_CHARS = 18;
const MAX_LINE_CHARS = 70;

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    safetyRatings?: unknown;
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  promptFeedback?: unknown;
  usageMetadata?: unknown;
};

type RawInsight = {
  label?: unknown;
  line?: unknown;
  severity?: unknown;
};

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    label: {
      type: 'STRING',
      description: `Short decision label, at most ${MAX_LABEL_CHARS} characters.`,
    },
    line: {
      type: 'STRING',
      description: `One-line moderation recommendation, at most ${MAX_LINE_CHARS} characters.`,
    },
    severity: {
      type: 'STRING',
      enum: ['high', 'medium', 'low', 'neutral'],
    },
  },
  required: ['label', 'line', 'severity'],
} as const;

export async function getTriageMicroInsight(
  thingId: string
): Promise<MicroInsight | null> {
  const item = await getItem(thingId);
  if (!item) {
    return null;
  }

  const facts = await buildFacts(item);
  const scored = await scoreFacts(facts);
  const displayItem: TriageItem = {
    ...item,
    score: scored.score,
    bucket: scored.bucket,
    reasons: scored.reasons,
    ...(scored.reasonRefs.length > 0 ? { reasonRefs: scored.reasonRefs } : {}),
  };
  const fallback = templateTriageInsight(displayItem, facts);
  const enabled =
    (await settings.get<boolean>('aiMicroInsightsEnabled')) ?? true;
  const apiKey = (await settings.get<string>('geminiApiKey'))?.trim();
  if (!enabled || !apiKey || fallback.severity === 'neutral') {
    return fallback;
  }

  const model = (
    (await settings.get<string>('geminiModel')) || DEFAULT_GEMINI_MODEL
  )
    .trim()
    .replace(/^models\//, '');
  const cacheKey = redisKeys.microInsight(
    'triage',
    item.thingId,
    fingerprint(displayItem, facts)
  );
  const cached = await readCachedInsight(cacheKey);
  if (cached) {
    return cached;
  }

  const generated = await generateGeminiInsight(
    displayItem,
    facts,
    apiKey,
    model
  ).catch((error: unknown) => {
    console.error('[ModLens] Gemini micro insight request failed', {
      thingId: item.thingId,
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (generated) {
    await redis.set(cacheKey, JSON.stringify(generated), {
      expiration: new Date(Date.now() + 60 * 60 * 6 * 1000),
    });
    await recordDecision({
      thingId: displayItem.thingId,
      author: displayItem.author,
      source: generated.source === 'gemini' ? 'ai' : 'template',
      scoreBefore: item.score,
      scoreAfter: displayItem.score,
      bucketBefore: item.bucket,
      bucketAfter: displayItem.bucket,
      matchedRuleIds: scored.matchedRuleIds,
      reasons: displayItem.reasons,
      facts,
      insight: generated,
    });
  }
  return generated ?? fallback;
}

async function readCachedInsight(
  cacheKey: string
): Promise<MicroInsight | null> {
  const raw = await redis.get(cacheKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as MicroInsight;
  } catch {
    return null;
  }
}

function templateTriageInsight(item: TriageItem, facts: FactBag): MicroInsight {
  const removals = facts['user.summary.removalCount'];
  const spam = facts['user.summary.spamCount'];
  const siteTag = facts['post.domain.tag'];
  const siteRemovals = facts['post.domain.removedCount'];
  const reportCount = facts['item.reports'];
  const ageDays = facts['account.ageDays'];

  if (removals >= 3 && reportCount >= 2) {
    return micro(
      'Likely remove',
      'Reports plus prior removals; confirm rule match.',
      'high',
      'template'
    );
  }

  if (removals >= 3 && siteTag) {
    return micro(
      'Likely remove',
      `${siteTag} site plus ${removals} prior removals.`,
      'high',
      'template'
    );
  }

  if (removals >= 3) {
    return micro(
      'Review history',
      `${removals} prior removals; check this post against rules.`,
      'high',
      'template'
    );
  }

  if (siteTag === 'spammy' || siteTag === 'scam') {
    return micro(
      'Site risk',
      `${siteTag} site with ${siteRemovals} removals.`,
      'high',
      'template'
    );
  }

  if (spam > 0) {
    return micro(
      'Watch user',
      `${spam} spam notes and ${removals} removals.`,
      'medium',
      'template'
    );
  }

  if (reportCount >= 2) {
    return micro(
      'Review reports',
      `${reportCount} reports; inspect the post before deciding.`,
      'medium',
      'template'
    );
  }

  if (ageDays <= 7 && item.score > 0) {
    return micro(
      'Review account',
      `${ageDays}d old account; inspect the post.`,
      'medium',
      'template'
    );
  }

  if (item.reasons.length > 0) {
    return micro(
      'Review post',
      item.reasons.slice(0, 2).join(', '),
      item.bucket === 'high' ? 'high' : 'medium',
      'template'
    );
  }

  return micro(
    'Likely approve',
    'No reports, notes, or removals found.',
    'neutral',
    'template'
  );
}

async function generateGeminiInsight(
  item: TriageItem,
  facts: FactBag,
  apiKey: string,
  model: string
): Promise<MicroInsight | null> {
  const startedAt = Date.now();
  const prompt = buildPrompt(item, facts);
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
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 128,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[ModLens] Gemini API error', {
      thingId: item.thingId,
      model,
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
    return null;
  }

  const rawBody = await response.text();
  let payload: GeminiResponse;
  try {
    payload = JSON.parse(rawBody) as GeminiResponse;
  } catch {
    console.error('[ModLens] Gemini API returned non-JSON success response', {
      thingId: item.thingId,
      model,
      body: rawBody.slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    console.error('[ModLens] Gemini API returned empty response', {
      thingId: item.thingId,
      model,
      ...geminiDebug(payload),
      body: rawBody.slice(0, 1000),
      durationMs: Date.now() - startedAt,
    });
    return null;
  }

  const parsed = parseGeneratedInsight(text);
  if (!parsed) {
    console.error('[ModLens] Gemini API returned invalid insight JSON', {
      thingId: item.thingId,
      model,
      rawText: text.slice(0, 500),
      ...geminiDebug(payload),
      durationMs: Date.now() - startedAt,
    });
  }
  return parsed;
}

function geminiDebug(payload: GeminiResponse): Record<string, unknown> {
  const first = payload.candidates?.[0];
  return {
    candidateCount: payload.candidates?.length ?? 0,
    finishReason: first?.finishReason ?? null,
    promptFeedback: payload.promptFeedback ?? null,
    safetyRatings: first?.safetyRatings ?? null,
    usageMetadata: payload.usageMetadata ?? null,
  };
}

function buildPrompt(item: TriageItem, facts: FactBag): string {
  return [
    'You are writing a one-line moderation recommendation.',
    'Return exactly one JSON object matching the provided schema.',
    'Do not include prose, markdown, code fences, prefaces, usernames, or quoted content.',
    `Keep label <= ${MAX_LABEL_CHARS} chars and line <= ${MAX_LINE_CHARS} chars.`,
    'Base the recommendation only on these facts:',
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
    const json = extractJsonObject(text);
    if (!json) {
      return null;
    }
    const parsed = JSON.parse(json) as RawInsight;
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

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}

function parseSeverity(value: unknown): MicroInsightSeverity {
  return value === 'high' ||
    value === 'medium' ||
    value === 'low' ||
    value === 'neutral'
    ? value
    : 'neutral';
}

function micro(
  label: string,
  line: string,
  severity: MicroInsightSeverity,
  source: MicroInsight['source']
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
  return value.length <= max
    ? value
    : value.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
}

function fingerprint(item: TriageItem, facts: FactBag): string {
  const raw = JSON.stringify({
    version: 4,
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
