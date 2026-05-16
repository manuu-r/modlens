import { getAlertsConfig, getRecentAlerts, testAlert } from '../api';
import type { AlertConfig, AlertLinks, AlertRecord } from '../../shared/types';
import {
  chip,
  el,
  errorPanel,
  formatRelative,
  loadingPanel,
  metric,
  panel,
  replaceWithPromise,
  row,
  stack,
  type View,
} from './viewHelpers';

export function renderAlertsConfig(): View {
  const element = el('div', { className: 'stack' });

  element.append(loadingPanel('Loading alert config...'));
  replaceWithPromise(element, getAlertsConfig(), ({ config }) => renderAlertContent(config));

  return {
    title: 'Alerts',
    subtitle: 'Webhook delivery status, recent fires, and test.',
    element,
  };
}

function renderAlertContent(config: AlertConfig): HTMLElement {
  const status = el('div', { className: 'muted-small' });

  const testButton = el('button', {
    className: 'button button-accent',
    text: 'Send test alert',
    onClick: () => {
      testButton.setAttribute('disabled', 'true');
      status.textContent = 'Sending test alert...';
      void testAlert()
        .then((payload) => {
          status.replaceChildren(
            ...(payload.targets.length
              ? payload.targets.map((target) => chip(target, 'Trusted'))
              : [el('span', { text: 'Rate limited or no webhook configured.' })]),
          );
        })
        .catch((error: unknown) => {
          status.replaceChildren(errorPanel(error));
        })
        .finally(() => testButton.removeAttribute('disabled'));
    },
  });

  return stack(
    panel(
      el('h2', { text: 'Webhook status' }),
      row(
        metric(config.discordWebhookUrl ? 'yes' : '-', 'Discord'),
        metric(config.slackWebhookUrl ? 'yes' : '-', 'Slack'),
        metric(config.customWebhookUrl ? 'yes' : '-', 'Custom'),
        metric(config.highBacklogThreshold, 'High backlog threshold'),
      ),
    ),
    panel(
      el('h2', { text: 'Enabled types' }),
      config.enabledTypes.length
        ? row(...config.enabledTypes.map((type) => chip(type)))
        : el('p', { className: 'muted', text: 'No alert types enabled.' }),
    ),
    renderRecentAlertsPanel(),
    panel(
      el('h2', { text: 'Preferences' }),
      el('p', {
        className: 'muted',
        text:
          "Webhook URLs and threshold are managed in Reddit's app install settings. Use the subreddit menu -> 'ModLens: Configure alerts' to toggle alert types.",
      }),
    ),
    panel(el('h2', { text: 'Test delivery' }), row(testButton), status),
  );
}

function renderRecentAlertsPanel(): HTMLElement {
  const container = el('div', { children: [loadingPanel('Loading recent alerts...')] });
  void getRecentAlerts(25)
    .then(({ alerts }) => {
      container.replaceChildren(
        panel(
          el('h2', { text: 'Recent alerts' }),
          alerts.length
            ? el('div', {
                className: 'list',
                children: alerts.map(renderAlertRow),
              })
            : el('p', { className: 'muted', text: 'No alerts have fired recently.' }),
        ),
      );
    })
    .catch((error: unknown) => container.replaceChildren(errorPanel(error)));
  return container;
}

function renderAlertRow(record: AlertRecord): HTMLElement {
  const deliveredChip =
    record.delivered.length > 0
      ? row(...record.delivered.map((target) => chip(target, 'trusted')))
      : el('span', { className: 'muted-small', text: 'no webhook configured' });

  return el('div', {
    className: 'list-item',
    children: [
      el('div', {
        className: 'list-item-header',
        children: [
          row(chip(record.type, record.type), el('span', { text: formatRelative(record.ts) })),
          deliveredChip,
        ],
      }),
      el('div', {
        className: 'list-item-meta',
        children: renderLinks(record.links),
      }),
    ],
  });
}

function renderLinks(links: AlertLinks): (HTMLElement | string)[] {
  const parts: (HTMLElement | string)[] = [];
  const entries: Array<[keyof AlertLinks, string]> = [
    ['queue', 'queue'],
    ['author', 'author'],
    ['site', 'site'],
    ['item', 'item'],
  ];
  for (const [key, label] of entries) {
    const href = links[key];
    if (!href) continue;
    if (parts.length > 0) parts.push(' · ');
    parts.push(
      el('a', {
        className: 'host-link',
        href,
        text: label,
      }),
    );
  }
  if (parts.length === 0) {
    parts.push(el('span', { className: 'muted-small', text: 'no deep links' }));
  }
  return parts;
}
