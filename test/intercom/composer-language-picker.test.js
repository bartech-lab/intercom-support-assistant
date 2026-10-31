'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const CONVERSATION_A = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207/conversation/456';
const CONVERSATION_B = CONVERSATION_A.replace('/456', '/457');
const NEW_CONVERSATION_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const BAR = '<div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>';

function conversationHtml({ mode = 'email', bar = '', teamInbox = 'Support Orchard Kitchen' } = {}) {
  const composer = fx.composer({ mode }).replace('<button>Send</button>', `${bar}<button>Send</button>`);
  return fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox }),
    conversation: fx.conversationSpace({ customerText: 'Hello' }),
    composer
  });
}

function loadConversation(options = {}, url = CONVERSATION_A) {
  return loadExtension(conversationHtml(options), { url });
}

function picker(win) {
  return win.document.querySelector('.isa-draft-language-picker');
}

function chip(win, code) {
  return [...picker(win).children].find(entry => entry.textContent === code);
}

function activeCodes(win) {
  return [...picker(win).children]
    .filter(entry => entry.classList.contains('isa-draft-language-chip-active'))
    .map(entry => entry.textContent);
}

function pressedCodes(win) {
  return [...picker(win).children]
    .filter(entry => entry.getAttribute('aria-pressed') === 'true')
    .map(entry => entry.textContent);
}

function click(win, element) {
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

function openConversation(win, url) {
  win.history.replaceState({}, '', url);
  win.handleConversationChange();
  win.refreshComposerLanguagePicker();
}

const DRAFT_MARKUP = `<div data-testid="new-conversation-view">
  <div data-testid="new-conversation-channel-picker">
    <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"><span><span>Email</span></span></button>
  </div>
  <div data-testid="composer-sender-area">
    <button type="button" data-test-sender-pill="true"><span>Support Kestrel Kids</span><span>help@kestrel-kids.example</span></button>
  </div>
  <div data-testid="recipient-to-input"></div>
  <div data-testid="new-conversation-draft-team-assignee"></div>
  <div data-testid="draft-team-assignee"><button type="button" data-testid="team-assignee-selector"><span><span>Support Kestrel Kids</span></span></button></div>
  <div data-testid="composer-orchestrator">
    <div data-testid="composer-editor-area"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div></div>
    <div data-testid="composer-actions-bar">__BAR_CHILDREN__</div>
  </div>
</div>`;

function loadDraft({ barChildren = '<div class="bar-first"></div><div class="bar-second"></div>', bar = true } = {}) {
  const win = loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(w) {
        let markup = DRAFT_MARKUP.replace('__BAR_CHILDREN__', barChildren);
        if (!bar) markup = markup.replace(/<div data-testid="composer-actions-bar">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>$/, '</div></div>');
        w.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' }).innerHTML = markup;
      }
    }
  );
  return win;
}

function draftRoot(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot;
}

test('a chip click is default-prevented', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();

  const event = click(win, chip(win, 'DE'));
  assert.equal(event.defaultPrevented, true);
});

test('a chip click does not reach a click listener on an ancestor', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();
  let reached = 0;
  win.document.body.addEventListener('click', () => { reached += 1; });
  picker(win).parentElement.addEventListener('click', () => { reached += 1; });

  click(win, chip(win, 'DE'));
  assert.equal(reached, 0);
});

test('the active chip moves to the clicked language on the first and the second click', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();
  assert.deepEqual(activeCodes(win), ['EN']);

  click(win, chip(win, 'DE'));
  assert.deepEqual(activeCodes(win), ['DE']);
  assert.deepEqual(pressedCodes(win), ['DE']);

  click(win, chip(win, 'NL'));
  assert.deepEqual(activeCodes(win), ['NL']);
  assert.deepEqual(pressedCodes(win), ['NL']);
  assert.equal(chip(win, 'DE').getAttribute('aria-pressed'), 'false');
  assert.equal(chip(win, 'EN').getAttribute('aria-pressed'), 'false');
  assert.equal(picker(win).getAttribute('data-isa-draft-language'), 'dutch');
});

test('every chip is a button with its language, title and type', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();

  const chips = [...picker(win).children];
  assert.equal(chips.length, 7);
  for (const entry of chips) {
    assert.equal(entry.tagName, 'BUTTON');
    assert.equal(entry.getAttribute('type'), 'button');
    assert.ok(entry.classList.contains('isa-draft-language-chip'));
    const language = entry.getAttribute('data-isa-language');
    assert.equal(entry.getAttribute('title'), `Sign in ${language}`);
  }
  assert.equal(chip(win, 'FR').getAttribute('data-isa-language'), 'french');
});

test('a pick made in the second conversation does not change the first one', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();
  openConversation(win, CONVERSATION_B);
  click(win, chip(win, 'PT'));
  assert.deepEqual(activeCodes(win), ['PT']);

  openConversation(win, CONVERSATION_A);
  assert.deepEqual(activeCodes(win), ['EN']);
});

test('the picker is removed when the composer switches from email to note', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();
  assert.ok(picker(win));

  const icon = win.document.querySelector('.o__standard__email-filled');
  icon.setAttribute('class', 'interface-icon o__standard o__standard__edit');
  icon.parentElement.querySelector('span').textContent = 'Note';
  win.refreshComposerLanguagePicker();

  assert.equal(picker(win), null);
});

test('no picker renders when no conversation is open', () => {
  const win = loadConversation({ bar: BAR }, 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207');
  win.refreshComposerLanguagePicker();
  assert.equal(picker(win), null);
});

test('leaving the conversation removes an existing picker', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();
  assert.ok(picker(win));

  win.history.replaceState({}, '', 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900207');
  win.handleConversationChange();
  win.refreshComposerLanguagePicker();
  assert.equal(picker(win), null);
});

test('the picker sits inside the first child of the actions bar', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();

  assert.equal(picker(win).parentElement, win.document.querySelector('.bar-first'));
  assert.equal(win.document.querySelector('.bar-second').querySelector('.isa-draft-language-picker'), null);
});

test('the picker sits in the actions bar itself when the bar has no children', () => {
  const win = loadConversation({ bar: '<div data-testid="composer-actions-bar"></div>' });
  win.refreshComposerLanguagePicker();

  assert.equal(picker(win).parentElement, win.document.querySelector('[data-testid="composer-actions-bar"]'));
});

test('without an actions bar the picker goes into the composer container', () => {
  const win = loadConversation();
  win.refreshComposerLanguagePicker();

  assert.equal(win.document.querySelector('[data-testid="composer-actions-bar"]'), null);
  assert.ok(picker(win));
  assert.equal(picker(win).parentElement, win.document.querySelector('[data-testid="composer-orchestrator"]'));
});

test('the new-conversation picker sits inside the first child of the actions bar', () => {
  const win = loadDraft();
  win.refreshComposerLanguagePicker();

  const found = draftRoot(win).querySelector('.isa-draft-language-picker');
  assert.ok(found);
  assert.equal(found.parentElement, draftRoot(win).querySelector('.bar-first'));
});

test('the new-conversation view renders no picker without an actions bar', () => {
  const win = loadDraft({ bar: false });
  assert.equal(draftRoot(win).querySelector('[data-testid="composer-actions-bar"]'), null);
  win.refreshComposerLanguagePicker();

  assert.equal(draftRoot(win).querySelector('.isa-draft-language-picker'), null);
  assert.equal(win.document.querySelector('.isa-draft-language-picker'), null);
});

test('a pick in the new-conversation view marks the clicked chip active', () => {
  const win = loadDraft();
  win.refreshComposerLanguagePicker();
  const pick = code => [...draftRoot(win).querySelector('.isa-draft-language-picker').children]
    .find(entry => entry.textContent === code);

  const event = click(win, pick('FR'));
  assert.equal(event.defaultPrevented, true);
  assert.equal(pick('FR').getAttribute('aria-pressed'), 'true');
  assert.equal(pick('EN').getAttribute('aria-pressed'), 'false');
  assert.equal(win.draftSignatureLanguage(), 'french');

  click(win, pick('ES'));
  assert.equal(pick('ES').getAttribute('aria-pressed'), 'true');
  assert.equal(pick('FR').getAttribute('aria-pressed'), 'false');
});

test('the language style element is injected once after repeated refreshes', () => {
  const win = loadConversation({ bar: BAR });
  assert.equal(win.document.querySelectorAll('#isa-draft-language-style').length, 0);

  win.refreshComposerLanguagePicker();
  assert.equal(win.document.querySelectorAll('#isa-draft-language-style').length, 1);
  win.refreshComposerLanguagePicker();
  win.refreshComposerLanguagePicker();
  assert.equal(win.document.querySelectorAll('#isa-draft-language-style').length, 1);
});

test('the language style element stays single across conversation switches', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();
  openConversation(win, CONVERSATION_B);
  openConversation(win, CONVERSATION_A);

  assert.equal(win.document.querySelectorAll('#isa-draft-language-style').length, 1);
});

function stubDiagnostics(win, overrides = {}) {
  const calls = [];
  win.ISA_DIAGNOSTICS = {
    operation() { calls.push(['operation']); return 'op-7'; },
    record(...args) { calls.push(['record', ...args]); },
    ...overrides
  };
  return calls;
}

test('a settled language picker is neither rebuilt nor repainted by further passes', () => {
  const win = loadConversation({ bar: BAR });
  win.refreshComposerLanguagePicker();
  const settled = picker(win);
  assert.ok(settled);
  const observer = new win.MutationObserver(() => {});
  observer.observe(win.document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  win.refreshComposerLanguagePicker();
  win.refreshComposerLanguagePicker();
  const records = observer.takeRecords();
  observer.disconnect();
  assert.deepEqual(records.map(record => `${record.type}:${record.attributeName || ''}`), []);
  assert.equal(picker(win), settled);
});
