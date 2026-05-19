type AnyRecord = Record<string, unknown>;

const stringAt = (record: AnyRecord, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

export function textFromThingRecord(record: AnyRecord): string {
  return [stringAt(record, 'body'), stringAt(record, 'selftext'), stringAt(record, 'text')]
    .filter((value): value is string => Boolean(value))
    .join('\n');
}

export function hostsFromText(value: string): Set<string> {
  const hosts = new Set<string>();
  const urlPattern = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  const bareDomainPattern = /(?:^|[\s([{<])((?:[a-z0-9-]+\.)+[a-z]{2,63})(?:[/?#][^\s<>"')\]]*)?/gi;

  for (const match of value.matchAll(urlPattern)) {
    const host = normalizeMaybeHost(match[0]);
    if (host) {
      hosts.add(host);
    }
  }

  for (const match of value.matchAll(bareDomainPattern)) {
    const host = normalizeMaybeHost(match[1] ?? '');
    if (host) {
      hosts.add(host);
    }
  }

  return hosts;
}

export function addedExternalHosts(previousBody: string, currentBody: string): string[] {
  const before = hostsFromText(previousBody);
  const after = hostsFromText(currentBody);
  return [...after].filter((host) => !before.has(host));
}

function normalizeMaybeHost(rawUrl: string): string | null {
  const trimmed = rawUrl.trim().replace(/[.,;:!?]+$/, '');
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.trim().toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || isRedditHost(host)) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

function isRedditHost(host: string | null | undefined): boolean {
  if (!host) {
    return false;
  }
  const clean = host.trim().toLowerCase().replace(/^www\./, '');
  return (
    clean === 'reddit.com' ||
    clean.endsWith('.reddit.com') ||
    clean === 'redd.it' ||
    clean.endsWith('.redd.it') ||
    clean === 'redditmedia.com' ||
    clean.endsWith('.redditmedia.com')
  );
}
