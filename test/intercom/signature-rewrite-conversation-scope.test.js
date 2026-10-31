'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const CONVERSATION_TWO_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207/conversation/457';
const RECIPIENT_ID = '900fcbb36062854afdf312d1';

const DRAFT_MARKUP = `<div data-testid="new-conversation-view">
  <div data-testid="new-conversation-channel-picker">
    <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"><span><span>Email</span></span></button>
  </div>
  <div data-testid="composer-sender-area">
    <button type="button" data-test-sender-pill="true"><span>Support Kestrel Kids</span><span>help@kestrel-kids.example</span></button>
  </div>
  <div data-testid="recipient-to-input"><div data-test-recipient-pill="true"><span>Klaus Wexley</span></div></div>
  <div data-testid="draft-team-assignee"><button type="button" data-testid="team-assignee-selector"><span><span class="ml-2">Support Kestrel Kids</span></span></button></div>
  <div data-testid="composer-orchestrator">
    <div data-testid="composer-editor-area"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div></div>
    <div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>
  </div>
</div>`;

function loadDraft() {
  return loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(win) {
        win.document.getElementById('teammate-app-react')
          .attachShadow({ mode: 'open' }).innerHTML = DRAFT_MARKUP;
      }
    }
  );
}

function editorOf(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('.tiptap.ProseMirror[contenteditable="true"]');
}

function insertSignature(win) {
  const editor = editorOf(win);
  editor.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }));
  return editor;
}

function deliverGerman(win) {
  win.dispatchEvent(new win.MessageEvent('message', {
    data: {
      __isaic: true,
      version: 1,
      kind: 'contact-language',
      userId: RECIPIENT_ID,
      languageOverride: 'de',
      browserLocale: null,
      countryCode: null
    },
    source: win,
    origin: 'https://app.intercom.com'
  }));
}

test('control: an untouched English signature is replaced by the German one when the recipient language arrives', () => {
  const win = loadDraft();
  const editor = insertSignature(win);
  assert.match(editor.innerHTML, /Customer Support at/);

  deliverGerman(win);

  assert.match(editor.innerHTML, /Kundenservice bei/);
  assert.doesNotMatch(editor.innerHTML, /Customer Support at/);
});

test('control: the signature memory is live after a URL excursion that never calls handleConversationChange', () => {
  const win = loadDraft();
  const editor = insertSignature(win);

  win.history.replaceState({}, '', CONVERSATION_TWO_URL);
  win.history.replaceState({}, '', NEW_CONVERSATION_URL);
  deliverGerman(win);

  assert.match(editor.innerHTML, /Kundenservice bei/);
});

test('scope: after handleConversationChange the old signature memory cannot rewrite the reused editor when the recipient language arrives', () => {
  const win = loadDraft();
  const editor = insertSignature(win);
  const inserted = editor.innerHTML;
  assert.match(inserted, /Customer Support at/);

  win.history.replaceState({}, '', CONVERSATION_TWO_URL);
  win.handleConversationChange();
  win.history.replaceState({}, '', NEW_CONVERSATION_URL);
  assert.strictEqual(editorOf(win), editor, 'the composer element is reused');
  assert.strictEqual(editor.innerHTML, inserted);

  deliverGerman(win);

  assert.strictEqual(editor.innerHTML, inserted);
});

test('scope: while the URL stays on conversation 457 a recipient language leaves the reused editor exactly as inserted', () => {
  const win = loadDraft();
  const editor = insertSignature(win);
  const inserted = editor.innerHTML;

  win.history.replaceState({}, '', CONVERSATION_TWO_URL);
  win.handleConversationChange();
  deliverGerman(win);

  assert.strictEqual(editor.innerHTML, inserted);
});
