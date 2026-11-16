'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');
const fx = require('../support/fixtures');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const KESTREL = { senderName: 'Support Kestrel Kids', senderEmail: 'help@kestrel-kids.example', teamInbox: 'Support Kestrel Kids' };
const UNKNOWN = { senderName: 'Fernhill', senderEmail: 'agent.one@example.com', teamInbox: 'Support Marlowe Books' };
const UNKNOWN_DETAIL = 'The extension has no signature for agent.one@example.com. Pick a brand sender address, or ask the extension owner to add this one.';
const NEVER_SIGNS_EMAIL = 'two@example.com';
const NEVER_SIGNS_INBOX = 'Tier 2';

function draftMarkup({
  channel = 'Email',
  senderName = 'Support Kestrel Kids',
  senderEmail = 'help@kestrel-kids.example',
  teamInbox = 'Support Kestrel Kids',
  recipient = null,
  bar = '<div class="bar-first"></div><div class="bar-second"></div>'
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
                      ${bar}<div data-testid="send-button-container"><button data-testid="send-button">Send</button></div>
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
  const calls = { warn: [] };
  const win = loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      chromeStub: makeChromeStub(),
      beforeScripts(w) {
        w.document.getElementById('teammate-app-react')
          .attachShadow({ mode: 'open' }).innerHTML = draftMarkup(options);
        w.console = {
          log: () => {},
          error: () => {},
          debug: () => {},
          warn: (...args) => calls.warn.push(args.join(' '))
        };
      }
    }
  );
  return { win, calls };
}

function root(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot;
}

function setTeamInbox(win, name) {
  root(win).querySelector('[data-testid="team-assignee-selector"] .ml-2').textContent = name;
}

function setSender(win, name, email) {
  const spans = root(win).querySelectorAll('[data-test-sender-pill="true"] span');
  spans[0].textContent = name;
  spans[1].textContent = email;
}

function holders(win) {
  return [...root(win).querySelectorAll('.isa-signature-status')];
}

function refresh(win) {
  assert.equal(typeof win.refreshSignatureStatus, 'function');
  win.refreshSignatureStatus();
  return holders(win);
}

function chipOf(holder) {
  return holder.querySelector('button.isa-signature-status-chip');
}

function openBox(win, holder) {
  chipOf(holder).dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  return holder.querySelector('.isa-signature-status-box');
}

function expectUnknownChip(win) {
  const found = refresh(win);
  assert.equal(found.length, 1);
  const [holder] = found;
  assert.equal(holder.getAttribute('data-isa-signature-status'), 'sender-unknown');
  assert.equal(holder.getAttribute('role'), 'status');
  assert.equal(holder.hasAttribute('data-isa-own'), true);
  assert.equal(holder.getAttribute('data-isa-signature-status-owner'), win.extensionInstallId());
  assert.equal(holder.parentElement, root(win).querySelector('.bar-first'));
  assert.equal(chipOf(holder).textContent, 'No signature for this sender');
  assert.equal(chipOf(holder).getAttribute('title'), UNKNOWN_DETAIL);
  return holder;
}

test('draft: a sender address the extension does not know shows sender-unknown and names the address', () => {
  const { win, calls } = loadDraft(UNKNOWN);
  assert.equal(win.isNewConversationView(), true);
  assert.equal(win.manualDraftTeamInboxName(), null);
  expectUnknownChip(win);
  assert.deepStrictEqual(Array.from(calls.warn), []);
});

test('draft: sender-unknown names whichever address is selected, not a fixed one', () => {
  const { win } = loadDraft({ ...UNKNOWN, senderEmail: 'support@example.com' });
  const [holder] = refresh(win);
  assert.equal(chipOf(holder).getAttribute('title'),
    'The extension has no signature for support@example.com. Pick a brand sender address, or ask the extension owner to add this one.');
});

test('draft: sender-unknown goes away when the operator picks a known brand sender', () => {
  const { win } = loadDraft(UNKNOWN);
  assert.equal(refresh(win).length, 1);
  setSender(win, KESTREL.senderName, KESTREL.senderEmail);
  setTeamInbox(win, KESTREL.teamInbox);
  assert.equal(refresh(win).length, 0);
});

test('draft: a known brand sender shows no chip', () => {
  const { win } = loadDraft(KESTREL);
  assert.equal(refresh(win).length, 0);
});

test('draft: a sender mapped to an inbox that never signs shows no chip', () => {
  const { win } = loadDraft({ senderName: 'Tier Two', senderEmail: NEVER_SIGNS_EMAIL, teamInbox: NEVER_SIGNS_INBOX });
  win.eval(`senderFromEmailToInbox[${JSON.stringify(NEVER_SIGNS_EMAIL)}] = ${JSON.stringify(NEVER_SIGNS_INBOX)};`);
  assert.equal(win.getSelectedSenderEmail(), NEVER_SIGNS_EMAIL);
  assert.equal(refresh(win).length, 0);
});

test('draft: no sender selected shows no chip', () => {
  const { win } = loadDraft({ senderName: '', senderEmail: '', teamInbox: UNKNOWN.teamInbox });
  assert.equal(win.getSelectedSenderEmail(), null);
  assert.equal(refresh(win).length, 0);
});

test('draft: a note draft from an unknown sender shows no chip', () => {
  const { win } = loadDraft({ ...UNKNOWN, channel: 'Note' });
  assert.equal(refresh(win).length, 0);
});

test('draft: the sender-unknown box has no Open signatures button, because the fix is another sender', () => {
  const { win } = loadDraft(UNKNOWN);
  const [holder] = refresh(win);
  const box = openBox(win, holder);
  assert.equal(box.querySelector('strong').textContent, 'No signature here');
  assert.ok(box.textContent.includes(UNKNOWN_DETAIL), box.textContent);
  assert.equal(box.querySelectorAll('.isa-signature-status-link').length, 0);
});

test('draft: the language picker stays and there is exactly one holder beside it', () => {
  const { win } = loadDraft(UNKNOWN);
  win.refreshComposerLanguagePicker();
  assert.ok(root(win).querySelector('.isa-draft-language-picker'));
  expectUnknownChip(win);
  assert.ok(root(win).querySelector('.isa-draft-language-picker'));
  refresh(win);
  assert.equal(holders(win).length, 1);
});

test('draft: the language picker is present when no chip is shown', () => {
  const { win } = loadDraft(KESTREL);
  win.refreshComposerLanguagePicker();
  assert.equal(refresh(win).length, 0);
  assert.ok(root(win).querySelector('.isa-draft-language-picker'));
});

test('reply: a brand-unclear chip still appears in a conversation view', () => {
  const composer = fx.composer({ mode: 'email' })
    .replace('<button>Send</button>',
      '<div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div><button>Send</button>')
    .replace('role="textbox"', 'role="textbox" tabindex="0"');
  const html = fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Brightwell',
      conversationAttrs: [fx.conversationAttrRow('9006910', 'Brand', 'Alderpoint')]
    }),
    conversation: fx.conversationSpace({ customerText: 'Hello' }),
    composer
  });
  const win = loadExtension(html, {
    url: 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900999/conversation/900401386132981',
    chromeStub: makeChromeStub()
  });
  const clock = { now: 1000000 };
  win.Date.now = () => clock.now;
  win.handleConversationChange();
  assert.equal(typeof win.refreshSignatureStatus, 'function');
  win.refreshSignatureStatus();
  assert.equal(win.document.querySelectorAll('.isa-signature-status').length, 0);
  clock.now += 2000;
  win.refreshSignatureStatus();
  const found = [...win.document.querySelectorAll('.isa-signature-status')];
  assert.equal(found.length, 1);
  assert.equal(found[0].getAttribute('data-isa-signature-status'), 'brand-unclear');
  assert.equal(chipOf(found[0]).textContent, 'No signature: brand unclear');
});
