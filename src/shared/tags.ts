export const DOMAIN_TAGS = ['trusted', 'watchlist', 'spammy', 'scam'] as const;

export type DomainTag = (typeof DOMAIN_TAGS)[number];

export const DOMAIN_TAG_LABELS = {
  trusted: 'Trusted',
  watchlist: 'Watchlist',
  spammy: 'Spammy',
  scam: 'Scam',
} as const satisfies Record<DomainTag, string>;

export function isDomainTag(value: string): value is DomainTag {
  return DOMAIN_TAGS.includes(value as DomainTag);
}
