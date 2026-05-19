import { getModlogInsights, type InsightsRange } from '../api';
import type { DomainEntry, ModlogInsights } from '../../shared/types';
import {
  cell,
  chip,
  createElement,
  el,
  formatNumber,
  loadingPanel,
  panel,
  replaceWithPromise,
  stack,
  table,
  type View,
} from './viewHelpers';

const ranges: InsightsRange[] = ['7d', '30d', '90d'];

export function renderModLogInsights(range: InsightsRange = '7d'): View {
  const element = createElement('div', 'stack');
  const controls = createElement('div', 'segmented');
  const content = createElement('div');

  for (const item of ranges) {
    const link = createElement('a', item === range ? 'active' : undefined, item);
    link.href = `#/insights/${item}`;
    controls.append(link);
  }

  content.append(loadingPanel(`Loading ${range} insights...`));
  replaceWithPromise(content, getModlogInsights(range), renderInsightsContent);
  element.append(controls, content);

  return {
    title: 'Insights',
    subtitle: `Moderator activity over the last ${range}.`,
    element,
  };
}

function renderInsightsContent(insights: ModlogInsights): HTMLElement {
  return stack(
    renderPerModPanel(insights.perModTotals),
    renderActionHistogramPanel(insights.actionHistogram),
    renderHeatmapPanel(insights.hourOfWeek),
    renderRemovedDomainsPanel(insights.topRemovedDomains),
    renderTargetedUsersPanel(insights.topTargetedUsers),
  );
}

function renderPerModPanel(perModTotals: Record<string, number>): HTMLElement {
  const entries = Object.entries(perModTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  const max = Math.max(1, ...entries.map(([, count]) => count));

  return panel(
    el('h2', { text: 'Actions per mod' }),
    entries.length
      ? el('div', {
          children: entries.map(([name, count]) => renderBarRow(name, count, max)),
        })
      : el('p', { className: 'muted', text: 'No mod actions found for this range.' }),
  );
}

function renderBarRow(label: string, count: number, max: number): HTMLElement {
  const fill = el('div', { className: 'bar-fill' });
  fill.style.width = `${Math.max(2, (count / max) * 100)}%`;

  return el('div', {
    className: 'bar-row',
    children: [
      el('span', { text: label }),
      el('div', { className: 'bar-track', children: [fill] }),
      el('span', { text: formatNumber(count) }),
    ],
  });
}

function renderActionHistogramPanel(actionHistogram: Record<string, number>): HTMLElement {
  const rows = Object.entries(actionHistogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([action, count]) => [cell(action), cell(formatNumber(count))]);

  return panel(
    el('h2', { text: 'Action types' }),
    rows.length ? table(['Action', 'Count'], rows) : el('p', { className: 'muted', text: 'No action counts found.' }),
  );
}

function renderHeatmapPanel(hourOfWeek: number[][]): HTMLElement {
  const max = Math.max(0, ...hourOfWeek.flat());
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cells: HTMLElement[] = [];

  for (let day = 0; day < 7; day += 1) {
    cells.push(el('div', { className: 'heatmap-label', text: days[day] ?? '' }));
    const rowValues = hourOfWeek[day] ?? [];
    for (let hour = 0; hour < 24; hour += 1) {
      const value = rowValues[hour] ?? 0;
      const cellEl = el('div', {
        className: 'heatmap-cell',
        title: `${hour}:00 - ${value} actions`,
      });
      if (max > 0 && value > 0) {
        cellEl.style.backgroundColor = `rgba(45,212,191,${Math.max(0.12, value / max)})`;
      }
      cells.push(cellEl);
    }
  }

  return panel(el('h2', { text: 'Activity by hour' }), el('div', { className: 'heatmap', children: cells }));
}

function renderRemovedDomainsPanel(domains: DomainEntry[]): HTMLElement {
  return panel(
    el('h2', { text: 'Top removed sites' }),
    domains.length
      ? table(
          ['Host', 'Tag', 'Removed in range', 'Posts seen'],
          domains.map((domain) => [
            el('a', {
              className: 'host-link',
              href: `#/sites/${encodeURIComponent(domain.host)}`,
              text: domain.host,
              title: 'Open this site history and tag page.',
              attrs: { 'aria-label': 'Open this site history and tag page.' },
            }),
            domain.tag ? chip(domain.tag, domain.tag) : cell('-'),
            cell(formatNumber(domain.removedCount)),
            cell(formatNumber(domain.postCount)),
          ]),
        )
      : el('p', { className: 'muted', text: 'No removed sites found.' }),
  );
}

function renderTargetedUsersPanel(users: Array<{ name: string; count: number }>): HTMLElement {
  return panel(
    el('h2', { text: 'Top targeted users' }),
    users.length
      ? table(
          ['Username', 'Decisions made'],
          users.map((user) => [
            el('a', {
              className: 'host-link',
              href: `#/users/${encodeURIComponent(user.name)}`,
              text: `u/${user.name}`,
            }),
            cell(formatNumber(user.count)),
          ]),
        )
      : el('p', { className: 'muted', text: 'No targeted users found.' }),
  );
}
