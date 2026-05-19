import type { DomainTag } from '../shared/tags';
import type { TriageBucket } from '../shared/types';

const cleanUser = (name: string) => name.trim().replace(/^u\//i, '').toLowerCase();
const cleanHost = (host: string) => host.trim().toLowerCase().replace(/^www\./, '');

export const redisKeys = {
  userNotes: (name: string) => `user:${cleanUser(name)}:notes`,
  userNoteIds: (name: string) => `user:${cleanUser(name)}:noteIds`,
  userSummary: (name: string) => `user:${cleanUser(name)}:summary`,
  notesByLabel: (label: string) => `notes:byLabel:${label}`,
  itemNotes: (thingId: string) => `item:${encodeURIComponent(thingId)}:notes`,
  itemNoteIds: (thingId: string) => `item:${encodeURIComponent(thingId)}:noteIds`,
  domain: (host: string) => `domain:${cleanHost(host)}`,
  domainStats: (host: string) => `domain:${cleanHost(host)}:stats`,
  domainsByTag: (tag: DomainTag) => `domains:byTag:${tag}`,
  domainsBySub: () => 'domains:bySub',
  triageItems: () => 'triage:items',
  triageBucket: (bucket: TriageBucket) => `triage:bucket:${bucket}`,
  triageItem: (id: string) => `triage:item:${id}`,
  thingBodySnapshot: (id: string) => `thing:${encodeURIComponent(id)}:bodySnapshot`,
  modlogDay: (day: string) => `modlog:day:${day}`,
  modlogHour: (hour: string) => `modlog:hour:${hour}`,
  modlogEntries: () => 'modlog:entries',
  modlogEntry: (id: string) => `modlog:entry:${id}`,
  modlogByUser: (name: string) => `modlog:byUser:${cleanUser(name)}`,
  modlogByDomain: (host: string) => `modlog:byDomain:${cleanHost(host)}`,
  modlogCursor: () => 'modlog:cursor',
  modlogSummary: (day: string) => `modlog:summary:${day}`,
  rule: (id: string) => `rules:${id}`,
  rulesOrder: () => 'rules:order',
  ruleMatches: (id: string) => `rules:matches:${id}`,
  decisionLog: () => 'rules:decisions',
  decisionLogEntry: (id: string) => `rules:decision:${id}`,
  alertRate: (type: string, bucket: string) => `alerts:rate:${type}:${bucket}`,
  alertConfig: () => 'alerts:config',
  alertsRecent: () => 'alerts:recent',
  alertRecord: (id: string) => `alerts:record:${id}`,
  auditLog: () => 'audit:log',
  auditEntry: (id: string) => `audit:entry:${id}`,
  idem: (eventId: string) => `idem:${eventId}`,
  microInsight: (kind: string, id: string, fingerprint: string) =>
    `ai:micro:${kind}:${encodeURIComponent(id)}:${fingerprint}`,
  removalReasons: () => 'removal:reasons',
  presenceItem: (itemId: string) => `presence:item:${itemId}`,
  dashboardPostId: () => 'dashboard:postId',
  navigationIntent: (viewer: string) => `nav:intent:${cleanUser(viewer)}`,
};

export const userNotes = redisKeys.userNotes;
export const userNoteIds = redisKeys.userNoteIds;
export const userSummary = redisKeys.userSummary;
export const notesByLabel = redisKeys.notesByLabel;
export const itemNotes = redisKeys.itemNotes;
export const itemNoteIds = redisKeys.itemNoteIds;
export const domain = redisKeys.domain;
export const domainStats = redisKeys.domainStats;
export const domainsByTag = redisKeys.domainsByTag;
export const domainsBySub = redisKeys.domainsBySub;
export const triageItems = redisKeys.triageItems;
export const triageBucket = redisKeys.triageBucket;
export const triageItem = redisKeys.triageItem;
export const modlogDay = redisKeys.modlogDay;
export const modlogHour = redisKeys.modlogHour;
export const modlogEntries = redisKeys.modlogEntries;
export const modlogEntry = redisKeys.modlogEntry;
export const modlogByUser = redisKeys.modlogByUser;
export const modlogByDomain = redisKeys.modlogByDomain;
export const modlogCursor = redisKeys.modlogCursor;
export const rule = redisKeys.rule;
export const rulesOrder = redisKeys.rulesOrder;
export const decisionLog = redisKeys.decisionLog;
export const decisionLogEntry = redisKeys.decisionLogEntry;
export const alertRate = redisKeys.alertRate;
export const auditLog = redisKeys.auditLog;
export const auditEntry = redisKeys.auditEntry;
export const idem = redisKeys.idem;

export function normalizeHost(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = cleanHost(url.hostname);
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

export function isRedditHost(host: string | null | undefined): boolean {
  if (!host) {
    return false;
  }
  const clean = cleanHost(host);
  return (
    clean === 'reddit.com' ||
    clean.endsWith('.reddit.com') ||
    clean === 'redd.it' ||
    clean.endsWith('.redd.it') ||
    clean === 'redditmedia.com' ||
    clean.endsWith('.redditmedia.com')
  );
}
