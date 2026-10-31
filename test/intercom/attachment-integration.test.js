'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const fa = require('../support/fixtures-attachments');

function inboxUrl(conversationId) {
  return `https://app.intercom.com/a/inbox/demo1234/inbox/conversation/${conversationId}`;
}

function loadAdapter({
  conversationId = fa.CAPTURE_CONVERSATION_ID,
  headerConversationId = conversationId,
  header = fa.attachmentConversationHeader({ conversationId: headerConversationId }),
  parts = [fa.attachmentMessagePart()],
  withStream = true,
  composer = fa.attachmentComposer()
} = {}) {
  const conversation = [header, withStream ? fa.attachmentStream(parts) : ''].join('\n');
  return loadExtension(fx.inboxHtml({ conversation, composer }), { url: inboxUrl(conversationId) });
}

function button(win) {
  return win.getIntercomRoot().querySelector('.isa-attachments-button');
}

function records(win) {
  const controller = win.ISA_ATTACHMENTS_ADAPTER.getController();
  return controller ? controller.getRecords() : [];
}

function count(win) {
  const mounted = button(win);
  return mounted ? mounted.querySelector('.isa-attachments-count').textContent : null;
}

test('the adapter mounts the paperclip before every icon in the header action cluster', () => {
  const win = loadAdapter();

  win.refreshIntercomAttachments();

  const mounted = button(win);
  assert.ok(mounted);
  const cluster = win.getIntercomRoot()
    .querySelector('[data-test-conversation-header-more="true"]').parentElement;
  assert.equal(cluster.firstElementChild, mounted);
  assert.equal(mounted.getAttribute('aria-label'), 'Attachments, 1 file');
  assert.equal(count(win), '1');
});

test('a paperclip dropped by a header re-render is mounted again on the next refresh', () => {
  const win = loadAdapter();
  win.refreshIntercomAttachments();
  button(win).remove();

  win.refreshIntercomAttachments();

  assert.ok(button(win), 'the paperclip is back');
  assert.equal(win.getIntercomRoot().querySelectorAll('.isa-attachments-button').length, 1);
  assert.equal(count(win), '1');
});

test('a conversation stream rendered after boot is picked up without a manual refresh', async () => {
  const win = loadAdapter({ withStream: false });
  assert.equal(button(win), null, 'no stream, no attachments yet');

  const host = win.getIntercomRoot().querySelector('#app');
  host.insertAdjacentHTML('afterbegin', fa.attachmentStream([fa.attachmentMessagePart()]));

  await new Promise(resolve => setTimeout(resolve, 300));

  assert.ok(button(win),
    'the conversation stream rendering after boot must wake the attachments pass on its own');
});

test('the paperclip never lands beside the Close button', () => {
  const win = loadAdapter();

  win.refreshIntercomAttachments();

  const close = win.getIntercomRoot().querySelector('[data-test-state-multiselect-close="true"]');
  assert.equal(close.previousElementSibling, null);
  assert.notEqual(close.parentElement, button(win).parentElement);
});

test('a header that nests both clusters one level deeper still resolves', () => {
  const win = loadAdapter({ header: fa.attachmentConversationHeader({ nested: true }) });

  win.refreshIntercomAttachments();

  const cluster = win.getIntercomRoot()
    .querySelector('[data-test-conversation-header-more="true"]').parentElement;
  assert.equal(cluster.firstElementChild, button(win));
});

test('a header without the more button falls back to the snooze cluster', () => {
  const win = loadAdapter({ header: fa.attachmentConversationHeader({ withMore: false }) });

  win.refreshIntercomAttachments();

  const cluster = win.getIntercomRoot()
    .querySelector('[data-test-conversation-header-snooze="true"]').parentElement;
  assert.equal(cluster.firstElementChild, button(win));
});

test('a header without either action anchor falls back to the title host', () => {
  const win = loadAdapter({
    header: fa.attachmentConversationHeader({ withMore: false, withSnooze: false })
  });

  win.refreshIntercomAttachments();

  const title = win.getIntercomRoot().querySelector('[data-inbox-conversation-header-title="true"]');
  assert.equal(title.parentElement.firstElementChild, button(win));
});

test('the adapter reads filename, size, sender, and stream index from the message', () => {
  const win = loadAdapter();

  win.refreshIntercomAttachments();

  const [record] = records(win);
  assert.equal(record.filename, fa.CAPTURE_FILENAME);
  assert.equal(record.size, fa.CAPTURE_SIZE);
  assert.equal(record.date, fa.CAPTURE_DATE);
  assert.equal(record.senderRole, 'customer');
  assert.equal(record.senderLabel, 'Customer');
  assert.equal(record.streamIndex, fa.CAPTURE_STREAM_INDEX);
});

test('the adapter separates customer uploads from teammate uploads', () => {
  const win = loadAdapter({
    parts: [
      fa.attachmentMessagePart({ index: 7, entityId: '90030676604', partId: '90004380487', role: 'teammate', sender: fa.CAPTURE_TEAMMATE_SENDER, uploads: [fa.attachmentUpload({ filename: 'policy.pdf' })] }),
      fa.attachmentMessagePart({ uploads: [fa.attachmentUpload({ filename: 'statement.pdf' })] })
    ]
  });

  win.refreshIntercomAttachments();

  const labels = records(win).map(record => [record.filename, record.senderLabel]);
  assert.deepEqual(Array.from(labels.map(pair => Array.from(pair))), [['policy.pdf', 'Team'], ['statement.pdf', 'Customer']]);
});

test('the adapter collects every upload in a single message', () => {
  const win = loadAdapter({
    parts: [fa.attachmentMessagePart({
      uploads: [
        fa.attachmentUpload({ filename: 'first.pdf' }),
        fa.attachmentUpload({ filename: 'second.png', size: '20 KB' })
      ]
    })]
  });

  win.refreshIntercomAttachments();

  assert.equal(count(win), '2');
  assert.equal(button(win).getAttribute('aria-label'), 'Attachments, 2 files');
});

test('a conversation without uploads mounts a hidden button', () => {
  const win = loadAdapter({ parts: [fa.attachmentMessagePart({ uploads: [] })] });

  win.refreshIntercomAttachments();

  assert.equal(records(win).length, 0);
  assert.equal(button(win).hidden, true);
});

test('a header conversation id that disagrees with the route mounts nothing', () => {
  const win = loadAdapter({ conversationId: '900202944780203', headerConversationId: '900257296012' });

  win.refreshIntercomAttachments();

  assert.equal(button(win), null);
  assert.equal(win.ISA_ATTACHMENTS_ADAPTER.getController(), null);
});

test('a header without a conversation id mounts nothing', () => {
  const win = loadAdapter({ header: fa.attachmentConversationHeader({ conversationId: null }) });

  win.refreshIntercomAttachments();

  assert.equal(button(win), null);
});

test('a header with no usable host mounts nothing', () => {
  const win = loadAdapter({
    header: fa.attachmentConversationHeader({ withMore: false, withSnooze: false, withTitle: false })
  });

  win.refreshIntercomAttachments();

  assert.equal(button(win), null);
});

test('a missing conversation stream mounts nothing', () => {
  const win = loadAdapter({ withStream: false });

  win.refreshIntercomAttachments();

  assert.equal(button(win), null);
});

test('repeated refreshes keep exactly one button', () => {
  const win = loadAdapter();

  win.refreshIntercomAttachments();
  const first = win.ISA_ATTACHMENTS_ADAPTER.getController();
  win.refreshIntercomAttachments();
  win.refreshIntercomAttachments();

  assert.equal(win.ISA_ATTACHMENTS_ADAPTER.getController(), first);
  assert.equal(win.getIntercomRoot().querySelectorAll('.isa-attachments-button').length, 1);
});

test('a paperclip already mounted by the other install is never duplicated', () => {
  const win = loadAdapter({ header: fa.attachmentConversationHeader({ otherInstall: true }) });

  win.refreshIntercomAttachments();

  assert.equal(win.getIntercomRoot().querySelectorAll('.isa-attachments-button').length, 1);
  assert.equal(win.ISA_ATTACHMENTS_ADAPTER.getController(), null);
});

test('a new upload in the open conversation updates the count', () => {
  const win = loadAdapter();
  win.refreshIntercomAttachments();
  const controller = win.ISA_ATTACHMENTS_ADAPTER.getController();

  const stream = win.getIntercomRoot().querySelector('[data-testid="conversation-stream-scroll-container"]');
  stream.insertAdjacentHTML('beforeend', fa.attachmentMessagePart({
    index: 20,
    entityId: '90050734771',
    partId: '90082377687',
    uploads: [fa.attachmentUpload({ filename: 'receipt.png', size: '20 KB' })]
  }));
  win.refreshIntercomAttachments();

  assert.equal(win.ISA_ATTACHMENTS_ADAPTER.getController(), controller);
  assert.equal(count(win), '2');
});

test('a message that leaves the loaded stream keeps a download-only row', () => {
  const win = loadAdapter({
    parts: [
      fa.attachmentMessagePart({ uploads: [fa.attachmentUpload({ filename: 'kept.pdf' })] }),
      fa.attachmentMessagePart({
        index: 20,
        entityId: '90050734771',
        partId: '90082377687',
        uploads: [fa.attachmentUpload({ filename: 'unloaded.pdf' })]
      })
    ]
  });
  win.refreshIntercomAttachments();
  assert.equal(count(win), '2');

  const parts = win.getIntercomRoot().querySelectorAll('[data-part-entity-id]');
  parts[1].parentElement.removeChild(parts[1]);
  win.refreshIntercomAttachments();

  assert.equal(count(win), '2');
  const remaining = records(win);
  assert.deepEqual(Array.from(remaining.map(record => record.filename)), ['kept.pdf', 'unloaded.pdf']);
  assert.equal(remaining[1].messageElement, null);
  assert.equal(remaining[1].href, fa.CAPTURE_HREF);

  win.ISA_ATTACHMENTS_ADAPTER.getController().open();
  const rows = win.document.querySelectorAll('.isa-attachment-row');
  assert.equal(rows[0].disabled, false);
  assert.equal(rows[1].disabled, true);
  assert.equal(win.document.querySelectorAll('.isa-attachment-download').length, 2);
});

test('the adapter keeps the signed download href of every upload', () => {
  const win = loadAdapter();

  win.refreshIntercomAttachments();

  assert.equal(records(win)[0].href, fa.CAPTURE_HREF);
});

test('changing the conversation rebuilds the panel and drops the previous files', () => {
  const win = loadAdapter();
  win.refreshIntercomAttachments();
  const first = win.ISA_ATTACHMENTS_ADAPTER.getController();
  assert.equal(first.getConversationId(), fa.CAPTURE_CONVERSATION_ID);

  const root = win.getIntercomRoot();
  root.querySelector('[data-testid="conversation-header"]').outerHTML =
    fa.attachmentConversationHeader({ conversationId: '900436577611583' });
  root.querySelector('[data-testid="conversation-stream-scroll-container"]').outerHTML =
    fa.attachmentStream([fa.attachmentMessagePart({
      index: 3,
      entityId: '900113141',
      partId: '900113141',
      uploads: [fa.attachmentUpload({ filename: 'other-conversation.pdf' })]
    })]);
  win.history.replaceState({}, '', inboxUrl('900436577611583'));
  win.refreshIntercomAttachments();

  const second = win.ISA_ATTACHMENTS_ADAPTER.getController();
  assert.notEqual(second, first);
  assert.equal(second.getConversationId(), '900436577611583');
  assert.deepEqual(Array.from(second.getRecords().map(record => record.filename)), ['other-conversation.pdf']);
  assert.equal(win.getIntercomRoot().querySelectorAll('.isa-attachments-button').length, 1);
});

test('leaving the conversation removes the button and the panel', () => {
  const win = loadAdapter();
  win.refreshIntercomAttachments();
  assert.ok(button(win));

  const header = win.getIntercomRoot().querySelector('[data-testid="conversation-header"]');
  header.parentElement.removeChild(header);
  win.refreshIntercomAttachments();

  assert.equal(button(win), null);
  assert.equal(win.document.querySelector('.isa-attachment-panel'), null);
  assert.equal(win.ISA_ATTACHMENTS_ADAPTER.getController(), null);
});

test('a message node the stream replaced is picked up, so the row keeps its jump target', () => {
  const win = loadAdapter();
  win.refreshIntercomAttachments();
  const before = records(win)[0].messageElement;
  assert.ok(before && before.isConnected);

  const stream = win.getIntercomRoot().querySelector('[data-testid="conversation-stream-scroll-container"]');
  const part = before.closest('[data-part-entity-id]') || before;
  part.replaceWith(part.cloneNode(true));
  assert.equal(before.isConnected, false);
  win.refreshIntercomAttachments();

  const after = records(win)[0].messageElement;
  assert.ok(after && after.isConnected, 'the controller holds the node now on screen');
  assert.notEqual(after, before);
  assert.ok(stream.contains(after));
});

test('refreshing an unchanged conversation leaves the paperclip and its panel untouched', () => {
  const win = loadAdapter();
  win.refreshIntercomAttachments();
  win.refreshIntercomAttachments();
  const mounted = button(win);
  assert.ok(mounted);
  const root = win.getIntercomRoot();
  const observer = new win.MutationObserver(() => {});
  observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  win.refreshIntercomAttachments();
  win.refreshIntercomAttachments();
  const records = observer.takeRecords();
  observer.disconnect();
  assert.deepEqual(records.map(record => `${record.type}:${record.attributeName || ''}:${record.target.className || record.target.nodeName}`), []);
  assert.equal(button(win), mounted);
  assert.equal(count(win), '1');
});
