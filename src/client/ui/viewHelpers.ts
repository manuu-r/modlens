export type View = {
  title: string;
  subtitle?: string;
  element: HTMLElement;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    text?: string;
    html?: string;
    title?: string;
    href?: string;
    onClick?: (event: MouseEvent) => void;
    children?: (HTMLElement | string | null | undefined)[];
    attrs?: Record<string, string>;
  },
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options?.className) node.className = options.className;
  if (options?.text !== undefined) node.textContent = options.text;
  if (options?.html !== undefined) node.innerHTML = options.html;
  if (options?.title !== undefined) node.title = options.title;
  if (options?.href !== undefined && 'href' in node) {
    (node as unknown as HTMLAnchorElement).href = options.href;
  }
  if (options?.onClick) {
    node.addEventListener('click', (event) => {
      options.onClick?.(event as MouseEvent);
    });
  }
  if (options?.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) node.setAttribute(k, v);
  }
  if (options?.children) {
    for (const child of options.children) {
      if (child == null) continue;
      node.append(child);
    }
  }
  if (node instanceof HTMLButtonElement) {
    applyButtonDescription(node, options?.text);
  }
  return node;
}

function applyButtonDescription(button: HTMLButtonElement, text: string | undefined): void {
  const label = (text ?? button.textContent ?? '').trim();
  const description = button.title || defaultButtonDescription(label);
  if (!description) return;
  button.title = description;
  if (!button.getAttribute('aria-label')) {
    button.setAttribute('aria-label', description);
  }
}

function defaultButtonDescription(label: string): string | undefined {
  const descriptions: Record<string, string> = {
    Open: 'Open the entered user or item.',
    'Open user': 'Open this user context panel.',
    'Open site': 'Parse this URL and open the site history.',
    Apply: 'Apply the current filters.',
    Export: 'Export the selected records.',
    'Load more': 'Load the next page of results.',
    Delete: 'Delete this saved note or rule.',
    'Dry run': 'Preview which queue items this rule would affect.',
    'Send test alert': 'Send a test alert to configured webhooks.',
    'Save note': 'Save this note for the mod team.',
    'Save tag': 'Save this site tag and note for the mod team.',
    'Apply suggested tag': 'Automatically save the suggested site tag.',
    'Remove tag': 'Clear the current site tag but keep site history.',
    Approve: 'Approve this queued item.',
    Remove: 'Remove this queued item.',
    'Ignore reports': 'Clear this item from ModLens without removing it.',
    'Select visible': 'Select or clear all visible queue items.',
    'Approve selected': 'Approve all selected queue items.',
    'Remove selected': 'Remove all selected queue items.',
  };
  return descriptions[label];
}

// Back-compat (older code paths).
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  return el(tag, {
    ...(className === undefined ? {} : { className }),
    ...(text === undefined ? {} : { text }),
  });
}

export function panel(...children: (HTMLElement | string)[]): HTMLElement {
  return el('section', { className: 'panel', children });
}

export function emptyPanel(message: string): HTMLElement {
  return el('section', {
    className: 'panel state-panel',
    children: [el('p', { className: 'muted', text: message })],
  });
}

export function loadingPanel(message: string): HTMLElement {
  return el('section', {
    className: 'panel state-panel',
    children: [el('p', { className: 'muted', text: message })],
  });
}

export function errorPanel(error: unknown): HTMLElement {
  return el('section', {
    className: 'panel state-panel error-panel',
    children: [
      el('h2', { text: 'Unable to load' }),
      el('p', {
        className: 'muted',
        text: error instanceof Error ? error.message : String(error),
      }),
    ],
  });
}

export function chip(text: string, kind?: string): HTMLElement {
  return el('span', { className: `chip${kind ? ' chip-' + kind : ''}`, text });
}

export function row(...children: HTMLElement[]): HTMLElement {
  return el('div', { className: 'row', children });
}

export function stack(...children: HTMLElement[]): HTMLElement {
  return el('div', { className: 'stack', children });
}

export function metric(value: string | number, label: string, kind?: string): HTMLElement {
  return el('div', {
    className: `metric${kind ? ' metric-' + kind : ''}`,
    children: [
      el('div', { className: 'metric-value', text: String(value) }),
      el('div', { className: 'metric-label', text: label }),
    ],
  });
}

export function placeholderView(title: string, subtitle: string): View {
  return { title, subtitle, element: emptyPanel(subtitle) };
}

export function replaceWithPromise<T>(
  target: HTMLElement,
  promise: Promise<T>,
  render: (payload: T) => HTMLElement,
): void {
  promise
    .then((payload) => {
      target.replaceChildren(render(payload));
    })
    .catch((error: unknown) => {
      target.replaceChildren(errorPanel(error));
    });
}

export function routeParam(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return fallback;
  }
}

export function formatRelative(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 1) return future ? 'in <1m' : 'just now';
  if (minutes < 60) return `${future ? 'in ' : ''}${minutes}m${future ? '' : ' ago'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${future ? 'in ' : ''}${hours}h${future ? '' : ' ago'}`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${future ? 'in ' : ''}${days}d${future ? '' : ' ago'}`;
  return new Date(ts).toLocaleDateString();
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

export function normalizeHostInput(value: string): string {
  const raw = value.trim();
  if (!raw) return '';

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^www\./, '');
  }
}

export function table(headers: string[], rows: HTMLElement[][]): HTMLElement {
  const tableEl = el('table', { className: 'data-table' });
  const thead = el('thead', {
    children: [
      el('tr', {
        children: headers.map((h) => el('th', { text: h })),
      }),
    ],
  });
  const tbody = el('tbody', {
    children: rows.map((cells) =>
      el('tr', {
        children: cells.map((cell) => el('td', { children: [cell] })),
      }),
    ),
  });
  tableEl.append(thead, tbody);
  return tableEl;
}

export function cell(text: string | number, className?: string): HTMLElement {
  return el('span', { className: className ?? '', text: String(text ?? '') });
}

// Preformatted JSON is kept as a last-resort fallback for debug surfaces.
export function preformattedPanel(payload: unknown): HTMLElement {
  return el('section', {
    className: 'panel data-panel',
    children: [el('pre', { text: JSON.stringify(payload, null, 2) })],
  });
}
