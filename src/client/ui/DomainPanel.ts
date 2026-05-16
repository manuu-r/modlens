import {
  getAudit,
  getDomain,
  getSiteItems,
  getSiteUsers,
  getTopDomains,
  tagDomain,
  untagDomain,
  type SiteAuthor,
} from '../api';
import { DOMAIN_TAG_LABELS, DOMAIN_TAGS, type DomainTag } from '../../shared/tags';
import type { AuditEntry, DomainEntry, TriageItem } from '../../shared/types';
import {
  cell,
  chip,
  createElement,
  el,
  errorPanel,
  formatNumber,
  formatRelative,
  loadingPanel,
  metric,
  normalizeHostInput,
  panel,
  row,
  stack,
  table,
  type View,
} from './viewHelpers';

export function renderDomainsIndex(): View {
  const element = createElement('div', 'stack');
  const lookup = createElement('section', 'panel lookup-panel');
  const form = createElement('form', 'lookup-form');
  const label = createElement('label');
  const input = createElement('input');
  const button = createElement('button', 'button', 'Open site');
  const tableHost = el('div');

  label.textContent = 'Site or URL';
  input.type = 'text';
  input.name = 'host';
  input.placeholder = 'https://example.com/post';
  input.autocomplete = 'off';
  button.type = 'submit';
  button.title = 'Parse this URL and open the site history.';
  button.setAttribute('aria-label', button.title);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const host = normalizeHostInput(input.value);
    if (host) {
      window.location.hash = `#/sites/${encodeURIComponent(host)}`;
    }
  });

  const renderTopDomains = (tag?: DomainTag): void => {
    tableHost.replaceChildren(loadingPanel('Loading top sites...'));
    void getTopDomains(25, tag)
      .then((payload) => {
        tableHost.replaceChildren(
          panel(
            el('h2', { text: 'Site history' }),
            renderTagFilters(tag, renderTopDomains),
            payload.domains.length
              ? renderDomainsTable(payload.domains)
              : el('p', { className: 'muted', text: 'No sites found.' }),
          ),
        );
      })
      .catch((error: unknown) => {
        tableHost.replaceChildren(errorPanel(error));
      });
  };

  form.append(label, input, button);
  lookup.append(form);
  element.append(lookup, tableHost);
  renderTopDomains();

  return {
    title: 'Sites',
    subtitle: 'Paste a URL or review sites posted in this subreddit.',
    element,
  };
}

export function renderDomainPanel(host: string): View {
  const element = el('div', { className: 'stack' });

  const load = (): void => {
    element.replaceChildren(loadingPanel(`Loading ${host}...`));
    void getDomain(host)
      .then((payload) => {
        element.replaceChildren(renderDomainContent(host, payload.domain, load));
      })
      .catch((error: unknown) => {
        element.replaceChildren(errorPanel(error));
      });
  };

  load();

  return {
    title: host,
    subtitle: 'Site tag, removal history, and related audit data.',
    element,
  };
}

function renderTagFilters(activeTag: DomainTag | undefined, load: (tag?: DomainTag) => void): HTMLElement {
  const filters: Array<{ label: string; tag?: DomainTag }> = [
    { label: 'All' },
    ...DOMAIN_TAGS.map((tag) => ({ label: DOMAIN_TAG_LABELS[tag], tag })),
  ];

  return el('div', {
    className: 'segmented',
    children: filters.map((filter) =>
      el('a', {
        href: '#/sites',
        text: filter.label,
        ...(filter.tag === activeTag || (!filter.tag && !activeTag) ? { className: 'active' } : {}),
        onClick: (event) => {
          event.preventDefault();
          load(filter.tag);
        },
      }),
    ),
  });
}

function renderDomainsTable(domains: DomainEntry[]): HTMLElement {
  return table(
    ['Site', 'Tag', 'Posts', 'Removed', 'Last seen'],
    domains.map((domain) => [
      el('a', {
        className: 'host-link',
        href: `#/sites/${encodeURIComponent(domain.host)}`,
        text: domain.host,
        title: 'Open this site history and tag page.',
        attrs: { 'aria-label': 'Open this site history and tag page.' },
      }),
      domain.tag ? chip(domain.tag, domain.tag) : cell('-'),
      cell(formatNumber(domain.postCount)),
      domain.removedCount > 0 ? chip(formatNumber(domain.removedCount), 'high') : cell(formatNumber(domain.removedCount)),
      cell(formatRelative(domain.lastSeenAt)),
    ]),
  );
}

function renderDomainContent(host: string, domain: DomainEntry, reload: () => void): HTMLElement {
  return stack(
    panel(
      el('h2', { text: 'Site history' }),
      row(
        metric(formatNumber(domain.postCount), 'Posts'),
        metric(formatNumber(domain.removedCount), 'Removed', domain.removedCount > 0 ? 'danger' : undefined),
        metric(formatRelative(domain.lastSeenAt), 'Last seen'),
      ),
      row(
        domain.tag ? chip(domain.tag, domain.tag) : chip('untagged'),
        ...(domain.taggedBy ? [chip(`tagged by ${domain.taggedBy}`)] : []),
        ...(domain.taggedAt ? [chip(formatRelative(domain.taggedAt))] : []),
      ),
      ...(domain.tag ? [] : [renderSuggestedTag(domain)]),
      ...(domain.notes ? [el('p', { className: 'muted', text: domain.notes })] : []),
    ),
    renderTagPanel(host, domain, reload),
    renderSiteAuthorsPanel(host),
    renderSiteItemsPanel(host),
    renderSiteModlogPanel(host),
  );
}

function renderSiteAuthorsPanel(host: string): HTMLElement {
  const container = el('div', { children: [loadingPanel('Loading authors...')] });
  void getSiteUsers(host, 15)
    .then(({ authors }) => {
      container.replaceChildren(
        panel(
          el('h2', { text: 'Authors who posted this site' }),
          authors.length
            ? renderAuthorsTable(authors)
            : el('p', { className: 'muted', text: 'No queued items from this site.' }),
        ),
      );
    })
    .catch((error: unknown) => container.replaceChildren(errorPanel(error)));
  return container;
}

function renderAuthorsTable(authors: SiteAuthor[]): HTMLElement {
  return table(
    ['Author', 'Items', 'Last seen'],
    authors.map((author) => [
      el('a', {
        className: 'host-link',
        href: `#/users/${encodeURIComponent(author.name)}`,
        text: `u/${author.name}`,
      }),
      cell(formatNumber(author.itemCount)),
      cell(formatRelative(author.lastSeenAt)),
    ]),
  );
}

function renderSiteItemsPanel(host: string): HTMLElement {
  const container = el('div', { children: [loadingPanel('Loading queue items...')] });
  void getSiteItems(host, 15)
    .then(({ items }) => {
      container.replaceChildren(
        panel(
          el('h2', { text: 'Recent queue items' }),
          items.length
            ? renderItemsTable(items)
            : el('p', { className: 'muted', text: 'No queue items currently use this site.' }),
        ),
      );
    })
    .catch((error: unknown) => container.replaceChildren(errorPanel(error)));
  return container;
}

function renderItemsTable(items: TriageItem[]): HTMLElement {
  return table(
    ['Title', 'Author', 'Bucket', 'Created'],
    items.map((item) => [
      el('a', {
        className: 'host-link',
        href: `#/audit?target=${encodeURIComponent(item.thingId)}`,
        text: item.title ?? `(${item.kind})`,
      }),
      el('a', {
        className: 'host-link',
        href: `#/users/${encodeURIComponent(item.author)}`,
        text: `u/${item.author}`,
      }),
      chip(item.bucket, item.bucket),
      cell(formatRelative(item.createdAt)),
    ]),
  );
}

function renderSiteModlogPanel(host: string): HTMLElement {
  const container = el('div', { children: [loadingPanel('Loading mod log...')] });
  void getAudit(undefined, { site: host })
    .then(({ entries }) => {
      container.replaceChildren(
        panel(
          row(
            el('h2', { text: 'Mod log for this site' }),
            el('a', {
              className: 'host-link',
              href: `#/audit?site=${encodeURIComponent(host)}`,
              text: 'Open full mod log',
            }),
          ),
          entries.length
            ? renderModlogTable(entries)
            : el('p', { className: 'muted', text: 'No mod actions recorded for this site.' }),
        ),
      );
    })
    .catch((error: unknown) => container.replaceChildren(errorPanel(error)));
  return container;
}

function renderModlogTable(entries: AuditEntry[]): HTMLElement {
  return table(
    ['Action', 'Target', 'Actor', 'When'],
    entries.slice(0, 10).map((entry) => [
      chip(entry.action),
      el('span', { text: entry.target }),
      el('a', {
        className: 'host-link',
        href: `#/audit?actor=${encodeURIComponent(entry.actor)}`,
        text: entry.actor,
      }),
      cell(formatRelative(entry.ts)),
    ]),
  );
}

function renderTagPanel(host: string, domain: DomainEntry, reload: () => void): HTMLElement {
  const form = el('form', { className: 'rule-form' });
  const select = el('select');
  const notes = el('textarea');
  const suggestion = suggestDomainTag(domain);
  const save = el('button', {
    className: 'button button-accent',
    text: 'Save tag',
    title: 'Save this site tag and note for the mod team.',
    attrs: { 'aria-label': 'Save this site tag and note for the mod team.' },
  });
  const remove = el('button', {
    className: 'button button-danger',
    text: 'Remove tag',
    title: 'Clear the current site tag but keep site history.',
    attrs: { 'aria-label': 'Clear the current site tag but keep site history.' },
    onClick: () => {
      remove.setAttribute('disabled', 'true');
      void untagDomain(host)
        .then(reload)
        .catch(() => remove.removeAttribute('disabled'));
    },
  });
  const applySuggested = el('button', {
    className: 'button',
    text: 'Apply suggested tag',
    onClick: () => {
      applySuggested.setAttribute('disabled', 'true');
      void tagDomain(host, { tag: suggestion.tag, notes: suggestion.notes })
        .then(reload)
        .catch(() => applySuggested.removeAttribute('disabled'));
    },
  });

  applySuggested.type = 'button';
  remove.type = 'button';
  save.type = 'submit';
  notes.value = domain.notes ?? (!domain.tag ? suggestion.notes : '');
  notes.placeholder = 'Why this site is tagged this way';

  for (const tag of DOMAIN_TAGS) {
    const option = el('option', { text: DOMAIN_TAG_LABELS[tag], attrs: { value: tag } });
    option.selected = tag === (domain.tag ?? suggestion.tag);
    select.append(option);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const noteText = notes.value.trim();
    save.setAttribute('disabled', 'true');
    void tagDomain(host, {
      tag: select.value as DomainTag,
      ...(noteText ? { notes: noteText } : {}),
    })
      .then(reload)
      .catch(() => save.removeAttribute('disabled'));
  });

  form.append(
    el('label', { children: ['Tag', select] }),
    el('label', { children: ['Notes', notes] }),
    row(save, ...(domain.tag ? [] : [applySuggested]), remove),
  );

  return panel(
    el('h2', { text: 'Site tag' }),
    row(domain.tag ? chip(domain.tag, domain.tag) : chip('untagged')),
    form,
  );
}

function renderSuggestedTag(domain: DomainEntry): HTMLElement {
  const suggestion = suggestDomainTag(domain);
  return el('p', {
    className: 'muted',
    children: ['Suggested tag: ', chip(suggestion.tag, suggestion.tag), ` ${suggestion.reason}`],
  });
}

function suggestDomainTag(domain: DomainEntry): { tag: DomainTag; reason: string; notes: string } {
  const removed = domain.removedCount;
  const posts = domain.postCount;
  const ratio = posts > 0 ? removed / posts : 0;

  if (removed >= 3 && ratio >= 0.5) {
    return {
      tag: 'spammy',
      reason: 'because this site has repeated removals.',
      notes: `Auto-suggested: ${removed}/${posts} seen posts were removed.`,
    };
  }

  if (removed > 0 || ratio >= 0.25) {
    return {
      tag: 'watchlist',
      reason: 'because this site has removal history.',
      notes: `Auto-suggested: ${removed}/${posts} seen posts were removed.`,
    };
  }

  return {
    tag: 'watchlist',
    reason: 'until the mod team classifies it.',
    notes: 'Auto-suggested: new or untagged site, review before trusting.',
  };
}
