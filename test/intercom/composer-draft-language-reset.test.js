'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207/conversation/456';
const RECIPIENT_ID = '900fcbb36062854afdf312d1';
const RECIPIENT = 'Klaus Wexley';

function draftMarkup(recipient) {
  const pill = recipient
    ? `<div data-test-recipient-pill="true"><span>${recipient}</span></div>`
    : '';
  return `<div data-testid="new-conversation-view">
    <div data-testid="new-conversation-channel-picker">
      <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"><span><span>Email</span></span></button>
    </div>
    <div data-testid="composer-sender-area">
      <button type="button" data-test-sender-pill="true"><span>Support Kestrel Kids</span><span>help@kestrel-kids.example</span></button>
    </div>
    <div data-testid="recipient-to-input">${pill}</div>
    <div data-testid="draft-team-assignee"><button type="button" data-testid="team-assignee-selector"><span><span class="ml-2">Support Kestrel Kids</span></span></button></div>
    <div data-testid="composer-orchestrator">
      <div data-testid="composer-editor-area"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div></div>
      <div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>
    </div>
  </div>`;
}

function loadDraft(recipient) {
  return loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(win) {
        win.document.getElementById('teammate-app-react')
          .attachShadow({ mode: 'open' }).innerHTML = draftMarkup(recipient);
      }
    }
  );
}

function shadowOf(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot;
}

function recipientInput(win) {
  return shadowOf(win).querySelector('[data-testid="recipient-to-input"]');
}

function pillOf(win) {
  return recipientInput(win).querySelector('[data-test-recipient-pill="true"]');
}

function addRecipient(win, name) {
  const pill = win.document.createElement('div');
  pill.setAttribute('data-test-recipient-pill', 'true');
  pill.innerHTML = `<span>${name}</span>`;
  recipientInput(win).insertBefore(pill, recipientInput(win).firstChild);
}

function deliverContact(win, over = {}) {
  win.dispatchEvent(new win.MessageEvent('message', {
    data: {
      __isaic: true,
      version: 1,
      kind: 'contact-language',
      userId: RECIPIENT_ID,
      languageOverride: null,
      browserLocale: null,
      countryCode: null,
      ...over
    },
    source: win,
    origin: 'https://app.intercom.com'
  }));
}

function pickLanguage(win, code) {
  const picker = shadowOf(win).querySelector('.isa-draft-language-picker');
  const chip = [...picker.children].find(entry => entry.textContent === code);
  chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function activeCode(win) {
  const picker = shadowOf(win).querySelector('.isa-draft-language-picker');
  if (!picker) return null;
  const active = [...picker.children].find(chip => chip.classList.contains('isa-draft-language-chip-active'));
  return active ? active.textContent : null;
}

function openExistingConversation(win) {
  win.history.replaceState({}, '', CONVERSATION_URL);
  win.handleConversationChange();
  win.refreshComposerLanguagePicker();
}

function openNewConversation(win) {
  win.history.replaceState({}, '', NEW_CONVERSATION_URL);
  win.handleConversationChange();
}

function reAddRecipient(win) {
  pillOf(win).remove();
  addRecipient(win, RECIPIENT);
}

function stayAndReAdd(win) {
  win.refreshComposerLanguageState();
  reAddRecipient(win);
  win.refreshComposerLanguageState();
  win.refreshComposerLanguagePicker();
}

function leaveAndReturn(win) {
  openExistingConversation(win);
  win.refreshComposerLanguageState();
  pillOf(win).remove();
  openNewConversation(win);
  addRecipient(win, RECIPIENT);
  win.refreshComposerLanguageState();
  win.refreshComposerLanguagePicker();
}

function startDraft() {
  const win = loadDraft(RECIPIENT);
  win.refreshComposerLanguagePicker();
  return win;
}

test('R1 control: a manual language stays in force for the same recipient without leaving the view', () => {
  const win = startDraft();
  pickLanguage(win, 'IT');

  stayAndReAdd(win);
  assert.equal(win.draftSignatureLanguage(), 'italian');
  assert.equal(activeCode(win), 'IT');
});

test('R2 control: a learned recipient language stays in force for the same recipient without leaving the view', () => {
  const win = startDraft();
  deliverContact(win, { languageOverride: 'de' });

  stayAndReAdd(win);
  assert.equal(win.draftSignatureLanguage(), 'german');
  assert.equal(activeCode(win), 'DE');
});

test('R1: a manual language does not survive leaving the view and re-adding the same recipient', () => {
  const win = startDraft();
  pickLanguage(win, 'IT');
  assert.equal(win.draftSignatureLanguage(), 'italian');

  leaveAndReturn(win);
  assert.equal(win.draftSignatureLanguage(), 'english');
  assert.equal(activeCode(win), 'EN');
});

test('R1: after leaving, the re-added recipient network language wins over the old manual language', () => {
  const win = startDraft();
  pickLanguage(win, 'IT');

  leaveAndReturn(win);
  deliverContact(win, { languageOverride: 'de' });
  assert.equal(win.draftSignatureLanguage(), 'german');
  assert.equal(activeCode(win), 'DE');
});

test('R2: a learned recipient language does not survive leaving the view', () => {
  const win = startDraft();
  deliverContact(win, { languageOverride: 'de' });
  assert.equal(win.draftSignatureLanguage(), 'german');

  leaveAndReturn(win);
  assert.equal(win.draftSignatureLanguage(), 'english');
  assert.equal(activeCode(win), 'EN');
});

test('R3b: only a learned recipient language is cleared on leaving the view', () => {
  const win = startDraft();
  deliverContact(win, { browserLocale: 'it-IT' });
  assert.equal(win.draftSignatureLanguage(), 'italian');

  leaveAndReturn(win);
  assert.equal(win.draftSignatureLanguage(), 'english');
  assert.equal(activeCode(win), 'EN');
});

function startDraftWithoutRecipient() {
  const win = loadDraft(null);
  win.refreshComposerLanguagePicker();
  return win;
}

function leaveAndReturnWithoutRecipient(win) {
  openExistingConversation(win);
  win.refreshComposerLanguageState();
  openNewConversation(win);
  win.refreshComposerLanguageState();
  win.refreshComposerLanguagePicker();
}

test('R4 control: a manual language with no recipient stays in force without leaving the view', () => {
  const win = startDraftWithoutRecipient();
  pickLanguage(win, 'IT');

  win.refreshComposerLanguageState();
  win.refreshComposerLanguagePicker();
  assert.equal(pillOf(win), null);
  assert.equal(win.draftSignatureLanguage(), 'italian');
  assert.equal(activeCode(win), 'IT');
});

test('R4: a manual language with no recipient at any point does not survive leaving the view', () => {
  const win = startDraftWithoutRecipient();
  pickLanguage(win, 'IT');
  assert.equal(win.draftSignatureLanguage(), 'italian');

  leaveAndReturnWithoutRecipient(win);
  assert.equal(pillOf(win), null);
  assert.equal(win.draftSignatureLanguage(), 'english');
  assert.equal(activeCode(win), 'EN');
});

test('R5: a manual language does not survive leaving the view when the return adds a recipient with no delivered language', () => {
  const win = startDraftWithoutRecipient();
  pickLanguage(win, 'IT');
  assert.equal(win.draftSignatureLanguage(), 'italian');

  leaveAndReturnWithoutRecipient(win);
  addRecipient(win, RECIPIENT);
  win.refreshComposerLanguageState();
  win.refreshComposerLanguagePicker();
  assert.equal(win.draftSignatureLanguage(), 'english');
  assert.equal(activeCode(win), 'EN');
});
