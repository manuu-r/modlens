import {
  decideTriage,
  getTriage,
  getTriageContext,
  type TriageBucket,
  type TriageDecision,
  type TriageResponse,
} from '../api';
import type { ContextSummary, ReasonRef, TriageItem } from '../../shared/types';
import {
  chip,
  createElement,
  el,
  emptyPanel,
  errorPanel,
  formatRelative,
  loadingPanel,
  normalizeHostInput,
  type View,
} from './viewHelpers';

const buckets: TriageBucket[] = ['high', 'aged', 'normal'];

export function renderTriageBoard(bucket: TriageBucket = 'high'): View {
  const element = createElement('div', 'stack');
  const controls = createElement('div', 'segmented');
  const content = createElement('div');

  for (const item of buckets) {
    const link = createElement('a', item === bucket ? 'active' : undefined, item);
    link.href = `#/triage/${item}`;
    controls.append(link);
  }

  const load = (cursor?: string): void => {
    if (!cursor) {
      content.replaceChildren(loadingPanel(`Loading ${bucket} triage...`));
    }

    void getTriage(bucket, cursor)
      .then((payload) => {
        if (cursor) {
          appendTriagePage(content, payload);
          return;
        }
        content.replaceChildren(renderTriagePage(bucket, payload, load));
      })
      .catch((error: unknown) => {
        content.replaceChildren(errorPanel(error));
      });
  };

  load();
  element.append(controls, content);

  return {
    title: 'Queue',
    subtitle: `${bucket} review bucket.`,
    element,
  };
}

export function submitTriageDecision(thingId: string, action: TriageDecision): Promise<unknown> {
  return decideTriage(thingId, action);
}

function renderTriagePage(
  bucket: TriageBucket,
  payload: TriageResponse,
  load: (cursor?: string) => void,
): HTMLElement {
  if (payload.items.length === 0) {
    return emptyPanel('No items in this bucket.');
  }

  const list = el('div', {
    className: 'stack',
    attrs: { 'data-triage-list': bucket },
    children: [renderBulkToolbar(), ...payload.items.map((item) => renderTriageItem(item))],
  });

  if (payload.nextCursor) {
    list.append(renderLoadMoreButton(payload.nextCursor, load));
  }

  return list;
}

function appendTriagePage(content: HTMLElement, payload: TriageResponse): void {
  const list = content.querySelector<HTMLElement>('[data-triage-list]');
  const oldLoadMore = content.querySelector<HTMLElement>('[data-load-more]');
  oldLoadMore?.remove();

  if (!list) return;

  for (const item of payload.items) {
    list.append(renderTriageItem(item));
  }

  if (payload.nextCursor) {
    list.append(renderLoadMoreButton(payload.nextCursor, (cursor) => appendLoadMore(content, payload.bucket, cursor)));
  }
}

function appendLoadMore(content: HTMLElement, bucket: TriageBucket, cursor?: string): void {
  if (!cursor) return;

  void getTriage(bucket, cursor)
    .then((payload) => appendTriagePage(content, payload))
    .catch((error: unknown) => {
      content.append(errorPanel(error));
    });
}

function renderLoadMoreButton(cursor: string, load: (cursor?: string) => void): HTMLElement {
  return el('button', {
    className: 'button',
    text: 'Load more',
    attrs: { 'data-load-more': 'true' },
    onClick: (event) => {
      const button = event.currentTarget;
      if (button instanceof HTMLButtonElement) {
        button.disabled = true;
      }
      load(cursor);
    },
  });
}

function renderTriageItem(item: TriageItem): HTMLElement {
  const card = el('div', { className: 'triage-item' });
  card.dataset.thingId = item.thingId;
  card.dataset.author = item.author;
  const actions: Array<{ label: string; decision: TriageDecision; className: string }> = [
    { label: 'Approve', decision: 'approve', className: 'button button-accent' },
    { label: 'Remove', decision: 'remove', className: 'button' },
    { label: 'Ignore reports', decision: 'ignore', className: 'button button-danger' },
  ];

  const reasonRefs = resolveReasons(item);
  const metaParts: (HTMLElement | string)[] = [
    chip(item.kind),
    chip(`score ${item.score}`),
    ...joinDriverChips(reasonRefs),
    ...(item.reports?.length ? [chip(`${item.reports.length} reports`, 'aged')] : []),
    el('a', {
      className: 'chip',
      href: `#/audit?target=${encodeURIComponent(item.author)}`,
      text: 'mod log',
    }),
  ];

  card.append(
    el('div', {
      className: 'list-item-header',
      children: [
        el('div', {
          className: 'row',
          children: [
            renderSelectionBox(item),
            el('a', {
              className: 'host-link',
              href: `#/users/${encodeURIComponent(item.author)}`,
              text: `u/${item.author}`,
            }),
          ],
        }),
        el('span', { className: 'muted-small', text: formatRelative(item.createdAt) }),
      ],
    }),
    el('div', {
      className: 'list-item-body',
      children: [
        el('strong', { text: item.title ?? '(comment)' }),
        ...renderItemUrlLinks(item.url),
      ],
    }),
    el('div', { className: 'row', children: metaParts }),
    renderContextSummary(item.thingId),
    el('div', {
      className: 'triage-item-actions',
      children: actions.map((action) =>
        el('button', {
          className: action.className,
          text: action.label,
          onClick: () => {
            disableDecisionButtons(card);
            void decideTriage(item.thingId, action.decision)
              .then(() => card.remove())
              .catch(() => enableDecisionButtons(card));
          },
        }),
      ),
    }),
  );

  return card;
}

function resolveReasons(item: TriageItem): ReasonRef[] {
  if (item.reasonRefs?.length) return item.reasonRefs;
  return item.reasons.map((label) => ({ label }));
}

function joinDriverChips(refs: ReasonRef[]): HTMLElement[] {
  return refs.map((ref) => driverChip(ref));
}

function driverChip(ref: ReasonRef): HTMLElement {
  if (ref.sourceRuleId) {
    return el('a', {
      className: 'chip',
      href: `#/rules?focus=${encodeURIComponent(ref.sourceRuleId)}`,
      text: ref.label,
      title: `Source: rule ${ref.sourceRuleId}`,
      attrs: { 'aria-label': `Rule ${ref.sourceRuleId}` },
    });
  }
  if (ref.sourceFact) {
    return el('span', { className: 'chip', text: ref.label, title: `Source fact: ${ref.sourceFact}` });
  }
  return chip(ref.label);
}

function renderContextSummary(thingId: string): HTMLElement {
  const container = el('div', {
    className: 'context-summary muted-small',
    text: 'Context: loading...',
  });
  void getTriageContext(thingId)
    .then(({ summary }) => {
      container.replaceChildren(buildContextBlock(summary));
    })
    .catch(() => {
      container.remove();
    });
  return container;
}

function buildContextBlock(summary: ContextSummary): HTMLElement {
  const block = el('div', { className: `context-summary context-${summary.severity}` });

  block.append(
    el('div', {
      className: 'context-line context-facts',
      children: [el('span', { className: 'context-label', text: 'Facts' }), ' ', el('span', { text: summary.facts })],
    }),
  );

  if (summary.riskDrivers.length > 0) {
    block.append(
      el('div', {
        className: 'context-line context-risk',
        children: [
          el('span', { className: 'context-label', text: 'Risk' }),
          ' ',
          ...joinDrivers(summary.riskDrivers),
        ],
      }),
    );
  }

  block.append(
    el('div', {
      className: 'context-line context-suggest',
      children: [
        el('span', { className: 'context-label', text: 'Suggest' }),
        ' ',
        summary.suggestion.href
          ? el('a', {
              className: 'host-link',
              href: summary.suggestion.href,
              text: summary.suggestion.text,
            })
          : el('span', { text: summary.suggestion.text }),
      ],
    }),
  );

  if (summary.patterns.length > 0) {
    block.append(
      el('div', {
        className: 'context-line context-patterns',
        children: [
          el('span', { className: 'context-label', text: 'Patterns' }),
          ' ',
          ...summary.patterns.flatMap((pattern, idx) => [
            idx > 0 ? (' · ' as string) : ('' as string),
            pattern.evidence[0]
              ? el('a', {
                  className: 'host-link',
                  href: pattern.evidence[0].href,
                  text: pattern.label,
                })
              : el('span', { text: pattern.label }),
          ]),
        ],
      }),
    );
  }

  return block;
}

function joinDrivers(drivers: ReasonRef[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  drivers.forEach((driver, idx) => {
    if (idx > 0) out.push(el('span', { className: 'context-divider', text: ' · ' }));
    out.push(driverChip(driver));
  });
  return out;
}

function renderItemUrlLinks(url: string | undefined): (HTMLElement | string)[] {
  if (!url) return [];

  const host = normalizeHostInput(url);
  return [
    ' ',
    ...(host
      ? [
          el('a', {
            className: 'host-link',
            href: `#/sites/${encodeURIComponent(host)}`,
            text: `site: ${host}`,
            title: 'Open this site history and tag page.',
            attrs: { 'aria-label': 'Open this site history and tag page.' },
          }),
          ' ',
        ]
      : []),
    el('a', {
      className: 'host-link',
      href: url,
      text: 'open link',
      title: 'Open the original queued link.',
      attrs: { target: '_blank', rel: 'noreferrer', 'aria-label': 'Open the original queued link.' },
    }),
  ];
}

function renderSelectionBox(item: TriageItem): HTMLElement {
  const label = el('label', { className: 'queue-select' });
  const input = el('input');
  input.type = 'checkbox';
  input.value = item.thingId;
  input.dataset.queueSelect = 'true';
  label.append(input, el('span', { text: 'select' }));
  return label;
}

function renderBulkToolbar(): HTMLElement {
  const selectedCount = el('span', { className: 'muted-small', text: '0 selected' });
  const selectVisible = el('button', {
    className: 'button',
    text: 'Select visible',
    onClick: (event) => {
      const root = findTriageList(event.currentTarget);
      if (!root) return;
      const boxes = root.querySelectorAll<HTMLInputElement>('input[data-queue-select]');
      const shouldSelect = Array.from(boxes).some((box) => !box.checked);
      for (const box of boxes) {
        box.checked = shouldSelect;
      }
      updateBulkCount(root);
    },
  });
  const approve = bulkButton('Approve selected', 'approve');
  const remove = bulkButton('Remove selected', 'remove');
  const ignore = bulkButton('Ignore reports', 'ignore');

  const toolbar = el('div', {
    className: 'queue-bulk',
    children: [selectedCount, selectVisible, approve, remove, ignore],
  });

  toolbar.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.queueSelect) {
      const root = findTriageList(target);
      if (root) updateBulkCount(root);
    }
  });

  return toolbar;
}

function bulkButton(label: string, decision: TriageDecision): HTMLElement {
  return el('button', {
    className: decision === 'approve' ? 'button button-accent' : decision === 'ignore' ? 'button button-danger' : 'button',
    text: label,
    onClick: (event) => {
      const root = findTriageList(event.currentTarget);
      if (!root) return;
      const selected = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-queue-select]:checked'));
      if (selected.length === 0) return;
      setBulkDisabled(root, true);
      void Promise.all(
        selected.map((box) =>
          decideTriage(box.value, decision).then(() => {
            box.closest<HTMLElement>('.triage-item')?.remove();
          }),
        ),
      )
        .then(() => updateBulkCount(root))
        .catch((error: unknown) => {
          root.append(errorPanel(error));
        })
        .finally(() => setBulkDisabled(root, false));
    },
  });
}

function findTriageList(start: EventTarget | null): HTMLElement | null {
  return start instanceof HTMLElement ? start.closest<HTMLElement>('[data-triage-list]') : null;
}

function updateBulkCount(root: HTMLElement): void {
  const selected = root.querySelectorAll<HTMLInputElement>('input[data-queue-select]:checked').length;
  const label = root.querySelector<HTMLElement>('.queue-bulk .muted-small');
  if (label) {
    label.textContent = `${selected} selected`;
  }
}

function setBulkDisabled(root: HTMLElement, disabled: boolean): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.queue-bulk button')) {
    button.disabled = disabled;
  }
}

function disableDecisionButtons(card: HTMLElement): void {
  for (const button of card.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = true;
  }
}

function enableDecisionButtons(card: HTMLElement): void {
  for (const button of card.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = false;
  }
}
