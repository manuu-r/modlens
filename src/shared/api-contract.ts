import type { DomainTag } from './tags';
import type {
  AlertConfig,
  AuditEntry,
  DigestWindow,
  DomainEntry,
  ExportFormat,
  ExportKind,
  InsightRange,
  JsonObject,
  MicroInsight,
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
} from './types';
import type { UserNoteLabel } from './labels';

export type ApiOk = { ok: true };
export type ApiError = { ok: false; error: string; code?: string };
export type ApiResponse<T> = (T & ApiOk) | ApiError;

export interface CursorRequest {
  cursor?: string;
  limit?: number;
}

export interface CursorResponse {
  nextCursor?: string;
}

export interface BootstrapResponse {
  subredditName: string;
  viewerName: string;
  features: string[];
  dashboardPostId?: string;
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
}

export type GetBootstrapResponse = ApiResponse<BootstrapResponse>;

export interface UserPanelResponse {
  name: string;
  notes: Note[];
  summary: UserSummary;
  recentActivity: RecentActivityItem[];
  domains: DomainEntry[];
}

export type GetUserPanelRequest = { name: string };
export type GetUserPanelResponse = ApiResponse<UserPanelResponse>;

export interface GetUserDigestRequest {
  name: string;
  window: DigestWindow;
}

export type GetUserDigestResponse = ApiResponse<{ digest: UserDigest }>;

export interface AddNoteRequest {
  label: UserNoteLabel;
  text: string;
  refUrl?: string;
}

export type AddNoteResponse = ApiResponse<{ note: Note }>;

export interface DeleteNoteRequest {
  name: string;
  id: string;
}

export type DeleteNoteResponse = ApiResponse<{ deleted: true }>;

export type GetDomainRequest = { host: string };
export type GetDomainResponse = ApiResponse<{ domain: DomainEntry }>;

export interface TagDomainRequest {
  tag: DomainTag;
  notes?: string;
}

export type TagDomainResponse = ApiResponse<{ domain: DomainEntry }>;
export type DeleteDomainTagResponse = ApiResponse<{ domain: DomainEntry }>;

export interface GetTopDomainsRequest extends CursorRequest {
  tag?: DomainTag;
}

export type GetTopDomainsResponse = ApiResponse<CursorResponse & { domains: DomainEntry[] }>;

export interface GetTriageRequest extends CursorRequest {
  bucket?: TriageBucket;
}

export type GetTriageResponse = ApiResponse<CursorResponse & { items: TriageItem[] }>;

export interface DecideTriageRequest {
  action: TriageDecision;
}

export type DecideTriageResponse = ApiResponse<{ item: TriageItem; decision: TriageDecision }>;

export type GetTriageMicroInsightRequest = { thingId: string };
export type GetTriageMicroInsightResponse = ApiResponse<{ insight: MicroInsight }>;

export interface GetModlogInsightsRequest {
  range: InsightRange;
}

export type GetModlogInsightsResponse = ApiResponse<{
  range: InsightRange;
  perModTotals: Record<string, number>;
  actionHistogram: Record<string, number>;
  hourOfWeek: number[][];
  topRemovedDomains: DomainEntry[];
  topTargetedUsers: Array<{ name: string; count: number }>;
}>;

export type ListRulesResponse = ApiResponse<{ rules: RuleConfig[] }>;

export interface SaveRuleRequest {
  rule: RuleConfig;
}

export type SaveRuleResponse = ApiResponse<{ rule: RuleConfig }>;
export type DeleteRuleResponse = ApiResponse<{ deleted: true }>;

export interface DryRunRuleRequest {
  facts?: JsonObject[];
}

export type DryRunRuleResponse = ApiResponse<{ results: RuleDryRunResult[] }>;

export type GetAlertsConfigResponse = ApiResponse<{ config: AlertConfig }>;

export interface SaveAlertsConfigRequest {
  config: AlertConfig;
}

export type SaveAlertsConfigResponse = ApiResponse<{ config: AlertConfig }>;
export type TestAlertResponse = ApiResponse<{ delivered: boolean; targets: string[] }>;

export interface GetAuditRequest extends CursorRequest {
  actor?: string;
  action?: string;
}

export type GetAuditResponse = ApiResponse<CursorResponse & { entries: AuditEntry[] }>;

export interface StartExportRequest {
  kind: ExportKind;
  format: ExportFormat;
  range?: InsightRange;
}

export type StartExportResponse = ApiResponse<{ token: string; cursor: string }>;

export interface GetExportChunkRequest {
  token: string;
  cursor?: string;
}

export type GetExportChunkResponse = ApiResponse<{
  token: string;
  body: string;
  format: ExportFormat;
  nextCursor?: string;
  done: boolean;
}>;

export interface ApiContract {
  'GET /api/bootstrap': {
    response: GetBootstrapResponse;
  };
  'GET /api/user/:name/panel': {
    request: GetUserPanelRequest;
    response: GetUserPanelResponse;
  };
  'GET /api/user/:name/digest': {
    request: GetUserDigestRequest;
    response: GetUserDigestResponse;
  };
  'POST /api/user/:name/notes': {
    request: AddNoteRequest;
    response: AddNoteResponse;
  };
  'DELETE /api/user/:name/notes/:id': {
    request: DeleteNoteRequest;
    response: DeleteNoteResponse;
  };
  'GET /api/domain/:host': {
    request: GetDomainRequest;
    response: GetDomainResponse;
  };
  'POST /api/domain/:host/tag': {
    request: TagDomainRequest;
    response: TagDomainResponse;
  };
  'DELETE /api/domain/:host/tag': {
    request: GetDomainRequest;
    response: DeleteDomainTagResponse;
  };
  'GET /api/domain/top': {
    request: GetTopDomainsRequest;
    response: GetTopDomainsResponse;
  };
  'GET /api/triage': {
    request: GetTriageRequest;
    response: GetTriageResponse;
  };
  'POST /api/triage/:thingId/decision': {
    request: DecideTriageRequest;
    response: DecideTriageResponse;
  };
  'GET /api/ai/triage/:thingId': {
    request: GetTriageMicroInsightRequest;
    response: GetTriageMicroInsightResponse;
  };
  'GET /api/modlog/insights': {
    request: GetModlogInsightsRequest;
    response: GetModlogInsightsResponse;
  };
  'GET /api/rules': {
    response: ListRulesResponse;
  };
  'POST /api/rules': {
    request: SaveRuleRequest;
    response: SaveRuleResponse;
  };
  'DELETE /api/rules/:id': {
    response: DeleteRuleResponse;
  };
  'POST /api/rules/:id/dryrun': {
    request: DryRunRuleRequest;
    response: DryRunRuleResponse;
  };
  'GET /api/alerts/config': {
    response: GetAlertsConfigResponse;
  };
  'POST /api/alerts/config': {
    request: SaveAlertsConfigRequest;
    response: SaveAlertsConfigResponse;
  };
  'GET /api/alerts/test': {
    response: TestAlertResponse;
  };
  'GET /api/audit': {
    request: GetAuditRequest;
    response: GetAuditResponse;
  };
  'POST /api/export': {
    request: StartExportRequest;
    response: StartExportResponse;
  };
  'GET /api/export/:token': {
    request: GetExportChunkRequest;
    response: GetExportChunkResponse;
  };
}
