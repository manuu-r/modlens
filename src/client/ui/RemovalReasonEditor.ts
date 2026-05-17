import {
  createRemovalReason,
  deleteRemovalReason,
  listRemovalReasons,
  type RemovalReasonRecord,
} from '../api';
import {
  chip,
  el,
  emptyPanel,
  errorPanel,
  formatRelative,
  loadingPanel,
  panel,
  row,
  stack,
  type View,
} from './viewHelpers';

export function renderRemovalReasonEditor(): View {
  const element = el('div', { className: 'stack' });
  element.append(loadingPanel('Loading removal reasons...'));
  void load(element);
  return {
    title: 'Removal reasons',
    subtitle: 'Templates for removing posts with an auto-comment or DM.',
    element,
  };
}

async function load(root: HTMLElement): Promise<void> {
  try {
    const { reasons } = await listRemovalReasons();
    root.replaceChildren(renderContent(reasons, root));
  } catch (err: unknown) {
    root.replaceChildren(errorPanel(err));
  }
}

function renderContent(reasons: RemovalReasonRecord[], root: HTMLElement): HTMLElement {
  const listPanel = renderList(reasons, root);
  const formPanel = renderForm(root);
  return stack(listPanel, formPanel);
}

function renderList(reasons: RemovalReasonRecord[], root: HTMLElement): HTMLElement {
  if (reasons.length === 0) {
    return panel(
      el('h2', { text: 'Removal reasons' }),
      emptyPanel('No templates yet. Add one below.'),
    );
  }

  return panel(
    el('h2', { text: 'Removal reasons' }),
    el('div', {
      className: 'list',
      children: reasons.map((r) => renderReasonRow(r, root)),
    }),
  );
}

function renderReasonRow(reason: RemovalReasonRecord, root: HTMLElement): HTMLElement {
  const deleteButton = el('button', {
    className: 'button button-danger',
    text: 'Delete',
    title: 'Delete this removal reason template.',
    onClick: () => {
      if (!confirm(`Delete "${reason.title}"?`)) return;
      deleteButton.disabled = true;
      void deleteRemovalReason(reason.id)
        .then(() => load(root))
        .catch((err: unknown) => {
          root.append(errorPanel(err));
          deleteButton.disabled = false;
        });
    },
  });

  const flags: string[] = [];
  if (reason.autoComment) flags.push('auto-comment');
  if (reason.dmUser) flags.push('dm user');

  return el('div', {
    className: 'list-item',
    children: [
      el('div', {
        className: 'list-item-header',
        children: [
          el('div', {
            className: 'row',
            children: [
              el('strong', { text: reason.title }),
              ...flags.map((f) => chip(f, 'trusted')),
            ],
          }),
          el('span', { className: 'muted-small', text: `by u/${reason.createdBy} · ${formatRelative(reason.createdAt)}` }),
        ],
      }),
      el('div', {
        className: 'list-item-body muted-small',
        children: [
          el('pre', { className: 'reason-body-preview', text: reason.bodyTemplate.slice(0, 200) + (reason.bodyTemplate.length > 200 ? '…' : '') }),
        ],
      }),
      el('div', { className: 'triage-item-actions', children: [deleteButton] }),
    ],
  });
}

function renderForm(root: HTMLElement): HTMLElement {
  const titleInput = el('input');
  const bodyTextarea = el('textarea');
  const autoCommentCheck = el('input');
  const dmUserCheck = el('input');
  const status = el('span', { className: 'muted-small' });
  const saveButton = el('button', {
    className: 'button button-accent',
    text: 'Save template',
    title: 'Save this removal reason template.',
  });

  titleInput.type = 'text';
  titleInput.placeholder = 'e.g. Rule 1 – No spam';
  titleInput.maxLength = 120;

  bodyTextarea.rows = 6;
  bodyTextarea.placeholder =
    'Your post was removed from r/{{subreddit}} because it violates Rule 1.\n\nIf you have questions, feel free to reply to this message.\n\n— u/{{mod}}';

  autoCommentCheck.type = 'checkbox';
  autoCommentCheck.id = 'rr-auto-comment';

  dmUserCheck.type = 'checkbox';
  dmUserCheck.id = 'rr-dm-user';

  saveButton.addEventListener('click', () => {
    const title = titleInput.value.trim();
    const bodyTemplate = bodyTextarea.value.trim();
    if (!title || !bodyTemplate) {
      status.textContent = 'Title and body are required.';
      return;
    }
    saveButton.disabled = true;
    status.textContent = 'Saving…';
    void createRemovalReason({
      title,
      bodyTemplate,
      autoComment: autoCommentCheck.checked,
      dmUser: dmUserCheck.checked,
    })
      .then(() => {
        titleInput.value = '';
        bodyTextarea.value = '';
        autoCommentCheck.checked = false;
        dmUserCheck.checked = false;
        status.textContent = '';
        return load(root);
      })
      .catch((err: unknown) => {
        status.textContent = err instanceof Error ? err.message : 'Save failed.';
      })
      .finally(() => {
        saveButton.disabled = false;
      });
  });

  return panel(
    el('h2', { text: 'Add template' }),
    el('div', {
      className: 'stack',
      children: [
        el('div', {
          className: 'form-field',
          children: [
            el('label', { text: 'Title', attrs: { for: 'rr-title' } }),
            Object.assign(titleInput, { id: 'rr-title' }),
          ],
        }),
        el('div', {
          className: 'form-field',
          children: [
            el('label', {
              text: 'Body',
              attrs: { for: 'rr-body' },
            }),
            el('p', {
              className: 'muted-small',
              text: 'Variables: {{username}}, {{subreddit}}, {{post_title}}, {{mod}}',
            }),
            Object.assign(bodyTextarea, { id: 'rr-body', className: 'reason-body-input' }),
          ],
        }),
        row(
          el('label', {
            className: 'row',
            attrs: { for: 'rr-auto-comment' },
            children: [autoCommentCheck, el('span', { text: 'Post comment on removed item' })],
          }),
          el('label', {
            className: 'row',
            attrs: { for: 'rr-dm-user' },
            children: [dmUserCheck, el('span', { text: 'Send DM to author' })],
          }),
        ),
        row(saveButton, status),
      ],
    }),
  );
}
