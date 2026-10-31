'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

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

function editorOf(win) {
  return win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('.tiptap.ProseMirror[contenteditable="true"]');
}

function clickEditor(win) {
  const editor = editorOf(win);
  editor.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }));
  return editor;
}

function setTeamInbox(win, name) {
  const shadow = win.document.getElementById("teammate-app-react").shadowRoot;
  shadow.querySelector('[data-testid="team-assignee-selector"] .ml-2').textContent = name;
}

function settle(win) {
  win.observeDraftTeamInbox();
}

function pick(options, name) {
  const win = loadDraft(options);
  settle(win);
  setTeamInbox(win, name);
  return win;
}

const EMPTY = "<p></p>";
const KESTREL_DRAFT = { senderName: "Support Kestrel Kids", senderEmail: "help@kestrel-kids.example", teamInbox: "Support Kestrel Kids" };
const UNMAPPED = { senderName: "Support Unlisted Brand", senderEmail: "help@unlisted.example", teamInbox: "Support Unlisted Brand" };

test("a hand-picked excluded inbox inserts no signature", () => {
  const win = pick(KESTREL_DRAFT, "Tier 2");
  assert.equal(clickEditor(win).innerHTML, EMPTY);
});

test("an excluded inbox hand-picked in another case with extra whitespace inserts no signature", () => {
  const win = pick(KESTREL_DRAFT, "  TIER 2 ");
  assert.equal(clickEditor(win).innerHTML, EMPTY);
});

test("an inbox that only contains an excluded name is not excluded and names its brand", () => {
  const win = pick(KESTREL_DRAFT, "Tier 2 Fernhill");
  const html = clickEditor(win).innerHTML.toLowerCase();
  assert.ok(html.includes("fernhill"), html);
});

test("an inbox that only contains an excluded name and names no brand signs as the sender brand", () => {
  const win = pick(KESTREL_DRAFT, "Legacy Tier 2 queue");
  const html = clickEditor(win).innerHTML.toLowerCase();
  assert.ok(html.length > EMPTY.length, "must not be treated as excluded");
  assert.ok(html.includes("kestrel"), html);
});

test("a hand-picked team-signature inbox inserts the team signature, not the sender brand", () => {
  const win = pick(KESTREL_DRAFT, "Billing");
  const html = clickEditor(win).innerHTML;
  assert.ok(html.includes("Support Desk"), html);
  assert.ok(!html.toLowerCase().includes("kestrel"), html);
});

test("a team-signature inbox is matched regardless of case", () => {
  const win = pick(KESTREL_DRAFT, "returns");
  assert.ok(clickEditor(win).innerHTML.includes("Support Desk"));
});

test("an inbox that names no brand signs as the sender brand", () => {
  const win = pick(KESTREL_DRAFT, "Billing Tier 2");
  const html = clickEditor(win).innerHTML.toLowerCase();
  assert.ok(html.includes("kestrel"), html);
});

test("an inbox that names no brand with an unrecognised sender inserts nothing", () => {
  const win = pick(UNMAPPED, "Billing Tier 2");
  assert.equal(clickEditor(win).innerHTML, EMPTY);
});

test("a Team Inbox equal to the synced target is not a hand-pick", () => {
  const win = loadDraft(KESTREL_DRAFT);
  settle(win);
  assert.equal(win.manualDraftTeamInboxName(), null);
  const html = clickEditor(win).innerHTML.toLowerCase();
  assert.ok(html.includes("kestrel"), html);
});

test("a Team Inbox equal to the synced target apart from case and whitespace is not a hand-pick", () => {
  const win = loadDraft({ ...KESTREL_DRAFT, teamInbox: "Fernhill leftover" });
  setTeamInbox(win, "  support KESTREL KIDS ");
  settle(win);
  assert.equal(win.manualDraftTeamInboxName(), null);
  const html = clickEditor(win).innerHTML.toLowerCase();
  assert.ok(html.includes("kestrel"), html);
  assert.ok(!html.includes("fernhill"), html);

  setTeamInbox(win, "Fernhill leftover");
  settle(win);
  assert.equal(win.manualDraftTeamInboxName(), "Fernhill leftover",
    "the inbox settled on the synced target, so a later change is a hand-pick");
});

