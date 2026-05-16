import { getBootstrap, type BootstrapResponse } from '../api';
import {
  cell,
  chip,
  el,
  loadingPanel,
  metric,
  panel,
  replaceWithPromise,
  row,
  stack,
  table,
  type View,
} from './viewHelpers';

export function renderSettings(): View {
  const element = el('div', { className: 'stack' });

  element.append(loadingPanel('Loading settings snapshot...'));
  replaceWithPromise(element, getBootstrap(), renderSettingsContent);

  return {
    title: 'Settings',
    subtitle: "Configured in Reddit's app install settings - this view is read-only.",
    element,
  };
}

function renderSettingsContent(bootstrap: BootstrapResponse): HTMLElement {
  return stack(
    panel(
      el('h2', { text: 'Install context' }),
      row(
        metric(bootstrap.subreddit || bootstrap.subredditName, 'Subreddit'),
        metric(bootstrap.viewerName, 'Viewer'),
        metric(bootstrap.version, 'App version'),
      ),
    ),
    panel(
      el('h2', { text: 'Configuration' }),
      table(
        ['Setting', 'Value'],
        [
          [cell('Subreddit name'), cell(bootstrap.subredditName)],
          [cell('ModLens post id'), cell(bootstrap.dashboardPostId ?? '-')],
          [cell('Alerts configured'), cell(bootstrap.alerts.configured ? 'yes' : 'no')],
          [cell('High backlog threshold'), cell(bootstrap.alerts.highBacklogThreshold)],
          [cell('AI one-line insights'), cell(bootstrap.ai.microInsightsEnabled ? 'enabled' : 'disabled')],
          [cell('Gemini configured'), cell(bootstrap.ai.geminiConfigured ? 'yes' : 'no')],
          [cell('Gemini model'), cell(bootstrap.ai.model)],
        ],
      ),
    ),
    panel(
      el('h2', { text: 'Mod permissions' }),
      bootstrap.modPerms.length ? row(...bootstrap.modPerms.map((perm) => chip(perm))) : el('p', { className: 'muted', text: 'No permissions returned.' }),
    ),
    panel(
      el('h2', { text: 'Enabled features' }),
      bootstrap.features.length ? row(...bootstrap.features.map((feature) => chip(feature))) : el('p', { className: 'muted', text: 'No features enabled.' }),
    ),
  );
}
