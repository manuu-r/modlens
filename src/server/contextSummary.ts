import type {
  ContextSuggestion,
  ContextSummary,
  FactBag,
  MicroInsightSeverity,
  PatternMatch,
  ReasonRef,
  TriageItem,
} from '../shared/types';
import { fireAlert } from './alerts';
import { listSiteItems } from './domains';
import { listNotes } from './notes';
import { authorSiteRepeats, repeatRemovals, siteCluster, siteSpike } from './patterns';
import { normalizeHost } from './redisKeys';
import { buildFacts } from './rules';
import { getItem } from './triage';

export async function getTriageContext(thingId: string): Promise<ContextSummary | null> {
  const item = await getItem(thingId);
  if (!item) return null;

  const facts = await buildFacts(item);
  const notes = await listNotes(item.author).catch(() => []);
  const severity = computeSeverity(item, facts);
  const drivers = collectDrivers(item, facts);
  const factsLine = composeFacts(item, facts, notes.length);
  const suggestion = suggestNextStep(item, facts, severity, drivers, notes.length);

  const patterns = await detectPatterns(item, facts);

  return {
    thingId: item.thingId,
    facts: factsLine,
    riskDrivers: drivers,
    suggestion,
    severity,
    patterns,
    source: 'template',
  };
}

async function detectPatterns(item: TriageItem, facts: FactBag): Promise<PatternMatch[]> {
  const patterns: PatternMatch[] = [];

  const host = item.url ? normalizeHost(item.url) : null;
  if (host) {
    const siteItems = await listSiteItems(host, 300).catch(() => []);

    const p1 = authorSiteRepeats(item.author, host, siteItems);
    const p2 = siteCluster(host, siteItems);
    const p3 = siteSpike(host, siteItems);

    if (p1) {
      patterns.push(p1);
      void fireAlert(
        'pattern.author_site_repeats',
        { author: item.author, host, count: siteItems.filter((i) => i.author === item.author).length },
        { site: `#/sites/${encodeURIComponent(host)}`, author: `#/users/${encodeURIComponent(item.author)}` },
      ).catch(() => undefined);
    }
    if (p2) {
      patterns.push(p2);
      void fireAlert(
        'pattern.new_account_cluster',
        { host, label: p2.label },
        { site: `#/sites/${encodeURIComponent(host)}` },
      ).catch(() => undefined);
    }
    if (p3) {
      patterns.push(p3);
      void fireAlert(
        'pattern.site_spike',
        { host, label: p3.label },
        { site: `#/sites/${encodeURIComponent(host)}` },
      ).catch(() => undefined);
    }
  }

  const p4 = repeatRemovals(item.author, facts['user.summary.removalCount']);
  if (p4) patterns.push(p4);

  return patterns;
}

function computeSeverity(item: TriageItem, facts: FactBag): MicroInsightSeverity {
  const tag = facts['post.domain.tag'];
  if (item.bucket === 'high') return 'high';
  if (tag === 'spammy' || tag === 'scam') return 'high';
  if (facts['user.summary.removalCount'] >= 3) return 'high';
  if (item.bucket === 'aged') return 'medium';
  if (facts['item.reports'] >= 2 || facts['user.summary.spamCount'] > 0) return 'medium';
  if (facts['account.ageDays'] <= 7 && item.score > 0) return 'medium';
  if (item.score > 0) return 'low';
  return 'neutral';
}

function collectDrivers(item: TriageItem, facts: FactBag): ReasonRef[] {
  const drivers: ReasonRef[] = [];
  const seen = new Set<string>();
  const push = (ref: ReasonRef): void => {
    const key = `${ref.label}|${ref.sourceRuleId ?? ''}|${ref.sourceFact ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    drivers.push(ref);
  };

  if (item.reasonRefs?.length) {
    for (const ref of item.reasonRefs) push(ref);
  } else {
    for (const reason of item.reasons) push({ label: reason });
  }

  if (facts['user.summary.removalCount'] >= 3 && !drivers.some((d) => d.sourceFact === 'user.summary.removalCount')) {
    push({ label: 'prior removals', sourceFact: 'user.summary.removalCount' });
  }
  if (facts['user.summary.spamCount'] > 0 && !drivers.some((d) => d.sourceFact === 'user.summary.spamCount')) {
    push({ label: 'spam notes', sourceFact: 'user.summary.spamCount' });
  }
  const tag = facts['post.domain.tag'];
  if (tag && !drivers.some((d) => d.sourceFact === 'post.domain.tag')) {
    push({ label: `${tag} site`, sourceFact: 'post.domain.tag' });
  }
  if (facts['account.ageDays'] <= 7 && !drivers.some((d) => d.sourceFact === 'account.ageDays')) {
    push({ label: 'fresh account', sourceFact: 'account.ageDays' });
  }
  if (facts['item.reports'] >= 2 && !drivers.some((d) => d.sourceFact === 'item.reports')) {
    push({ label: `${facts['item.reports']} reports`, sourceFact: 'item.reports' });
  }

  return drivers;
}

function composeFacts(item: TriageItem, facts: FactBag, noteCount: number): string {
  const parts: string[] = [`u/${item.author}`];
  const fragments: string[] = [];
  const removals = facts['user.summary.removalCount'];
  const spam = facts['user.summary.spamCount'];
  const tag = facts['post.domain.tag'];
  const siteRemovals = facts['post.domain.removedCount'];
  const ageDays = facts['account.ageDays'];
  const reports = facts['item.reports'];

  if (removals > 0) fragments.push(`${removals} prior ${removals === 1 ? 'removal' : 'removals'}`);
  if (spam > 0) fragments.push(`${spam} spam ${spam === 1 ? 'note' : 'notes'}`);
  if (noteCount > 0 && spam === 0) fragments.push(`${noteCount} mod ${noteCount === 1 ? 'note' : 'notes'}`);

  if (fragments.length === 0) {
    fragments.push('no prior actions');
  }

  parts.push('has', joinWithAnd(fragments) + '.');

  if (tag) {
    const tail = siteRemovals > 0 ? ` (${siteRemovals} removed)` : '';
    parts.push(`Posted ${tag} site${tail}.`);
  } else if (item.url) {
    const host = normalizeHost(item.url);
    if (host) parts.push(`Posted to ${host}.`);
  }

  if (ageDays <= 7 && ageDays >= 0) {
    parts.push(`Account is ${ageDays}d old.`);
  }
  if (reports > 0) {
    parts.push(`${reports} ${reports === 1 ? 'report' : 'reports'} on this item.`);
  }

  return parts.join(' ');
}

function joinWithAnd(values: string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function suggestNextStep(
  item: TriageItem,
  facts: FactBag,
  severity: MicroInsightSeverity,
  drivers: ReasonRef[],
  noteCount: number,
): ContextSuggestion {
  const tag = facts['post.domain.tag'];
  const removals = facts['user.summary.removalCount'];
  const siteRemovals = facts['post.domain.removedCount'];
  const author = item.author;
  const host = item.url ? normalizeHost(item.url) : null;

  if ((tag === 'spammy' || tag === 'scam') && removals >= 2) {
    return {
      text: 'Likely spam — confirm a rule violation and remove.',
      intent: 'remove',
    };
  }

  if (severity === 'high' && noteCount === 0 && author !== '[deleted]') {
    return {
      text: 'Review author notes before removing.',
      intent: 'note',
      href: `#/users/${encodeURIComponent(author)}`,
    };
  }

  if (!tag && host && siteRemovals >= 2) {
    return {
      text: `Tag ${host} (history of removals).`,
      intent: 'tag',
      href: `#/sites/${encodeURIComponent(host)}`,
    };
  }

  if (severity === 'high' || item.bucket === 'high') {
    return {
      text: 'Investigate — see drivers and decide.',
      intent: 'review',
    };
  }

  if (severity === 'medium') {
    return {
      text: 'Skim mod log, then decide.',
      intent: 'review',
      ...(author !== '[deleted]' ? { href: `#/audit?target=${encodeURIComponent(author)}` } : {}),
    };
  }

  if (severity === 'neutral' || (severity === 'low' && drivers.length === 0)) {
    return {
      text: 'Approve — low prior risk.',
      intent: 'approve',
    };
  }

  return {
    text: 'Review and decide.',
    intent: 'review',
  };
}
