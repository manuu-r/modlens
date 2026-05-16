import { getAudit, getExportChunk, startExport } from '../api';
import type { AuditEntry, ExportFormat, ExportKind, JsonValue } from '../../shared/types';
import {
  chip,
  el,
  errorPanel,
  formatDate,
  formatRelative,
  loadingPanel,
  normalizeHostInput,
  panel,
  row,
  stack,
  type View,
} from './viewHelpers';

const exportKinds: ExportKind[] = ['audit', 'notes', 'domains', 'modlog'];
const exportFormats: ExportFormat[] = ['csv', 'json'];
const exportKindLabels = {
  audit: 'audit trail',
  notes: 'user notes',
  domains: 'sites',
  modlog: 'mod log',
} satisfies Record<ExportKind, string>;

type AuditFilters = {
  actor?: string;
  action?: string;
  target?: string;
  site?: string;
};

export function renderAuditLog(): View {
  const element = el('div', { className: 'stack' });
  const content = el('div');
  const actorInput = el('input');
  const actionInput = el('input');
  const targetInput = el('input');
  const siteInput = el('input');
  const kindSelect = el('select');
  const formatSelect = el('select');
  const exportStatus = el('span', { className: 'muted-small' });
  const initialFilters = filtersFromHash();

  actorInput.value = initialFilters.actor ?? '';
  actionInput.value = initialFilters.action ?? '';
  targetInput.value = initialFilters.target ?? '';
  siteInput.value = initialFilters.site ?? '';
  actorInput.placeholder = 'actor';
  actionInput.placeholder = 'action';
  targetInput.placeholder = 'user, thing id, or target';
  siteInput.placeholder = 'site (e.g. example.com)';

  for (const kind of exportKinds) {
    kindSelect.append(el('option', { text: exportKindLabels[kind], attrs: { value: kind } }));
  }

  for (const format of exportFormats) {
    formatSelect.append(el('option', { text: format, attrs: { value: format } }));
  }

  const currentFilters = (): AuditFilters => {
    const actor = actorInput.value.trim();
    const action = actionInput.value.trim();
    const target = targetInput.value.trim();
    const site = siteInput.value.trim();
    return {
      ...(actor ? { actor } : {}),
      ...(action ? { action } : {}),
      ...(target ? { target } : {}),
      ...(site ? { site } : {}),
    };
  };

  const load = (cursor?: string, existingEntries: AuditEntry[] = []): void => {
    if (!cursor) {
      content.replaceChildren(loadingPanel('Loading audit log...'));
    }

    void getAudit(cursor, currentFilters())
      .then((payload) => {
        const entries = cursor ? [...existingEntries, ...payload.entries] : payload.entries;
        content.replaceChildren(renderAuditEntries(entries, payload.nextCursor, load));
      })
      .catch((error: unknown) => {
        content.replaceChildren(errorPanel(error));
      });
  };

  const applyButton = el('button', {
    className: 'button',
    text: 'Apply',
    onClick: () => {
      updateHashFromFilters(currentFilters());
      load();
    },
  });

  const exportButton = el('button', {
    className: 'button',
    text: 'Export',
    onClick: () => {
      exportButton.setAttribute('disabled', 'true');
      exportStatus.textContent = 'Starting export...';
      void runExport(kindSelect.value as ExportKind, formatSelect.value as ExportFormat)
        .then(() => {
          exportStatus.textContent = 'Export downloaded.';
        })
        .catch((error: unknown) => {
          exportStatus.replaceChildren(errorPanel(error));
        })
        .finally(() => exportButton.removeAttribute('disabled'));
    },
  });

  element.append(
    panel(
      el('h2', { text: 'Filters and export' }),
      el('div', {
        className: 'toolbar',
        children: [targetInput, siteInput, actorInput, actionInput, applyButton, kindSelect, formatSelect, exportButton, exportStatus],
      }),
    ),
    content,
  );
  load();

  return {
    title: 'Mod log',
    subtitle: 'Filter team actions and export audit data.',
    element,
  };
}

function renderAuditEntries(
  entries: AuditEntry[],
  nextCursor: string | undefined,
  load: (cursor?: string, existingEntries?: AuditEntry[]) => void,
): HTMLElement {
  if (entries.length === 0) {
    return panel(el('p', { className: 'muted', text: 'No audit entries found.' }));
  }

  return stack(
    el('div', {
      className: 'list',
      children: entries.map(renderAuditEntry),
    }),
    ...(nextCursor
      ? [
          el('button', {
            className: 'button',
            text: 'Load more',
            onClick: (event) => {
              const button = event.currentTarget;
              if (button instanceof HTMLButtonElement) {
                button.disabled = true;
              }
              load(nextCursor, entries);
            },
          }),
        ]
      : []),
  );
}

function renderAuditEntry(entry: AuditEntry): HTMLElement {
  const details =
    entry.before !== undefined || entry.after !== undefined
      ? el('details', {
          children: [
            el('summary', { text: 'diff' }),
            el('pre', {
              text: JSON.stringify(
                {
                  ...(entry.before !== undefined ? { before: entry.before } : {}),
                  ...(entry.after !== undefined ? { after: entry.after } : {}),
                } satisfies Record<string, JsonValue>,
                null,
                2,
              ),
            }),
          ],
        })
      : null;

  return el('div', {
    className: 'list-item',
    children: [
      el('div', {
        className: 'list-item-header',
        children: [
          row(
            chip(entry.action),
            el('span', { text: formatRelative(entry.ts) }),
          ),
          actorLink(entry.actor),
        ],
      }),
      el('div', {
        className: 'list-item-body',
        children: ['target: ', targetLink(entry)],
      }),
      el('div', {
        className: 'list-item-meta',
        children: [formatDate(entry.ts), ' · ', ...inlineLinks(entry), details],
      }),
    ],
  });
}

function actorLink(actor: string): HTMLElement {
  return el('a', {
    className: 'host-link',
    href: `#/audit?actor=${encodeURIComponent(actor)}`,
    text: actor,
    title: 'Filter mod log by this actor.',
    attrs: { 'aria-label': 'Filter mod log by this actor.' },
  });
}

function targetLink(entry: AuditEntry): HTMLElement {
  const { action, target } = entry;

  if (action.startsWith('domain.')) {
    return el('a', {
      className: 'host-link',
      href: `#/sites/${encodeURIComponent(target)}`,
      text: target,
    });
  }
  if (action.startsWith('triage.')) {
    return el('a', {
      className: 'host-link',
      href: `#/audit?target=${encodeURIComponent(target)}`,
      text: target,
    });
  }
  if (action.startsWith('note.') || action.startsWith('user.')) {
    return el('a', {
      className: 'host-link',
      href: `#/users/${encodeURIComponent(target)}`,
      text: target,
    });
  }
  return el('span', { text: target });
}

function inlineLinks(entry: AuditEntry): (HTMLElement | string)[] {
  const links: (HTMLElement | string)[] = [];
  const subject = (entry.before ?? entry.after) as { author?: unknown; url?: unknown } | null | undefined;
  if (subject && typeof subject === 'object' && !Array.isArray(subject)) {
    if (typeof subject.author === 'string' && subject.author) {
      links.push(
        el('a', {
          className: 'host-link',
          href: `#/users/${encodeURIComponent(subject.author)}`,
          text: `u/${subject.author}`,
        }),
        ' · ',
      );
    }
    if (typeof subject.url === 'string' && subject.url) {
      const host = normalizeHostInput(subject.url);
      if (host) {
        links.push(
          el('a', {
            className: 'host-link',
            href: `#/sites/${encodeURIComponent(host)}`,
            text: host,
          }),
          ' · ',
        );
      }
    }
  }
  return links;
}

async function runExport(kind: ExportKind, format: ExportFormat): Promise<void> {
  const started = await startExport({ kind, format });
  const parts: string[] = [];
  let cursor: string | undefined = started.cursor;
  let done = false;

  while (!done) {
    const chunk = await getExportChunk(started.token, cursor);
    if (chunk.pending) {
      await delay(800);
      continue;
    }

    parts.push(chunk.body);
    done = chunk.done;
    cursor = chunk.nextCursor;
    if (!done) {
      await delay(800);
    }
  }

  const blob = new Blob(parts, {
    type: format === 'json' ? 'application/json' : 'text/csv',
  });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  link.href = href;
  link.download = `modlens-${kind === 'domains' ? 'sites' : kind}-${date}.${format}`;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function filtersFromHash(): AuditFilters {
  const query = window.location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  const actor = params.get('actor')?.trim();
  const action = params.get('action')?.trim();
  const target = params.get('target')?.trim();
  const site = params.get('site')?.trim();
  return {
    ...(actor ? { actor } : {}),
    ...(action ? { action } : {}),
    ...(target ? { target } : {}),
    ...(site ? { site } : {}),
  };
}

function updateHashFromFilters(filters: AuditFilters): void {
  const params = new URLSearchParams();
  if (filters.target) params.set('target', filters.target);
  if (filters.site) params.set('site', filters.site);
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.action) params.set('action', filters.action);
  const query = params.toString();
  window.history.replaceState(null, '', query ? `#/audit?${query}` : '#/audit');
}

