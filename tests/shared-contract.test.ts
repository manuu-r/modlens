import { describe, expect, it } from 'vitest';
import {
  REDDIT_USER_NOTE_LABEL_BY_MODLENS_LABEL,
  USER_NOTE_LABELS,
  isUserNoteLabel,
  mapToRedditLabel,
} from '../src/shared/labels';
import { DOMAIN_TAGS, isDomainTag } from '../src/shared/tags';
import { CONDITION_OPS, TRIAGE_BUCKETS } from '../src/shared/types';

describe('shared labels', () => {
  it('maps every ModLens user note label to a Reddit native label', () => {
    expect(USER_NOTE_LABELS).toEqual(['Spammer', 'Warned', 'Trusted', 'Watch', 'BanEvasion']);
    expect(Object.keys(REDDIT_USER_NOTE_LABEL_BY_MODLENS_LABEL).sort()).toEqual(
      [...USER_NOTE_LABELS].sort(),
    );
    expect(mapToRedditLabel('Spammer')).toBe('SPAM_WARNING');
    expect(mapToRedditLabel('Warned')).toBe('ABUSE_WARNING');
    expect(mapToRedditLabel('Trusted')).toBe('HELPFUL_USER');
    expect(mapToRedditLabel('Watch')).toBe('SPAM_WATCH');
    expect(mapToRedditLabel('BanEvasion')).toBe('BAN');
  });

  it('recognizes only supported user note labels', () => {
    expect(isUserNoteLabel('Spammer')).toBe(true);
    expect(isUserNoteLabel('Ban-Evasion')).toBe(false);
    expect(isUserNoteLabel('Custom')).toBe(false);
  });
});

describe('shared tags and contract constants', () => {
  it('recognizes only supported domain tags', () => {
    expect(DOMAIN_TAGS).toEqual(['trusted', 'watchlist', 'spammy', 'scam']);
    expect(isDomainTag('watchlist')).toBe(true);
    expect(isDomainTag('malware')).toBe(false);
  });

  it('keeps triage buckets and condition operators aligned with the plan', () => {
    expect(TRIAGE_BUCKETS).toEqual(['high', 'aged', 'normal']);
    expect(CONDITION_OPS).toEqual(['<', '<=', '==', '!=', '>=', '>', 'in', 'notIn']);
  });
});
