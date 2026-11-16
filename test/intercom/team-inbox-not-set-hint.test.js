'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');
const fx = require('../support/fixtures');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/team/900999/conversation/900401386132981';
const ALDERPOINT = 'help@alderpoint.example';
const BRIGHTWELL = 'help@brightwell.example';
const UNMAPPED = 'agent.one@example.com';
const ALDERPOINT_INBOX = 'Support Alderpoint';
const BRIGHTWELL_INBOX = 'Support Brightwell';
const START_INBOX = 'General chats';
const TEAMS = ['Urgent Alderpoint', ALDERPOINT_INBOX, BRIGHTWELL_INBOX, START_INBOX];
const LABEL = 'Team Inbox not set';
const REASON = 'team-inbox-not-set';
const DETAIL = `The extension could not select ${ALDERPOINT_INBOX} automatically. Pick the Team Inbox by hand.`;
const DETAIL_BRIGHTWELL = `The extension could not select ${BRIGHTWELL_INBOX} automatically. Pick the Team Inbox by hand.`;

function draftMarkup({ senderEmail, teamInbox }) {
  return `<div data-testid="new-conversation-view">
    <div data-testid="new-conversation-channel-picker">
      <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"><span><span>Email</span></span></button>
    </div>
    <div data-testid="composer-sender-area">
      <span><span>From</span></span>
      <button type="button" data-test-sender-pill="true" data-testid="popover-trigger"><span class="truncate">Sender</span><span class="truncate">${senderEmail}</span></button>
    </div>
    <div data-testid="recipient-manager"><div data-testid="recipient-to-row"><div data-testid="recipient-to-input"><div data-testid="recipient-selector"><input role="combobox" type="text" value=""></div></div></div></div>
    <div data-testid="composer-orchestrator">
      <div data-testid="composer-editor-area"><div class="composer-react-wrapper"><div><div class="tiptap ProseMirror" contenteditable="true"><p></p></div></div></div></div>
      <div data-testid="composer-actions-bar"><div data-testid="send-button-container"><button data-testid="send-button">Send</button></div></div>
    </div>
    <div data-testid="draft-team-assignee">
      <span><span>Team Inbox</span></span>
      <button type="button" aria-label="Change team" data-testid="team-assignee-selector"><span><span>${teamInbox}</span></span></button>
    </div>
  </div>`;
}

function rig({ clicksWork = false, senderEmail = UNMAPPED } = {}) {
  const calls = { warn: [] };
  const state = { clicksWork };
  const win = loadExtension('<!doctype html><html><body><div id="teammate-app-react"></div></body></html>', {
    url: NEW_CONVERSATION_URL,
    beforeScripts(w) {
      w.console = {
        log: () => {},
        error: () => {},
        debug: () => {},
        warn: (...args) => calls.warn.push(args.join(' '))
      };
      w.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' }).innerHTML =
        draftMarkup({ senderEmail, teamInbox: START_INBOX });
    }
  });
  const doc = win.document;
  const timers = [];
  win.setTimeout = (callback, delayMs = 0) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  win.clearTimeout = () => {};
  const root = doc.getElementById('teammate-app-react').shadowRoot;
  const team = () => root.querySelector('[data-testid="team-assignee-selector"] span span');
  const palette = () => doc.querySelector('[data-command-palette]:not([data-state="closed"])');
  root.querySelector('[data-testid="team-assignee-selector"]').addEventListener('click', () => {
    const holder = doc.createElement('div');
    holder.innerHTML = `<div role="dialog" data-state="open" data-command-palette=""><input role="combobox" type="text"><div role="listbox">${
      TEAMS.map((name, index) => `<div id="cmdk-opt-new-conversation-assign-team-${index}" role="option"><span>${name}</span></div>`).join('')}</div></div>`;
    doc.body.appendChild(holder.firstElementChild);
  });
  doc.addEventListener('click', event => {
    const option = event.target.closest && event.target.closest('[role="option"]');
    if (!option || !state.clicksWork) return;
    team().textContent = option.textContent.trim();
    palette()?.setAttribute('data-state', 'closed');
  }, true);
  const settle = () => {
    for (let guard = 0; timers.length && guard < 500; guard += 1) timers.shift().callback();
  };
  const setSender = email => {
    root.querySelector('[data-test-sender-pill] span:last-child').textContent = email;
  };
  const pick = (email, intercomResetsTeam = false) => {
    setSender(email);
    if (intercomResetsTeam) team().textContent = START_INBOX;
    win.syncTeamInboxFromSender();
    settle();
  };
  const startPick = email => {
    setSender(email);
    win.syncTeamInboxFromSender();
  };
  return { win, pick, startPick, setSender, team, settle, calls, state };
}

function queryAll(win, selector) {
  const roots = [win.document];
  const host = win.document.getElementById('teammate-app-react');
  if (host && host.shadowRoot) roots.push(host.shadowRoot);
  return roots.flatMap(root => [...root.querySelectorAll(selector)]);
}

function holders(win) {
  return queryAll(win, `.isa-signature-status[data-isa-signature-status="${REASON}"]`);
}

function refresh(win) {
  assert.equal(typeof win.refreshSignatureStatus, 'function');
  win.refreshSignatureStatus();
  return holders(win);
}

function chipOf(holder) {
  return holder.querySelector('button.isa-signature-status-chip');
}

function click(win, element) {
  element.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
}

function failedRig(options) {
  const r = rig(options);
  r.pick(ALDERPOINT);
  assert.equal(r.team().textContent, START_INBOX);
  return r;
}

function assertHint(win, detail = DETAIL) {
  const found = refresh(win);
  assert.equal(found.length, 1);
  assert.equal(found[0].getAttribute('data-isa-signature-status'), REASON);
  assert.equal(chipOf(found[0]).textContent, LABEL);
  assert.equal(chipOf(found[0]).getAttribute('title'), detail);
  return found[0];
}

test('a failed auto-select for the selected sender shows the Team Inbox not set chip with the full DOM contract', () => {
  const { win } = failedRig();
  const holder = assertHint(win);
  assert.equal(holder.tagName, 'SPAN');
  assert.equal(holder.getAttribute('role'), 'status');
  assert.equal(holder.hasAttribute('data-isa-own'), true);
  assert.equal(holder.getAttribute('data-isa-signature-status-owner'), win.extensionInstallId());
  assert.equal(holder.parentElement, queryAll(win, '[data-testid="composer-actions-bar"]')[0].firstElementChild);
  assert.equal(chipOf(holder).tagName, 'BUTTON');
  assert.equal(chipOf(holder).getAttribute('aria-expanded'), 'false');
  assert.equal(queryAll(win, '.isa-signature-status-box').length, 0);
});

test('the detail names the inbox mapped to the sender that failed, not a fixed one', () => {
  const r = rig();
  r.pick(BRIGHTWELL);
  assert.equal(r.team().textContent, START_INBOX);
  assertHint(r.win, DETAIL_BRIGHTWELL);
});

test('clicking the chip opens a box with the heading and the detail and no Open signatures button', () => {
  const { win } = failedRig();
  const holder = assertHint(win);
  click(win, chipOf(holder));
  const boxes = queryAll(win, '.isa-signature-status-box');
  assert.equal(boxes.length, 1);
  assert.equal(holder.contains(boxes[0]), true);
  assert.match(boxes[0].textContent, /Team Inbox not set/);
  assert.ok(boxes[0].textContent.includes(DETAIL), boxes[0].textContent);
  assert.equal(chipOf(holder).getAttribute('aria-expanded'), 'true');
  assert.equal(boxes[0].querySelector('.isa-signature-status-link'), null);
  assert.equal(queryAll(win, '.isa-signature-status-link').length, 0);
});

test('showing the hint does not call console.warn', () => {
  const { win, calls } = failedRig();
  assertHint(win);
  click(win, chipOf(holders(win)[0]));
  assert.deepStrictEqual(Array.from(calls.warn), []);
});

test('a fresh draft with no sender selected has no hint', () => {
  const r = rig();
  assert.equal(refresh(r.win).length, 0);
});

test('a sender whose apply succeeded has no hint', () => {
  const r = rig({ clicksWork: true });
  r.pick(ALDERPOINT);
  assert.equal(r.team().textContent, ALDERPOINT_INBOX);
  assert.equal(refresh(r.win).length, 0);
});

test('an apply still in flight has no hint until it ends in failure', () => {
  const r = rig();
  r.startPick(ALDERPOINT);
  assert.equal(r.team().textContent, START_INBOX);
  assert.equal(refresh(r.win).length, 0);
  r.settle();
  assert.equal(r.team().textContent, START_INBOX);
  assertHint(r.win);
});

test('an unmapped sender never shows the hint', () => {
  const r = rig();
  r.pick(UNMAPPED);
  assert.equal(refresh(r.win).length, 0);
});

test('selecting a different sender after the failure removes the hint', () => {
  const r = failedRig();
  assertHint(r.win);
  r.setSender(UNMAPPED);
  assert.equal(refresh(r.win).length, 0);
});

test('a different mapped sender after the failure removes the hint', () => {
  const r = failedRig();
  assertHint(r.win);
  r.setSender(BRIGHTWELL);
  assert.equal(refresh(r.win).length, 0);
});

test('picking the mapped inbox by hand after the failure removes the hint', () => {
  const r = failedRig();
  assertHint(r.win);
  r.team().textContent = ALDERPOINT_INBOX;
  assert.equal(refresh(r.win).length, 0);
});

test('picking another inbox by hand after the failure removes the hint', () => {
  const r = failedRig();
  assertHint(r.win);
  r.team().textContent = BRIGHTWELL_INBOX;
  assert.equal(refresh(r.win).length, 0);
});

test('a later auto-select for the same sender that succeeds removes the hint', () => {
  const r = failedRig();
  assertHint(r.win);
  r.state.clicksWork = true;
  r.win.eval('lastAppliedSenderEmail = null');
  r.win.syncTeamInboxFromSender();
  r.settle();
  assert.equal(r.team().textContent, ALDERPOINT_INBOX);
  assert.equal(refresh(r.win).length, 0);
});

test('a retry in flight after a failure hides the hint until the retry ends', () => {
  const r = failedRig();
  assertHint(r.win);
  r.win.eval('lastAppliedSenderEmail = null');
  r.win.syncTeamInboxFromSender();
  assert.equal(r.team().textContent, START_INBOX);
  assert.equal(refresh(r.win).length, 0);
  r.settle();
  assertHint(r.win);
});

test('after a later success the hint stays gone when the Team Inbox reads the old value again', () => {
  const r = failedRig();
  r.state.clicksWork = true;
  r.win.eval('lastAppliedSenderEmail = null');
  r.win.syncTeamInboxFromSender();
  r.settle();
  assert.equal(r.team().textContent, ALDERPOINT_INBOX);
  r.team().textContent = START_INBOX;
  assert.equal(refresh(r.win).length, 0);
});

test('leaving the New Conversation view removes the hint', () => {
  const r = failedRig();
  assertHint(r.win);
  r.win.history.pushState({}, '', CONVERSATION_URL);
  assert.equal(r.win.isNewConversationView(), false);
  assert.equal(refresh(r.win).length, 0);
});

const BAR = '<div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>';

function replyView() {
  const chrome = makeChromeStub();
  const composer = fx.composer({ mode: 'email' })
    .replace('<button>Send</button>', `${BAR}<button>Send</button>`)
    .replace('role="textbox"', 'role="textbox" tabindex="0"');
  const html = fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Brightwell',
      conversationAttrs: [fx.conversationAttrRow('9006910', 'Brand', 'Alderpoint')]
    }),
    conversation: fx.conversationSpace({ customerText: 'Hello' }),
    composer
  });
  const win = loadExtension(html, { url: CONVERSATION_URL, chromeStub: chrome });
  const clock = { now: 1000000 };
  win.Date.now = () => clock.now;
  win.handleConversationChange();
  return { win, clock };
}

test('contrast: a signature reason box has the No signature here heading and the Open signatures button', () => {
  const { win, clock } = replyView();
  win.refreshSignatureStatus();
  clock.now += 2000;
  win.refreshSignatureStatus();
  const found = queryAll(win, '.isa-signature-status[data-isa-signature-status="brand-unclear"]');
  assert.equal(found.length, 1);
  click(win, chipOf(found[0]));
  const [box] = queryAll(win, '.isa-signature-status-box');
  assert.equal(box.querySelector('strong').textContent, 'No signature here');
  assert.doesNotMatch(box.textContent, /Team Inbox not set/);
  assert.equal(box.querySelectorAll('.isa-signature-status-link').length, 1);
});
