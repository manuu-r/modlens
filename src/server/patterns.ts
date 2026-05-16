import type { PatternMatch, TriageItem } from '../shared/types';
import { normalizeHost } from './redisKeys';

const DAY_MS = 86_400_000;

export function authorSiteRepeats(author: string, host: string, items: TriageItem[]): PatternMatch | null {
  const cutoff = Date.now() - 30 * DAY_MS;
  const matches = items.filter(
    (i) => i.author === author && i.url && normalizeHost(i.url) === host && i.createdAt >= cutoff,
  );
  if (matches.length < 3) return null;
  return {
    id: 'author_site_repeats',
    label: `${author} posted ${host} ${matches.length}× in 30d`,
    evidence: matches.slice(0, 3).map((i) => ({
      label: i.title ?? i.thingId,
      href: `#/audit?target=${encodeURIComponent(i.thingId)}`,
    })),
  };
}

// ≥ 3 distinct accounts posted the same host in 14d — coordination signal
export function siteCluster(host: string, items: TriageItem[]): PatternMatch | null {
  const cutoff = Date.now() - 14 * DAY_MS;
  const recent = items.filter(
    (i) => i.url && normalizeHost(i.url) === host && i.createdAt >= cutoff,
  );
  const authors = new Set(recent.map((i) => i.author));
  if (authors.size < 3) return null;
  return {
    id: 'new_account_cluster',
    label: `${authors.size} accounts posted ${host} in 14d`,
    evidence: [...authors].slice(0, 3).map((name) => ({
      label: `u/${name}`,
      href: `#/users/${encodeURIComponent(name)}`,
    })),
  };
}

// Last-24h volume ≥ 3× the prior-6d daily average (requires baseline ≥ 3 items)
export function siteSpike(host: string, items: TriageItem[]): PatternMatch | null {
  const now = Date.now();
  const hostItems = items.filter((i) => i.url && normalizeHost(i.url) === host);
  const last24h = hostItems.filter((i) => i.createdAt >= now - DAY_MS).length;
  const prior6d = hostItems.filter(
    (i) => i.createdAt >= now - 7 * DAY_MS && i.createdAt < now - DAY_MS,
  ).length;
  const dailyAvg = prior6d / 6;
  if (prior6d < 3 || last24h < 5 || last24h < 3 * dailyAvg) return null;
  return {
    id: 'site_spike',
    label: `${host}: ${last24h} items today (${dailyAvg.toFixed(1)}/d avg)`,
    evidence: [{ label: `View ${host}`, href: `#/sites/${encodeURIComponent(host)}` }],
  };
}

// High cumulative removal count — proxy for repeat problem accounts
export function repeatRemovals(author: string, removalCount: number): PatternMatch | null {
  if (removalCount < 5) return null;
  return {
    id: 'repeat_removals',
    label: `u/${author} has ${removalCount} prior removals`,
    evidence: [{ label: 'View mod log', href: `#/audit?target=${encodeURIComponent(author)}` }],
  };
}
