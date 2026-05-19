import {
  addNote,
  deleteNote,
  getUserDigest,
  getUserPanel,
  type UserPanelResponse,
} from '../api';
import { USER_NOTE_LABELS, type UserNoteLabel } from '../../shared/labels';
import type { DigestWindow, DomainEntry, ModlogEntry, Note, RecentActivityItem, UserDigest } from '../../shared/types';
import {
  chip,
  createElement,
  el,
  errorPanel,
  formatNumber,
  formatPercent,
  formatRelative,
  loadingPanel,
  metric,
  panel,
  row,
  stack,
  type View,
} from './viewHelpers';

export function renderUsersIndex(): View {
  const element = createElement('section', 'panel lookup-panel');
  const form = createElement('form', 'lookup-form');
  const label = createElement('label');
  const input = createElement('input');
  const button = createElement('button', 'button', 'Open user');

  label.textContent = 'Username';
  input.type = 'text';
  input.name = 'username';
  input.placeholder = 'spez';
  input.autocomplete = 'off';
  button.type = 'submit';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const username = input.value.trim().replace(/^u\//i, '');
    if (username) {
      window.location.hash = `#/users/${encodeURIComponent(username)}`;
    }
  });

  form.append(label, input, button);
  element.append(form);

  return {
    title: 'Users',
    subtitle: 'Look up a redditor to review notes, summary, and activity.',
    element,
  };
}

export function renderUserPanel(name: string): View {
  const element = el('div', { className: 'stack' });

  const load = (activeWindow: DigestWindow = '30'): void => {
    element.replaceChildren(loadingPanel(`Loading u/${name}...`));
    void Promise.all([getUserPanel(name), getUserDigest(name, activeWindow)])
      .then(([panelPayload, digestPayload]) => {
        const resolvedName = panelPayload.name || name;
        if (resolvedName !== name && window.location.hash === `#/users/${encodeURIComponent(name)}`) {
          window.location.hash = `#/users/${encodeURIComponent(resolvedName)}`;
          return;
        }
        element.replaceChildren(renderUserContent(resolvedName, panelPayload, digestPayload.digest, activeWindow, load));
      })
      .catch((error: unknown) => {
        element.replaceChildren(errorPanel(error));
      });
  };

  load();

  return {
    title: `u/${name}`,
    subtitle: 'Notes, summary, recent activity, and site history.',
    element,
  };
}

function renderUserContent(
  name: string,
  payload: UserPanelResponse,
  digest: UserDigest,
  activeWindow: DigestWindow,
  reload: (window: DigestWindow) => void,
): HTMLElement {
  const summaryChips = [
    chip(`${payload.summary.removalCount} removals`, payload.summary.removalCount > 0 ? 'high' : undefined),
    chip(`${payload.summary.spamCount} spam`),
    payload.summary.lastLabel ? chip(payload.summary.lastLabel, payload.summary.lastLabel) : null,
  ];

  return stack(
    panel(
      el('h2', { text: 'User context' }),
      payload.account
        ? row(
            metric(`${payload.account.ageDays}d`, 'Account age'),
            metric(formatNumber(payload.account.commentKarma), 'Comment karma'),
            metric(formatNumber(payload.account.linkKarma), 'Link karma'),
            ...(payload.account.hasVerifiedEmail ? [chip('verified email', 'Trusted')] : []),
          )
        : row(metric('?', 'No account data')),
      row(...summaryChips.filter((item): item is HTMLElement => item !== null)),
    ),
    renderNotesPanel(name, payload.notes, activeWindow, reload),
    renderModActionsPanel(digest.recentModActions),
    renderDomainsPanel(payload.domains),
    renderRecentActivityPanel(payload.recentActivity),
    renderDigestPanel(name, digest, activeWindow, reload),
  );
}

function renderModActionsPanel(entries: ModlogEntry[]): HTMLElement {
  return panel(
    el('h2', { text: 'Recent mod actions' }),
    entries.length
      ? el('div', {
          className: 'list',
          children: entries.map((entry) =>
            el('div', {
              className: 'list-item',
              children: [
                el('div', {
                  className: 'list-item-header',
                  children: [row(chip(entry.action), el('span', { text: formatRelative(entry.ts) })), el('span', { text: entry.actor })],
                }),
                el('div', { className: 'list-item-body', text: entry.target }),
              ],
            }),
          ),
        })
      : el('p', { className: 'muted', text: 'No recent mod actions found.' }),
  );
}

function renderNotesPanel(
  name: string,
  notes: Note[],
  activeWindow: DigestWindow,
  reload: (window: DigestWindow) => void,
): HTMLElement {
  const notesList = notes.length
    ? el('div', {
        className: 'list',
        children: notes.map((note) => renderNoteItem(name, note, activeWindow, reload)),
      })
    : el('p', { className: 'muted', text: 'No shared notes for this user.' });

  return panel(el('h2', { text: 'Shared notes' }), notesList, renderAddNoteForm(name, activeWindow, reload));
}

function renderNoteItem(
  name: string,
  note: Note,
  activeWindow: DigestWindow,
  reload: (window: DigestWindow) => void,
): HTMLElement {
  const deleteButton = el('button', {
    className: 'button button-danger',
    text: 'Delete',
    onClick: () => {
      deleteButton.setAttribute('disabled', 'true');
      void deleteNote(name, note.id)
        .then(() => reload(activeWindow))
        .catch(() => {
          deleteButton.removeAttribute('disabled');
        });
    },
  });

  const metaChildren: (HTMLElement | string)[] = [
    el('span', { text: `by ${note.authorMod}` }),
    ...(note.refUrl
      ? [
          ' - ',
          el('a', {
            className: 'host-link',
            href: note.refUrl,
            text: 'reference',
            attrs: { target: '_blank', rel: 'noreferrer' },
          }),
        ]
      : []),
    ...(note.mirrorStatus === 'pending' ? [' - ', el('span', { text: '(syncing)' })] : []),
  ];

  return el('div', {
    className: 'list-item',
    children: [
      el('div', {
        className: 'list-item-header',
        children: [row(chip(note.label, note.label), el('span', { text: formatRelative(note.createdAt) })), deleteButton],
      }),
      el('div', { className: 'list-item-body', text: note.text }),
      el('div', { className: 'list-item-meta', children: metaChildren }),
    ],
  });
}

function renderAddNoteForm(
  name: string,
  activeWindow: DigestWindow,
  reload: (window: DigestWindow) => void,
): HTMLElement {
  const form = el('form', { className: 'note-form' });
  const select = el('select');
  const textArea = el('textarea');
  const refUrl = el('input');
  const button = el('button', { className: 'button button-accent', text: 'Save note' });

  for (const label of USER_NOTE_LABELS) {
    select.append(el('option', { text: label, attrs: { value: label } }));
  }

  textArea.name = 'text';
  textArea.required = true;
  refUrl.name = 'refUrl';
  refUrl.type = 'url';
  refUrl.placeholder = 'https://www.reddit.com/...';
  button.type = 'submit';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = textArea.value.trim();
    const ref = refUrl.value.trim();
    if (!text) return;

    button.setAttribute('disabled', 'true');
    void addNote(name, {
      label: select.value as UserNoteLabel,
      text,
      ...(ref ? { refUrl: ref } : {}),
    })
      .then(() => reload(activeWindow))
      .catch(() => {
        button.removeAttribute('disabled');
      });
  });

  form.append(
    el('label', { children: ['Label', select] }),
    el('label', { children: ['Note', textArea] }),
    el('label', { children: ['Reference URL', refUrl] }),
    button,
  );

  return form;
}

function renderDomainsPanel(domains: DomainEntry[]): HTMLElement {
  return panel(
    el('h2', { text: 'Sites seen recently' }),
    domains.length
      ? el('div', {
          className: 'list',
          children: domains.map((domain) =>
            el('div', {
              className: 'list-item',
              children: [
                el('div', {
                  className: 'list-item-header',
                  children: [
                    el('a', {
                      className: 'host-link',
                      href: `#/sites/${encodeURIComponent(domain.host)}`,
                      text: domain.host,
                      title: 'Open this site history and tag page.',
                      attrs: { 'aria-label': 'Open this site history and tag page.' },
                    }),
                    domain.tag ? chip(domain.tag, domain.tag) : chip('untagged'),
                  ],
                }),
                el('div', {
                  className: 'list-item-meta',
                  text: `${formatNumber(domain.postCount)} posts, ${formatNumber(domain.removedCount)} removals`,
                }),
              ],
            }),
          ),
        })
      : el('p', { className: 'muted', text: 'No recent sites found.' }),
  );
}

function renderRecentActivityPanel(items: RecentActivityItem[]): HTMLElement {
  return panel(
    el('h2', { text: 'Last 15 items in this sub' }),
    items.length
      ? el('div', {
          className: 'list',
          children: items.map((item) =>
            el('div', {
              className: 'list-item',
              children: [
                el('div', {
                  className: 'list-item-header',
                  children: [
                    row(
                      chip(item.kind),
                      el('span', { text: formatRelative(item.createdAt) }),
                      ...(item.removed ? [chip('removed', 'high')] : []),
                      ...(item.domain ? [chip(item.domain)] : []),
                    ),
                    el('span', { className: 'muted-small', text: `score ${formatNumber(item.score)}` }),
                  ],
                }),
                el('div', {
                  className: 'list-item-body',
                  text: item.title ?? item.body?.slice(0, 240) ?? '(no text)',
                }),
                ...(item.url
                  ? [
                      el('a', {
                        className: 'host-link',
                        href: item.url,
                        text: item.url,
                        attrs: { target: '_blank', rel: 'noreferrer' },
                      }),
                    ]
                  : []),
              ],
            }),
          ),
        })
      : el('p', { className: 'muted', text: 'No recent activity found.' }),
  );
}

function renderDigestPanel(
  name: string,
  digest: UserDigest,
  activeWindow: DigestWindow,
  reload: (window: DigestWindow) => void,
): HTMLElement {
  const windows: DigestWindow[] = ['7', '30', '90'];
  const controls = el('div', {
    className: 'segmented',
    children: windows.map((window) =>
      el('a', {
        href: `#/users/${encodeURIComponent(name)}`,
        text: `${window}d`,
        ...(window === activeWindow ? { className: 'active' } : {}),
        onClick: (event) => {
          event.preventDefault();
          reload(window);
        },
      }),
    ),
  });

  return panel(
    el('h2', { text: `${activeWindow}-day digest` }),
    controls,
    row(
      metric(formatNumber(digest.postCount), 'Posts'),
      metric(formatNumber(digest.commentCount), 'Comments'),
      metric(formatPercent(digest.removalRatio), 'Removal ratio', digest.controversial ? 'danger' : undefined),
      metric(formatNumber(digest.averageScore), 'Average score'),
    ),
  );
}
