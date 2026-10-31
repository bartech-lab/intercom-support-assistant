'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const SLACK = 'https://example.slack.com/archives/C1/p1';

function inProgressInbox(extra = {}) {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ conversationAttrs: [fx.conversationAttrRow('3001', 'Escalation Status', 'in progress')] }),
    ...extra
  }));
}

function fakeClick(target, path) {
  const event = {
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
  if (path) event.composedPath = () => path;
  return event;
}

test('a capitalised In Progress status still counts as in progress', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ conversationAttrs: [fx.conversationAttrRow('3001', 'Escalation Status', 'In Progress')] })
  }));
  assert.equal(win.isInProgressStatus(), true);
});

test('without a Escalation Status row only an exact in progress value counts', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ conversationAttrs: [fx.conversationAttrRow('3002', 'Urgent', 'not in progress')] })
  }));
  assert.equal(win.isInProgressStatus(), false);
});

test('the close icon button wins over another toolbar button labelled Close', () => {
  const win = loadExtension(fx.inboxHtml({ toolbar: fx.conversationToolbar({ close: true }) }));
  const toolbar = win.document.querySelector('[data-intercom-target="conversation-toolbar"]');
  const decoy = win.document.createElement('button');
  decoy.textContent = 'Close';
  toolbar.insertBefore(decoy, toolbar.firstChild);
  const iconButton = win.document.querySelector('svg.o__standard__close-conversation').closest('button');
  assert.equal(win.getCloseConversationButton(), iconButton);
});

test('a toolbar Close button with padded text is found', () => {
  const win = loadExtension(fx.inboxHtml({ toolbar: '<div data-intercom-target="conversation-toolbar"><button id="text-close">\n  Close \n</button></div>' }));
  assert.equal(win.getCloseConversationButton().id, 'text-close');
});

test('a button holding the close icon outside the toolbar is a close button', () => {
  const win = loadExtension(fx.inboxHtml({}));
  const button = win.document.createElement('button');
  button.innerHTML = '<svg class="o__standard__close-conversation"></svg>';
  win.document.body.appendChild(button);
  assert.equal(win.isCloseConversationButton(button), true);
});

test('a click event without a composed path is judged by its target', () => {
  const win = inProgressInbox({ toolbar: fx.conversationToolbar({ close: true }) });
  win.alert = () => {};
  const button = win.document.querySelector('svg.o__standard__close-conversation').closest('button');
  const event = fakeClick(button, []);
  win.handleCloseGuardClick(event);
  assert.equal(event.defaultPrevented, true);
});

test('a click on the icon inside the close button is blocked', () => {
  const win = inProgressInbox({ toolbar: fx.conversationToolbar({ close: true }) });
  win.alert = () => {};
  const icon = win.document.querySelector('svg.o__standard__close-conversation');
  const event = fakeClick(icon);
  win.handleCloseGuardClick(event);
  assert.equal(event.defaultPrevented, true);
});

test('a note whose body sits five levels above its edit action still blocks close', () => {
  const stream = `<div data-intercom-target="conversation-space">
    <div><div class="intercom-interblocks-html"><p><a href="${SLACK}">slack</a></p></div>
      <div><div><div><div><button data-testid="content-part-actions-edit-note"></button></div></div></div></div>
    </div>
  </div>`;
  const win = loadExtension(fx.inboxHtml({ conversation: stream }));
  assert.equal(win.isLastPartUnresolvedNote(), true);
});
