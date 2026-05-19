import type {
  AlertConfig,
  AlertRecord,
  AuditEntry,
  ContextSummary,
  DecisionLogEntry,
  DomainEntry,
  ItemNote,
  InsightRange,
  MicroInsight,
  ModlogInsights,
  NavigationIntent,
  Note,
  RecentActivityItem,
  RuleConfig,
  RuleDryRunResult,
  TriageBucket,
  TriageDecision,
  TriageItem,
  UserDigest,
  UserSummary,
} from '../shared/types';
import type { UserNoteLabel } from '../shared/labels';
import type { DomainTag } from '../shared/tags';

export type { TriageBucket, TriageDecision } from '../shared/types';

export type InsightsRange = InsightRange;
export type UserNoteLabelOption = UserNoteLabel;
export type DomainTagOption = DomainTag;

export type BootstrapResponse = {
  subreddit: string;
  subredditName: string;
  viewerName: string;
  isModerator: boolean;
  modPerms: string[];
  features: string[];
  featureFlags: Record<string, boolean>;
  dashboardPostId?: string | null;
  version: string;
  alerts: {
    configured: boolean;
    highBacklogThreshold: number;
  };
  ai: {
    microInsightsEnabled: boolean;
    geminiConfigured: boolean;
    model: string;
  };
  navigationIntent?: NavigationIntent;
};

export type UserPanelResponse = {
  name: string;
  notes: Note[];
  summary: UserSummary;
  recentActivity: RecentActivityItem[];
  domains: DomainEntry[];
  account: {
    ageDays: number;
    commentKarma: number;
    linkKarma: number;
    hasVerifiedEmail: boolean;
  } | null;
};

export type DomainResponse = { domain: DomainEntry };
export type TopDomainsResponse = { domains: DomainEntry[] };

export type AddNoteRequest = {
  label: UserNoteLabel;
  text: string;
  refUrl?: string;
};

export type DomainTagRequest = {
  tag: DomainTag;
  notes?: string;
};

export type TriageResponse = {
  bucket: TriageBucket;
  items: TriageItem[];
  total: number;
  nextCursor?: string;
};

export type DigestResponse = { digest: UserDigest };

export type RulesResponse = RuleConfig[];

export type DryRunResponse = { results: RuleDryRunResult[] };

export type AlertsConfigResponse = { config: AlertConfig };

export type MicroInsightResponse = { insight: MicroInsight };

type QueryValue = string | number | boolean | null | undefined;

class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const jsonHeaders = { 'content-type': 'application/json' };

function withQuery(path: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

async function request<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? jsonHeaders : {}), ...init?.headers },
  });
  const payload = response.status === 204 ? null : await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }
  return payload as TResponse;
}

function post<TResponse>(path: string, body?: unknown): Promise<TResponse> {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return request<TResponse>(path, init);
}

export function getBootstrap(): Promise<BootstrapResponse> {
  return request<BootstrapResponse>('/api/bootstrap');
}

export function getUserPanel(name: string): Promise<UserPanelResponse> {
  return request<UserPanelResponse>(`/api/user/${encodeURIComponent(name)}/panel`);
}

export function getUserDigest(name: string, window: '7' | '30' | '90'): Promise<DigestResponse> {
  return request<DigestResponse>(withQuery(`/api/user/${encodeURIComponent(name)}/digest`, { window }));
}

export function addNote(name: string, body: AddNoteRequest): Promise<{ note: Note }> {
  return post<{ note: Note }>(`/api/user/${encodeURIComponent(name)}/notes`, body);
}

export function deleteNote(name: string, id: string): Promise<{ deleted: boolean; ok: boolean }> {
  return request<{ deleted: boolean; ok: boolean }>(
    `/api/user/${encodeURIComponent(name)}/notes/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export function getDomain(host: string): Promise<DomainResponse> {
  return request<DomainResponse>(`/api/domain/${encodeURIComponent(host)}`);
}

export function getTopDomains(limit = 25, tag?: DomainTag): Promise<TopDomainsResponse> {
  return request<TopDomainsResponse>(withQuery('/api/domain/top', { limit, tag }));
}

export function tagDomain(host: string, body: DomainTagRequest): Promise<DomainResponse> {
  return post<DomainResponse>(`/api/domain/${encodeURIComponent(host)}/tag`, body);
}

export function untagDomain(host: string): Promise<DomainResponse> {
  return request<DomainResponse>(`/api/domain/${encodeURIComponent(host)}/tag`, { method: 'DELETE' });
}

export function getTriage(bucket: TriageBucket, cursor?: string, limit?: number): Promise<TriageResponse> {
  return request<TriageResponse>(withQuery('/api/triage', { bucket, cursor, limit }));
}

export function decideTriage(
  thingId: string,
  action: TriageDecision,
): Promise<{ item: TriageItem | null; decision: TriageDecision }> {
  return post<{ item: TriageItem | null; decision: TriageDecision }>(
    `/api/triage/${encodeURIComponent(thingId)}/decision`,
    { action },
  );
}

export function getTriageInsight(thingId: string): Promise<MicroInsightResponse> {
  return request<MicroInsightResponse>(`/api/ai/triage/${encodeURIComponent(thingId)}`);
}

export function getModlogInsights(range: InsightRange): Promise<ModlogInsights> {
  return request<ModlogInsights>(withQuery('/api/modlog/insights', { range }));
}

export function listRules(): Promise<RulesResponse> {
  return request<RulesResponse>('/api/rules');
}

export function saveRule(rule: RuleConfig): Promise<{ rule: RuleConfig }> {
  return post<{ rule: RuleConfig }>('/api/rules', rule);
}

export function deleteRule(id: string): Promise<{ deleted: boolean; ok: boolean }> {
  return request<{ deleted: boolean; ok: boolean }>(`/api/rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function dryrunRule(id: string): Promise<DryRunResponse> {
  return post<DryRunResponse>(`/api/rules/${encodeURIComponent(id)}/dryrun`, {});
}

export function getRuleMatches(id: string, limit = 10): Promise<{ items: TriageItem[] }> {
  return request<{ items: TriageItem[] }>(
    withQuery(`/api/rules/${encodeURIComponent(id)}/matches`, { limit }),
  );
}

export function getTriageContext(thingId: string): Promise<{ summary: ContextSummary }> {
  return request<{ summary: ContextSummary }>(`/api/ai/triage/${encodeURIComponent(thingId)}/context`);
}

export function listItemNotes(thingId: string): Promise<{ notes: ItemNote[] }> {
  return request<{ notes: ItemNote[] }>(`/api/item/${encodeURIComponent(thingId)}/notes`);
}

export function addItemNote(
  thingId: string,
  body: { kind: TriageItem['kind']; text: string; refUrl?: string },
): Promise<{ note: ItemNote }> {
  return post<{ note: ItemNote }>(`/api/item/${encodeURIComponent(thingId)}/notes`, body);
}

export function deleteItemNote(thingId: string, id: string): Promise<{ deleted: boolean; ok: boolean }> {
  return request<{ deleted: boolean; ok: boolean }>(
    `/api/item/${encodeURIComponent(thingId)}/notes/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export function getRuleDecisions(limit = 25): Promise<{ decisions: DecisionLogEntry[] }> {
  return request<{ decisions: DecisionLogEntry[] }>(withQuery('/api/rules/decisions', { limit }));
}

export function getAudit(limit = 25): Promise<{ entries: AuditEntry[] }> {
  return request<{ entries: AuditEntry[] }>(withQuery('/api/audit', { limit }));
}

export function getAlertsConfig(): Promise<AlertsConfigResponse> {
  return request<AlertsConfigResponse>('/api/alerts/config');
}

export function saveAlertsConfig(config: AlertConfig): Promise<AlertsConfigResponse> {
  return post<AlertsConfigResponse>('/api/alerts/config', { config });
}

export function testAlert(): Promise<{ delivered: boolean; targets: string[] }> {
  return request<{ delivered: boolean; targets: string[] }>('/api/alerts/test');
}

export type SiteAuthor = { name: string; itemCount: number; lastSeenAt: number };

export function getSiteItems(host: string, limit = 25): Promise<{ items: TriageItem[] }> {
  return request<{ items: TriageItem[] }>(
    withQuery(`/api/domain/${encodeURIComponent(host)}/items`, { limit }),
  );
}

export function getSiteUsers(host: string, limit = 25): Promise<{ authors: SiteAuthor[] }> {
  return request<{ authors: SiteAuthor[] }>(
    withQuery(`/api/domain/${encodeURIComponent(host)}/users`, { limit }),
  );
}

export function getRecentAlerts(limit = 25): Promise<{ alerts: AlertRecord[] }> {
  return request<{ alerts: AlertRecord[] }>(withQuery('/api/alerts/recent', { limit }));
}

// Removal reason templates

export type RemovalReasonRecord = {
  id: string;
  title: string;
  bodyTemplate: string;
  autoComment: boolean;
  dmUser: boolean;
  createdAt: number;
  createdBy: string;
};

export function listRemovalReasons(): Promise<{ reasons: RemovalReasonRecord[] }> {
  return request<{ reasons: RemovalReasonRecord[] }>('/api/removal-reasons');
}

export function createRemovalReason(body: {
  title: string;
  bodyTemplate: string;
  autoComment: boolean;
  dmUser: boolean;
}): Promise<{ reason: RemovalReasonRecord }> {
  return post<{ reason: RemovalReasonRecord }>('/api/removal-reasons', body);
}

export function deleteRemovalReason(id: string): Promise<{ deleted: boolean; ok: boolean }> {
  return request<{ deleted: boolean; ok: boolean }>(`/api/removal-reasons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function applyRemovalReason(
  reasonId: string,
  body: { thingId: string; author?: string; title?: string },
): Promise<{ applied: boolean }> {
  return post<{ applied: boolean }>(`/api/removal-reasons/${encodeURIComponent(reasonId)}/apply`, body);
}

// Queue presence (collision prevention)

export type PresenceEntry = { modName: string; since: number };

export function claimPresence(itemId: string): Promise<{ claimed: boolean; modName: string }> {
  return post<{ claimed: boolean; modName: string }>(`/api/presence/${encodeURIComponent(itemId)}/claim`, {});
}

export function touchPresence(itemId: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/api/presence/${encodeURIComponent(itemId)}/touch`, {});
}

export function releasePresence(itemId: string): Promise<{ released: boolean }> {
  return request<{ released: boolean }>(`/api/presence/${encodeURIComponent(itemId)}/claim`, {
    method: 'DELETE',
  });
}

export function getPresenceBatch(ids: string[]): Promise<{ presence: Record<string, PresenceEntry> }> {
  return post<{ presence: Record<string, PresenceEntry> }>('/api/presence/batch', { ids });
}
