import type { BootstrapResponse, InsightsRange, TriageBucket } from '../api';
import { renderAlertsConfig } from './AlertsConfig';
import { renderAuditLog } from './AuditLog';
import { renderDomainPanel, renderDomainsIndex } from './DomainPanel';
import { renderModLogInsights } from './ModLogInsights';
import { renderRemovalReasonEditor } from './RemovalReasonEditor';
import { renderRulesEditor } from './RulesEditor';
import { renderSettings } from './Settings';
import { renderTriageBoard } from './TriageBoard';
import { renderUserPanel, renderUsersIndex } from './UserPanel';
import { createElement, el, placeholderView, routeParam, type View } from './viewHelpers';

type NavItem = {
  label: string;
  href: string;
};

const navItems: NavItem[] = [
  { label: 'Queue', href: '#/triage' },
  { label: 'Users', href: '#/users' },
  { label: 'Mod log', href: '#/audit' },
  { label: 'Sites', href: '#/sites' },
  { label: 'Rules', href: '#/rules' },
  { label: 'Alerts', href: '#/alerts' },
  { label: 'Insights', href: '#/insights' },
  { label: 'Removal', href: '#/removal' },
  { label: 'Settings', href: '#/settings' },
];

export class Shell {
  private readonly root: HTMLElement;
  private readonly nav = createElement('nav', 'sidebar');
  private readonly title = createElement('h1', undefined, 'ModLens');
  private readonly subtitle = createElement('p', 'page-subtitle', 'Loading context...');
  private readonly content = createElement('main', 'content');
  private context?: BootstrapResponse;
  private error: string | undefined;

  constructor(root: HTMLElement) {
    this.root = root;
    window.addEventListener('hashchange', () => {
      this.paintRoute();
    });
  }

  render(): void {
    const layout = createElement('div', 'app-shell');
    const brand = createElement('div', 'brand');
    const pageHeader = createElement('header', 'page-header');

    const brandLink = el('a', {
      className: 'brand-name',
      href: '#/triage/high',
      text: 'ModLens',
      title: 'Open the ModLens queue.',
    });
    brand.append(brandLink);
    this.nav.append(brand, this.createNavList(), this.createUserLookup());
    pageHeader.append(this.title, this.subtitle);
    this.content.append(pageHeader, createElement('div', 'route-content'));
    layout.append(this.nav, this.content);
    this.root.replaceChildren(layout);
    this.paintRoute();
  }

  setContext(context: BootstrapResponse): void {
    this.context = context;
    this.error = undefined;
    this.applyNavigationIntent(context);
    this.paintRoute();
  }

  setError(message: string): void {
    this.error = message;
    this.paintRoute();
  }

  private createNavList(): HTMLElement {
    const list = createElement('div', 'nav-list');

    for (const item of navItems) {
      const link = createElement('a', undefined, item.label);
      link.href = item.href;
      link.dataset.navHref = item.href;
      list.append(link);
    }

    return list;
  }

  private createUserLookup(): HTMLElement {
    const form = createElement('form', 'sidebar-lookup');
    const label = createElement('label', 'sr-only', 'Search author');
    const input = createElement('input');
    const button = createElement('button', 'button', 'Go');

    input.type = 'text';
    input.name = 'username';
    input.placeholder = 'author';
    input.autocomplete = 'off';
    button.title = 'Search for a different author context.';
    button.setAttribute('aria-label', button.title);
    button.type = 'submit';

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = this.normalizeUsername(input.value);
      if (username) {
        input.value = '';
        window.location.hash = `#/users/${encodeURIComponent(username)}`;
      }
    });

    form.append(label, input, button);
    return form;
  }

  private paintRoute(): void {
    const view = this.resolveView();
    const routeContent = this.content.querySelector<HTMLElement>('.route-content');

    this.title.textContent = view.title;
    this.subtitle.textContent = this.error ?? view.subtitle ?? this.contextLabel();

    this.updateNavLinks();

    routeContent?.replaceChildren(view.element);
  }

  private resolveView(): View {
    const [route = '/', first, second] = this.routeParts();

    if (!route || route === '/') {
      return renderTriageBoard('high');
    }

    if (route === 'users') {
      return first ? renderUserPanel(this.normalizeUsername(routeParam(first, 'unknown')) || 'unknown') : renderUsersIndex();
    }

    if (route === 'sites' || route === 'domains') {
      return first ? renderDomainPanel(routeParam(first, 'unknown')) : renderDomainsIndex();
    }

    if (route === 'triage') {
      return renderTriageBoard(this.asTriageBucket(first));
    }

    if (route === 'insights') {
      return renderModLogInsights(this.asInsightsRange(first));
    }

    if (route === 'rules') {
      return renderRulesEditor();
    }

    if (route === 'removal') {
      return renderRemovalReasonEditor();
    }

    if (route === 'audit') {
      return renderAuditLog();
    }

    if (route === 'alerts') {
      return renderAlertsConfig();
    }

    if (route === 'settings') {
      return renderSettings();
    }

    if (second) {
      return placeholderView('Not found', `No route registered for ${route}/${first}/${second}.`);
    }

    return placeholderView('Not found', `No route registered for ${route}.`);
  }

  private contextLabel(): string {
    if (this.context?.subreddit) {
      return `r/${this.context.subreddit}`;
    }

    return 'Moderator webview';
  }

  private routeParts(): string[] {
    const path = window.location.hash.replace(/^#/, '').split('?')[0] ?? '';
    return path.split('/').filter(Boolean);
  }

  private applyNavigationIntent(context: BootstrapResponse): void {
    const intent = context.navigationIntent;
    if (!intent?.hash.startsWith('#/')) {
      return;
    }

    if (window.location.hash !== intent.hash) {
      window.location.hash = intent.hash;
    }
  }

  private normalizeUsername(value: string): string {
    return value.trim().replace(/^u\//i, '');
  }

  private updateNavLinks(): void {
    for (const link of this.nav.querySelectorAll<HTMLAnchorElement>('[data-nav-href]')) {
      const href = link.dataset.navHref ?? '';
      link.classList.toggle('active', this.isActive(href));
    }
  }

  private isActive(href: string): boolean {
    const current = window.location.hash || '#/';

    if (href === '#/triage') {
      return current === '#/' || current.startsWith('#/triage');
    }

    return current.startsWith(href);
  }

  private asTriageBucket(value: string | undefined): TriageBucket {
    if (value === 'aged' || value === 'normal') {
      return value;
    }

    return 'high';
  }

  private asInsightsRange(value: string | undefined): InsightsRange {
    if (value === '30d' || value === '90d') {
      return value;
    }

    return '7d';
  }
}
