import type { UserNoteLabel } from './labels';
import type { DomainTag } from './tags';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const TRIAGE_BUCKETS = ['high', 'aged', 'normal'] as const;
export type TriageBucket = (typeof TRIAGE_BUCKETS)[number];

export const THING_KINDS = ['post', 'comment'] as const;
export type ThingKind = (typeof THING_KINDS)[number];

export const CONDITION_OPS = ['<', '<=', '==', '!=', '>=', '>', 'in', 'notIn'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const DIGEST_WINDOWS = ['7', '30', '90'] as const;
export type DigestWindow = (typeof DIGEST_WINDOWS)[number];

export const INSIGHT_RANGES = ['7d', '30d', '90d'] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];

export const TRIAGE_DECISIONS = ['approve', 'remove', 'ignore'] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];

export const EXPORT_KINDS = ['notes', 'domains', 'audit', 'modlog'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface Note {
  id: string;
  label: UserNoteLabel;
  text: string;
  authorMod: string;
  createdAt: number;
  refUrl?: string;
  mirrorStatus?: 'synced' | 'pending';
}

export interface UserSummary {
  spamCount: number;
  removalCount: number;
  lastLabel?: UserNoteLabel;
  lastActionAt?: number;
}

export interface DomainEntry {
  host: string;
  tag?: DomainTag;
  taggedBy?: string;
  taggedAt?: number;
  notes?: string;
  postCount: number;
  removedCount: number;
  lastSeenAt: number;
}

export interface ReasonRef {
  label: string;
  sourceRuleId?: string;
  sourceFact?: string;
}

export interface TriageItem {
  thingId: string;
  kind: ThingKind;
  author: string;
  score: number;
  bucket: TriageBucket;
  createdAt: number;
  reasons: string[];
  reasonRefs?: ReasonRef[];
  url?: string;
  title?: string;
  reports?: string[];
}

export type ConditionValue = number | string | string[] | boolean;

export interface Condition {
  fact: string;
  op: ConditionOp;
  value: ConditionValue;
}

export interface RuleConfig {
  id: string;
  name: string;
  priority: number;
  when: {
    all?: Condition[];
    any?: Condition[];
  };
  then: {
    scoreDelta: number;
    bucket?: TriageBucket;
    reason: string;
  };
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  before?: JsonValue;
  after?: JsonValue;
  ts: number;
}

export interface AlertConfig {
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
  customWebhookUrl?: string;
  highBacklogThreshold: number;
  enabledTypes: string[];
}

export interface AlertLinks {
  queue?: string;
  author?: string;
  site?: string;
  item?: string;
}

export interface AlertRecord {
  id: string;
  type: string;
  ts: number;
  payload: JsonObject;
  links: AlertLinks;
  delivered: string[];
}

export interface FactBag {
  'account.ageDays': number;
  'account.commentKarma': number;
  'account.linkKarma': number;
  'account.hasVerifiedEmail': boolean;
  'user.summary.removalCount': number;
  'user.summary.spamCount': number;
  'post.domain.tag'?: DomainTag;
  'post.domain.removedCount': number;
  'item.reports': number;
}

export interface RecentActivityItem {
  id: string;
  kind: ThingKind;
  title?: string;
  body?: string;
  url?: string;
  domain?: string;
  score: number;
  createdAt: number;
  removed: boolean;
}

export interface UserDigest {
  window: DigestWindow;
  postCount: number;
  commentCount: number;
  removalRatio: number;
  topDomains: DomainEntry[];
  recentModActions: AuditEntry[];
  averageScore: number;
  controversial: boolean;
}

export interface ModlogInsights {
  range: InsightRange;
  perModTotals: Record<string, number>;
  actionHistogram: Record<string, number>;
  hourOfWeek: number[][];
  topRemovedDomains: DomainEntry[];
  topTargetedUsers: Array<{ name: string; count: number }>;
}

export type MicroInsightSeverity = 'high' | 'medium' | 'low' | 'neutral';
export type MicroInsightSource = 'template' | 'gemini';

export interface MicroInsight {
  label: string;
  line: string;
  severity: MicroInsightSeverity;
  source: MicroInsightSource;
}

export type SuggestionIntent = 'review' | 'tag' | 'remove' | 'approve' | 'note';

export interface ContextSuggestion {
  text: string;
  intent: SuggestionIntent;
  href?: string;
}

export interface PatternMatch {
  id: string;
  label: string;
  evidence: Array<{ label: string; href: string }>;
}

export interface ContextSummary {
  thingId: string;
  facts: string;
  riskDrivers: ReasonRef[];
  suggestion: ContextSuggestion;
  severity: MicroInsightSeverity;
  patterns: PatternMatch[];
  source: MicroInsightSource;
}

export interface NavigationIntent {
  hash: string;
  focusedUser?: string;
  issuedAt: number;
  source: 'menu.openQueue' | 'menu.userContext';
}

export interface RuleDryRunResult {
  thingId: string;
  matched: boolean;
  scoreDelta: number;
  bucket?: TriageBucket;
  reason?: string;
}
