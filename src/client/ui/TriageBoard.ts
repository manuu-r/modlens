import {
  applyRemovalReason,
  claimPresence,
  decideTriage,
  getTriage,
  getTriageContext,
  getTriageInsight,
  listRemovalReasons,
  releasePresence,
  touchPresence,
  type RemovalReasonRecord,
  type TriageBucket,
  type TriageDecision,
  type TriageResponse,
} from '../api';
import type { ContextSummary, MicroInsight, ReasonRef, TriageItem } from '../../shared/types';
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

let cachedReasons: RemovalReasonRecord[] = [];
let pickerOutsideHandlerInstalled = false;

function installPickerOutsideHandler(): void {
  if (pickerOutsideHandlerInstalled) return;
  pickerOutsideHandlerInstalled = true;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      for (const picker of document.querySelectorAll<HTMLElement>('.reason-picker')) {
        if (!picker.classList.contains('hidden') && !picker.parentElement?.contains(target)) {
          picker.classList.add('hidden');
        }
      }
    },
    { capture: true },
  );
}

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

    void Promise.all([
      getTriage(bucket, cursor),
      cursor ? Promise.resolve(null) : listRemovalReasons().catch(() => ({ reasons: [] as RemovalReasonRecord[] })),
    ])
      .then(([payload, reasonsResult]) => {
        if (reasonsResult) {
          cachedReasons = reasonsResult.reasons;
        }
        if (cursor) {
          appendTriagePage(content, payload);
          return;
        }
        content.replaceChildren(renderTriagePage(bucket, payload, cachedReasons, load));
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
  reasons: RemovalReasonRecord[],
  load: (cursor?: string) => void,
): HTMLElement {
  if (payload.items.length === 0) {
    return emptyPanel(
      `No items in the ${bucket} bucket. Queue fills as new posts, comments, and reports come in — or seed test data via the subreddit's three-dot menu.`,
    );
  }

  const list = el('div', {
    className: 'stack',
    attrs: { 'data-triage-list': bucket },
    children: [renderBulkToolbar(), ...payload.items.map((item) => renderTriageItem(item, reasons))],
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
    list.append(renderTriageItem(item, cachedReasons));
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

function renderTriageItem(item: TriageItem, reasons: RemovalReasonRecord[] = []): HTMLElement {
  const card = el('div', { className: 'triage-item' });
  card.dataset.thingId = item.thingId;
  card.dataset.author = item.author;

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

  const presenceChip = el('span', {
    className: 'presence-chip',
    attrs: { 'data-presence': item.thingId },
  });

  const actionsRow = el('div', { className: 'triage-item-actions' });
  actionsRow.append(
    el('button', {
      className: 'button button-accent',
      text: 'Approve',
      onClick: () => {
        disableDecisionButtons(card);
        void claimAndDecide(card, item, 'approve').catch(() => enableDecisionButtons(card));
      },
    }),
    renderRemoveButton(card, item, reasons),
    el('button', {
      className: 'button button-danger',
      text: 'Ignore reports',
      onClick: () => {
        disableDecisionButtons(card);
        void claimAndDecide(card, item, 'ignore').catch(() => enableDecisionButtons(card));
      },
    }),
  );

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
            presenceChip,
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
    renderMicroInsight(item.thingId),
    renderContextSummary(item.thingId),
    actionsRow,
  );

  // claim presence when this item is visible
  void claimPresence(item.thingId)
    .then(({ claimed, modName }) => {
      if (!claimed) {
        presenceChip.replaceChildren(chip(`Being reviewed by u/${modName}`, 'aged'));
      }
      startPresenceHeartbeat(item.thingId);
    })
    .catch(() => undefined);

  return card;
}

function renderRemoveButton(card: HTMLElement, item: TriageItem, reasons: RemovalReasonRecord[]): HTMLElement {
  if (reasons.length === 0) {
    return el('button', {
      className: 'button',
      text: 'Remove',
      onClick: () => {
        disableDecisionButtons(card);
        void claimAndDecide(card, item, 'remove').catch(() => enableDecisionButtons(card));
      },
    });
  }

  // Remove with reason picker
  const picker = el('div', { className: 'reason-picker hidden' });
  const toggleButton = el('button', {
    className: 'button',
    text: 'Remove ▾',
    title: 'Remove this queued item.',
    onClick: (event) => {
      event.stopPropagation();
      picker.classList.toggle('hidden');
    },
  });

  const quickRemove = el('button', {
    className: 'reason-picker-item',
    text: 'Remove (no reason)',
    onClick: () => {
      picker.classList.add('hidden');
      disableDecisionButtons(card);
      void claimAndDecide(card, item, 'remove').catch(() => enableDecisionButtons(card));
    },
  });
  picker.append(quickRemove);

  for (const reason of reasons) {
    const reasonBtn = el('button', {
      className: 'reason-picker-item',
      text: reason.title,
      title: reason.autoComment ? 'Will post comment' : reason.dmUser ? 'Will DM user' : 'Remove only',
      onClick: () => {
        picker.classList.add('hidden');
        disableDecisionButtons(card);
        void applyRemovalReason(reason.id, {
          thingId: item.thingId,
          author: item.author,
          ...(item.title !== undefined ? { title: item.title } : {}),
        })
          .then(() => {
            void releasePresence(item.thingId).catch(() => undefined);
            card.remove();
          })
          .catch(() => enableDecisionButtons(card));
      },
    });
    picker.append(reasonBtn);
  }

  const wrapper = el('div', {
    className: 'reason-picker-wrapper',
    children: [toggleButton, picker],
  });

  installPickerOutsideHandler();

  return wrapper;
}

async function claimAndDecide(card: HTMLElement, item: TriageItem, action: TriageDecision): Promise<void> {
  await claimPresence(item.thingId).catch(() => undefined);
  await decideTriage(item.thingId, action);
  void releasePresence(item.thingId).catch(() => undefined);
  card.remove();
}

function startPresenceHeartbeat(itemId: string): void {
  const intervalId = window.setInterval(() => {
    if (!document.querySelector(`[data-thing-id="${itemId}"]`)) {
      clearInterval(intervalId);
      void releasePresence(itemId).catch(() => undefined);
      return;
    }
    void touchPresence(itemId).catch(() => undefined);
  }, 60_000);
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

function renderMicroInsight(thingId: string): HTMLElement {
  const container = el('div', { className: 'micro-insight muted-small' });
  void getTriageInsight(thingId)
    .then(({ insight }) => {
      container.replaceChildren(buildMicroInsightBlock(insight));
    })
    .catch(() => {
      container.remove();
    });
  return container;
}

function buildMicroInsightBlock(insight: MicroInsight): HTMLElement {
  const sourceKind = insight.source === 'gemini' ? 'trusted' : undefined;
  return el('div', {
    className: `micro-insight micro-${insight.severity}`,
    children: [
      chip(insight.source === 'gemini' ? 'AI' : 'heuristic', sourceKind),
      chip(insight.label, severityChipKind(insight.severity)),
      el('span', { text: insight.line }),
    ],
  });
}

function severityChipKind(severity: MicroInsight['severity']): string | undefined {
  if (severity === 'high') return 'high';
  if (severity === 'medium') return 'aged';
  if (severity === 'low') return 'trusted';
  return undefined;
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
      container.replaceChildren(chip('Context unavailable', 'aged'));
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
