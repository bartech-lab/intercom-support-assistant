'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';


function draftMarkup({
  channel = 'Email',
  senderName = 'Support Kestrel Kids',
  senderEmail = 'help@kestrel-kids.example',
  teamInbox = 'Support Kestrel Kids',
  recipient = null
} = {}) {
  const recipientPill = recipient
    ? `<div data-test-recipient-pill="true"><span>${recipient}</span></div>`
    : '';
  return `<div class="h-full w-full dark"><div class="h-full">
    <div data-testid="new-conversation-view" class="relative h-full w-full">
      <div class="h-full w-full flex">
        <div class="bg-base-module shadow-lvl-0 rounded-module">
          <div class="shrink-0 flex flex-row">
            <div class="mb-4 flex-auto">
              <div class="border border-neutral-border shadow-lvl-0">
                <div data-testid="new-conversation-channel-picker">
                  <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"
                          class="group flex items-center gap-1"><svg viewBox="0 0 16 16"></svg><span><span>${channel}</span></span><svg viewBox="0 0 16 16"></svg></button>
                </div>
                <div data-testid="composer-sender-area">
                  <div class="flex items-center py-2 border-b border-neutral-border">
                    <span class="shrink-0 text-base text-muted"><span>From</span></span>
                    <button type="button" data-test-sender-pill="true" data-testid="popover-trigger"
                            class="group ml-3 inline-flex items-center gap-1 rounded-full"><span class="truncate">${senderName}</span><span class="truncate text-muted">${senderEmail}</span></button>
                  </div>
                </div>
                <div data-testid="recipient-manager" data-composer-interactive="true">
                  <div data-testid="recipient-to-row" class="flex gap-3 py-2 items-center">
                    <span class="shrink-0 flex items-center text-muted">To</span>
                    <div data-testid="recipient-to-input" class="flex flex-1 flex-wrap items-center gap-2">${recipientPill}<div data-testid="recipient-selector" data-test-recipients-selector="true"><input role="combobox" aria-label="To recipients" type="text" value=""></div></div>
                  </div>
                </div>
                <div data-testid="new-conversation-subject"><input type="text" placeholder="Subject"></div>
                <div><div>
                  <div data-testid="composer-orchestrator" class="relative flex flex-col">
                    <div data-testid="composer-editor-area" class="relative mx-1 min-h-[72px]">
                      <div data-testid="composer-scroll-boundary" class="relative grow">
                        <div class="grid min-w-0"><div class="min-w-0 relative z-[1]">
                          <div class="composer-react-wrapper border-neutral-border no-paragraph-margin">
                            <div><div class="tiptap ProseMirror" contenteditable="true" translate="no"><p></p></div></div>
                          </div>
                        </div></div>
                      </div>
                    </div>
                    <div data-testid="composer-actions-bar">
                      <div data-testid="send-button-container"><button data-testid="send-button">Send</button></div>
                    </div>
                  </div>
                </div></div>
              </div>
            </div>
            <div data-testid="new-conversation-sidebar-column">
              <div data-testid="draft-team-assignee" class="flex flex-row items-center">
                <div class="w-2/5 py-px text-muted shrink-0"><span class="block truncate"><span>Team Inbox</span></span></div>
                <div class="w-3/5 px-1 min-w-0">
                  <button type="button" aria-label="Change team" data-testid="team-assignee-selector"><span class="truncate flex items-center ml-1"><svg data-testid="team-icon-fallback" viewBox="0 0 16 16"></svg><span class="ml-2">${teamInbox}</span></span></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div></div>`;
}


function loadDraft(options = {}) {
  return loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(win) {
        const host = win.document.getElementById('teammate-app-react');
        host.attachShadow({ mode: 'open' }).innerHTML = draftMarkup(options);
      }
    }
  );
}

function draftEditor(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('.tiptap.ProseMirror[contenteditable="true"]');
}

function clickDraftEditor(win, button) {
  const editor = draftEditor(win);
  editor.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button }));
  return editor;
}

function loadConversation() {
  const win = loadExtension(fx.inboxHtml({ composer: fx.composer({ mode: 'email' }) }));
  const outside = win.document.createElement('div');
  outside.id = 'outside-composer';
  win.document.body.appendChild(outside);
  const field = win.document.querySelector('.ProseMirror');
  const clock = { now: 1000000 };
  win.Date.now = () => clock.now;
  return { win, field, outside, clock };
}

function mouse(win, type, button) {
  return new win.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button });
}

function beforeInput(win, inputType) {
  const init = { bubbles: true, cancelable: true, composed: true };
  if (inputType === undefined) return new win.Event('beforeinput', init);
  return new win.InputEvent('beforeinput', { ...init, inputType });
}

function pasteEvent(win) {
  return new win.Event('paste', { bubbles: true, cancelable: true, composed: true });
}

function middleClick(env) {
  env.field.dispatchEvent(mouse(env.win, 'mousedown', 1));
}

const GUARDED_TYPES = ['pointerdown', 'mousedown', 'mouseup', 'auxclick'];

for (const type of GUARDED_TYPES) {
  test(`a middle-click ${type} in the composer is default-prevented`, () => {
    const { win, field } = loadConversation();
    const event = mouse(win, type, 1);
    field.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  });

  test(`a middle-click ${type} in the composer never reaches the target element`, () => {
    const { win, field } = loadConversation();
    let seen = 0;
    field.addEventListener(type, () => { seen += 1; });
    field.dispatchEvent(mouse(win, type, 1));
    assert.equal(seen, 0);
  });

  test(`a middle-click ${type} in the composer never reaches a later document capture listener`, () => {
    const { win, field } = loadConversation();
    let seen = 0;
    win.document.addEventListener(type, () => { seen += 1; }, true);
    field.dispatchEvent(mouse(win, type, 1));
    assert.equal(seen, 0);
  });

  test(`a left-click ${type} in the composer is left alone`, () => {
    const { win, field } = loadConversation();
    const event = mouse(win, type, 0);
    let seen = 0;
    field.addEventListener(type, () => { seen += 1; });
    field.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(seen, 1);
  });

  test(`a right-click ${type} in the composer is left alone`, () => {
    const { win, field } = loadConversation();
    const event = mouse(win, type, 2);
    let seen = 0;
    field.addEventListener(type, () => { seen += 1; });
    field.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(seen, 1);
  });

  test(`a middle-click ${type} outside the composer is left alone`, () => {
    const { win, outside } = loadConversation();
    const event = mouse(win, type, 1);
    let seen = 0;
    outside.addEventListener(type, () => { seen += 1; });
    outside.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(seen, 1);
  });
}

test('a middle-click inside the shadow-root editor is blocked through the composed path', () => {
  const win = loadDraft();
  const event = mouse(win, 'mousedown', 1);
  draftEditor(win).dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});

for (const inputType of ['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertText']) {
  test(`${inputType} in the composer is blocked right after a middle-click`, () => {
    const env = loadConversation();
    middleClick(env);
    env.clock.now += 10;
    const event = beforeInput(env.win, inputType);
    let seen = 0;
    env.field.addEventListener('beforeinput', () => { seen += 1; });
    env.win.document.addEventListener('beforeinput', () => { seen += 1; }, true);
    env.field.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(seen, 0);
  });

  test(`${inputType} in the composer is left alone with no middle-click`, () => {
    const env = loadConversation();
    const event = beforeInput(env.win, inputType);
    env.field.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  });
}

for (const inputType of ['deleteContentBackward', 'insertParagraph']) {
  test(`${inputType} in the composer is left alone inside the middle-click window`, () => {
    const env = loadConversation();
    middleClick(env);
    const event = beforeInput(env.win, inputType);
    env.field.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  });
}

test('a beforeinput with no inputType is left alone inside the middle-click window', () => {
  const env = loadConversation();
  middleClick(env);
  const event = beforeInput(env.win);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('a paste in the composer is blocked right after a middle-click', () => {
  const env = loadConversation();
  middleClick(env);
  env.clock.now += 10;
  const event = pasteEvent(env.win);
  let seen = 0;
  env.field.addEventListener('paste', () => { seen += 1; });
  env.win.document.addEventListener('paste', () => { seen += 1; }, true);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(seen, 0);
});

test('a paste in the composer is left alone with no middle-click', () => {
  const env = loadConversation();
  const event = pasteEvent(env.win);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('a paste outside the composer is left alone inside the middle-click window', () => {
  const env = loadConversation();
  middleClick(env);
  const event = pasteEvent(env.win);
  env.outside.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('insertFromPaste outside the composer is left alone inside the middle-click window', () => {
  const env = loadConversation();
  middleClick(env);
  const event = beforeInput(env.win, 'insertFromPaste');
  env.outside.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('a blocked paste at exactly 1000 ms after the middle-click is still blocked', () => {
  const env = loadConversation();
  middleClick(env);
  env.clock.now += 1000;
  const event = pasteEvent(env.win);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});

test('a paste 1001 ms after the middle-click is left alone', () => {
  const env = loadConversation();
  middleClick(env);
  env.clock.now += 1001;
  const event = pasteEvent(env.win);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('insertFromPaste at exactly 1000 ms after the middle-click is still blocked', () => {
  const env = loadConversation();
  middleClick(env);
  env.clock.now += 1000;
  const event = beforeInput(env.win, 'insertFromPaste');
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});

test('insertFromPaste 1001 ms after the middle-click is left alone', () => {
  const env = loadConversation();
  middleClick(env);
  env.clock.now += 1001;
  const event = beforeInput(env.win, 'insertFromPaste');
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('a second middle-click restarts the 1000 ms window', () => {
  const env = loadConversation();
  middleClick(env);
  env.clock.now += 900;
  middleClick(env);
  env.clock.now += 900;
  const event = pasteEvent(env.win);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});

test('a middle-click outside the composer does not open the window', () => {
  const env = loadConversation();
  env.outside.dispatchEvent(mouse(env.win, 'mousedown', 1));
  const event = pasteEvent(env.win);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('a left-click in the composer does not open the window', () => {
  const env = loadConversation();
  env.field.dispatchEvent(mouse(env.win, 'mousedown', 0));
  const event = pasteEvent(env.win);
  env.field.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('a primary click in the editor inserts the signature once', () => {
  const win = loadDraft();
  const editor = clickDraftEditor(win, 0);
  const once = editor.innerHTML;
  assert.ok(once.length > '<p></p>'.length);
  clickDraftEditor(win, 0);
  assert.equal(editor.innerHTML, once);
});

test('a middle click on the editor inserts nothing', () => {
  const win = loadDraft();
  const editor = clickDraftEditor(win, 1);
  assert.equal(editor.innerHTML, '<p></p>');
});

test('a right click on the editor inserts nothing', () => {
  const win = loadDraft();
  const editor = clickDraftEditor(win, 2);
  assert.equal(editor.innerHTML, '<p></p>');
});

test('a primary click outside the composer inserts nothing', () => {
  const win = loadDraft();
  const editor = draftEditor(win);
  const subject = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('[data-testid="new-conversation-subject"] input');
  subject.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }));
  win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(editor.innerHTML, '<p></p>');
});
