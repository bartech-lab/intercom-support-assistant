'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const fa = require('../support/fixtures-attachments');

const URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/conversation/100';

function load(size) {
  const stream = fa.attachmentStream([fa.attachmentMessagePart({ entityId: '1', partId: 'p1', index: 1, uploads: [fa.attachmentUpload({ filename: 'a.pdf', size })] })]);
  const head = fa.attachmentConversationHeader({ conversationId: '100' });
  return loadExtension(fx.inboxHtml({ conversation: [head, stream].join('\n'), composer: fa.attachmentComposer() }), { url: URL });
}

function sizes(win) {
  return Array.from(win.ISA_ATTACHMENTS_ADAPTER.getController().getRecords().map(record => record.size));
}

test('a size that appears after the first pass reaches the panel', () => {
  const win = load('Uploading');
  win.refreshIntercomAttachments();
  assert.deepEqual(sizes(win), ['Uploading']);
  win.getIntercomRoot().querySelector('[data-testid="upload-size"]').textContent = '12 KB';
  win.refreshIntercomAttachments();
  assert.deepEqual(sizes(win), ['12 KB']);
});

test('the panel is removed when the conversation stream disappears', () => {
  const win = load('12 KB');
  win.refreshIntercomAttachments();
  const root = win.getIntercomRoot();
  assert.ok(root.querySelector('.isa-attachments-button'));
  root.querySelector('[data-testid="conversation-stream-scroll-container"]').remove();
  win.refreshIntercomAttachments();
  assert.equal(root.querySelector('.isa-attachments-button'), null);
  assert.equal(win.ISA_ATTACHMENTS_ADAPTER.getController(), null);
});
