export const USER_NOTE_LABELS = [
  'Spammer',
  'Warned',
  'Trusted',
  'Watch',
  'BanEvasion',
] as const;

export type UserNoteLabel = (typeof USER_NOTE_LABELS)[number];

export type RedditUserNoteLabel =
  | 'SPAM_WARNING'
  | 'ABUSE_WARNING'
  | 'HELPFUL_USER'
  | 'SPAM_WATCH'
  | 'BAN';

export const REDDIT_USER_NOTE_LABEL_BY_MODLENS_LABEL = {
  Spammer: 'SPAM_WARNING',
  Warned: 'ABUSE_WARNING',
  Trusted: 'HELPFUL_USER',
  Watch: 'SPAM_WATCH',
  BanEvasion: 'BAN',
} as const satisfies Record<UserNoteLabel, RedditUserNoteLabel>;

export function isUserNoteLabel(value: string): value is UserNoteLabel {
  return USER_NOTE_LABELS.includes(value as UserNoteLabel);
}

export function mapToRedditLabel(label: UserNoteLabel): RedditUserNoteLabel {
  return REDDIT_USER_NOTE_LABEL_BY_MODLENS_LABEL[label];
}
