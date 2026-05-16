import { deleteRule, dryrunRule, getRuleMatches, listRules } from '../api';
import type { Condition, RuleConfig, RuleDryRunResult, TriageItem } from '../../shared/types';
import {
  cell,
  chip,
  el,
  emptyPanel,
  errorPanel,
  formatRelative,
  loadingPanel,
  panel,
  replaceWithPromise,
  row,
  stack,
  table,
  type View,
} from './viewHelpers';

export function renderRulesEditor(): View {
  const element = el('div', { className: 'stack' });
  const content = el('div');

  const load = (): void => {
    content.replaceChildren(loadingPanel('Loading rules...'));
    replaceWithPromise(content, listRules(), (rules) => renderRulesList(rules, load));
  };

  element.append(
    panel(
      el('h2', { text: 'Rule recipes' }),
      el('p', {
        className: 'muted',
        text: "Rules explain why an item moves up the queue. To add one, use the subreddit menu -> 'ModLens: Create risk rule'.",
      }),
    ),
    content,
  );
  load();

  return {
    title: 'Rules',
    subtitle: 'Explainable queue rules for account, user, site, and report signals.',
    element,
  };
}

function renderRulesList(rules: RuleConfig[], reload: () => void): HTMLElement {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  if (sorted.length === 0) {
    return emptyPanel('No rules yet. Defaults are seeded on install.');
  }

  return stack(...sorted.map((rule) => renderRuleItem(rule, reload)));
}

function renderRuleItem(rule: RuleConfig, reload: () => void): HTMLElement {
  const dryRunResult = el('div', { className: 'list-item-meta' });
  const matchesContainer = el('div', {
    className: 'list-item-meta',
    children: [el('span', { className: 'muted-small', text: 'Loading recent matches...' })],
  });
  const card = el('div', {
    className: 'list-item',
    attrs: { id: `rule-${rule.id}` },
  });
  if (isFocused(rule.id)) {
    card.classList.add('rule-focused');
  }
  const deleteButton = el('button', {
    className: 'button button-danger',
    text: 'Delete',
    onClick: () => {
      deleteButton.setAttribute('disabled', 'true');
      void deleteRule(rule.id)
        .then(reload)
        .catch(() => deleteButton.removeAttribute('disabled'));
    },
  });
  const dryRunButton = el('button', {
    className: 'button',
    text: 'Dry run',
    onClick: () => {
      dryRunButton.setAttribute('disabled', 'true');
      dryRunResult.textContent = 'Running dry run...';
      void dryrunRule(rule.id)
        .then((payload) => {
          dryRunResult.replaceChildren(renderDryRunSummary(payload.results));
        })
        .catch((error: unknown) => {
          dryRunResult.replaceChildren(errorPanel(error));
        })
        .finally(() => dryRunButton.removeAttribute('disabled'));
    },
  });

  void getRuleMatches(rule.id, 8)
    .then(({ items }) => {
      matchesContainer.replaceChildren(renderAffectedBy(items));
    })
    .catch(() => {
      matchesContainer.replaceChildren(
        el('span', { className: 'muted-small', text: 'No recent matches recorded.' }),
      );
    });

  const conditionChips = renderConditionChips(rule);

  card.append(
    el('div', {
      className: 'list-item-header',
      children: [row(chip(`priority ${rule.priority}`), chip(ruleScope(rule)), el('strong', { text: rule.name })), deleteButton],
    }),
    el('div', {
      className: 'list-item-body',
      children: [el('strong', { text: 'When ' }), ...conditionChips],
    }),
    el('div', {
      className: 'list-item-meta',
      children: [
        'Then ',
        chip(`+${rule.then.scoreDelta} risk`),
        ...(rule.then.bucket ? [chip(rule.then.bucket, rule.then.bucket), ' '] : []),
        `reason: ${rule.then.reason}`,
      ],
    }),
    matchesContainer,
    row(dryRunButton),
    dryRunResult,
  );

  return card;
}

function isFocused(ruleId: string): boolean {
  const query = window.location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  return params.get('focus') === ruleId;
}

function renderAffectedBy(items: TriageItem[]): HTMLElement {
  if (items.length === 0) {
    return el('span', { className: 'muted-small', text: 'No recent matches.' });
  }
  return el('div', {
    className: 'stack',
    children: [
      el('span', { className: 'muted-small', text: `Affected by (last ${items.length})` }),
      table(
        ['Item', 'Author', 'Bucket', 'Created'],
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
      ),
    ],
  });
}

function renderConditionChips(rule: RuleConfig): (HTMLElement | string)[] {
  const all = rule.when.all ?? [];
  const any = rule.when.any ?? [];
  const children: (HTMLElement | string)[] = [];

  if (all.length) {
    children.push(...joinConditionChips(all));
  }

  if (any.length) {
    if (children.length) children.push(' ');
    children.push(el('span', { className: 'muted-small', text: 'any of:' }));
    children.push(...joinConditionChips(any));
  }

  return children.length ? children : [el('span', { className: 'muted', text: 'No conditions configured.' })];
}

function formatCondition(condition: Condition): string {
  const value = Array.isArray(condition.value) ? `[${condition.value.join(', ')}]` : String(condition.value);
  return `${condition.fact} ${condition.op} ${value}`;
}

function joinConditionChips(conditions: Condition[]): (HTMLElement | string)[] {
  return conditions.flatMap((condition, index) => [
    ...(index > 0 ? [' and '] : []),
    chip(formatCondition(condition)),
  ]);
}

function ruleScope(rule: RuleConfig): string {
  const facts = [...(rule.when.all ?? []), ...(rule.when.any ?? [])].map((condition) => condition.fact);
  if (facts.some((fact) => fact.startsWith('post.domain'))) return 'site';
  if (facts.some((fact) => fact.startsWith('account'))) return 'account';
  if (facts.some((fact) => fact.startsWith('user.summary'))) return 'user';
  if (facts.some((fact) => fact.startsWith('item'))) return 'reports';
  return 'custom';
}

function renderDryRunSummary(results: RuleDryRunResult[]): HTMLElement {
  const matched = results.filter((result) => result.matched);
  const preview = matched.slice(0, 10);

  return el('div', {
    className: 'stack',
    children: [
      el('span', {
        text: `${matched.length} of ${results.length} queue items would match this rule.`,
      }),
      ...(preview.length
        ? [
            el('div', {
              className: 'row',
              children: preview.flatMap((result, idx) => [
                ...(idx > 0 ? [' · '] : []),
                el('a', {
                  className: 'host-link',
                  href: `#/audit?target=${encodeURIComponent(result.thingId)}`,
                  text: result.thingId,
                }) as HTMLElement | string,
              ]),
            }),
          ]
        : []),
    ],
  });
}
