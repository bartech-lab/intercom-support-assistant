'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const CONVERSATION_ID = '900197044472625';
const OTHER_CONVERSATION_ID = '900534928478775';
const ORIGIN = 'https://app.intercom.com';
const URL = `${ORIGIN}/a/inbox/demo1234/inbox/team/90031012/conversation/${CONVERSATION_ID}`;

function statusEnvelope(over = {}) {
  return {
    __isaic: true,
    version: 1,
    kind: 'conversation-escalation-status',
    conversationId: CONVERSATION_ID,
    inProgress: true,
    source: 'stream',
    ...over
  };
}

function deliver(win, data, { source = win, origin = ORIGIN } = {}) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source, origin }));
}

const TEAM = '90031012';
const HIDDEN_TEAM = '90006572';

function deliverTeam(win, teamId = TEAM, conversationId = CONVERSATION_ID) {
  deliver(win, { __isaic: true, version: 1, kind: 'conversation-team', conversationId, teamId, source: 'summary' });
}

function deliverVisibility(win, teamIds = [TEAM, '900202']) {
  deliver(win, { __isaic: true, version: 1, kind: 'escalation-status-visibility', teamIds, observedAt: 1 });
}

function loadVisible(conversationAttrs = []) {
  const win = load(conversationAttrs);
  deliverVisibility(win);
  deliverTeam(win);
  return win;
}

function load(conversationAttrs = []) {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ conversationAttrs }),
    toolbar: fx.conversationToolbar({ close: true })
  }), { url: URL });
}

function closeButton(win) {
  return win.document.querySelector('svg.o__standard__close-conversation').closest('button');
}

function clickClose(win) {
  const button = closeButton(win);
  const alerts = [];
  win.alert = (message) => alerts.push(message);
  const event = {
    target: button,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
  win.handleCloseGuardClick(event);
  return { blocked: event.defaultPrevented, alerts };
}

test('control: with no Escalation Status row and no network status, closing is not blocked', () => {
  const win = load();
  assert.equal(win.isInProgressStatus(), false);
  assert.equal(clickClose(win).blocked, false);
});

test('a hidden Escalation Status row is answered by the network status', () => {
  const win = loadVisible();
  deliver(win, statusEnvelope());
  assert.equal(win.isInProgressStatus(), true);
  const click = clickClose(win);
  assert.equal(click.blocked, true);
  assert.equal(click.alerts.length, 1);
});

test('a network arrival highlights the close button without waiting for a mutation', () => {
  const win = loadVisible();
  deliver(win, statusEnvelope());
  assert.equal(closeButton(win).classList.contains('isa-in-progress-highlight'), true);
});

test('a rendered row outranks the network status', () => {
  const win = loadVisible([fx.conversationAttrRow('3001', 'Escalation Status', 'DONE')]);
  deliver(win, statusEnvelope({ inProgress: true }));
  assert.equal(win.isInProgressStatus(), false);
});

test('a rendered in progress row still blocks when the network says not in progress', () => {
  const win = loadVisible([fx.conversationAttrRow('3001', 'Escalation Status', 'in progress')]);
  deliver(win, statusEnvelope({ inProgress: false }));
  assert.equal(win.isInProgressStatus(), true);
});

test('a network status for another conversation does not answer for the open one', () => {
  const win = loadVisible();
  deliver(win, statusEnvelope({ conversationId: OTHER_CONVERSATION_ID }));
  assert.equal(win.isInProgressStatus(), false);
});

test('a later not in progress status for the same conversation replaces an earlier one', () => {
  const win = loadVisible();
  deliver(win, statusEnvelope({ inProgress: true }));
  deliver(win, statusEnvelope({ inProgress: false }));
  assert.equal(win.isInProgressStatus(), false);
  assert.equal(closeButton(win).classList.contains('isa-in-progress-highlight'), false);
});

test('a network not in progress outranks the loose in progress text scan', () => {
  const win = loadVisible([fx.conversationAttrRow('3002', 'Ticket state', 'in progress')]);
  assert.equal(win.isInProgressStatus(), true, 'precondition: the loose scan alone reports in progress');
  deliver(win, statusEnvelope({ inProgress: false }));
  assert.equal(win.isInProgressStatus(), false);
});

test('malformed or forged envelopes are ignored', () => {
  const cases = [
    ['string flag', statusEnvelope({ inProgress: 'true' })],
    ['summary source', statusEnvelope({ source: 'summary' })],
    ['non-numeric id', statusEnvelope({ conversationId: 'abc' })],
    ['wrong version', statusEnvelope({ version: 2 })],
    ['missing marker', statusEnvelope({ __isaic: false })]
  ];
  for (const [why, envelope] of cases) {
    const win = loadVisible();
    deliver(win, envelope);
    assert.equal(win.isInProgressStatus(), false, why);
  }
  const win = loadVisible();
  deliver(win, statusEnvelope(), { origin: 'https://evil.example' });
  assert.equal(win.isInProgressStatus(), false, 'foreign origin');
});

test('a team that cannot see Escalation Status never gets the network status, so closing stays allowed', () => {
  const win = load();
  deliverVisibility(win);
  deliverTeam(win, HIDDEN_TEAM);
  deliver(win, statusEnvelope());
  assert.equal(win.isInProgressStatus(), false);
  assert.equal(clickClose(win).blocked, false);
});

test('without the visibility list the network status is not used', () => {
  const win = load();
  deliverTeam(win);
  deliver(win, statusEnvelope());
  assert.equal(win.isInProgressStatus(), false);
});

test('without the conversation team the network status is not used', () => {
  const win = load();
  deliverVisibility(win);
  deliverTeam(win, TEAM, OTHER_CONVERSATION_ID);
  deliver(win, statusEnvelope());
  assert.equal(win.isInProgressStatus(), false);
});

test('a visibility list of null means every team sees the attribute', () => {
  const win = load();
  deliverVisibility(win, null);
  deliverTeam(win, HIDDEN_TEAM);
  deliver(win, statusEnvelope());
  assert.equal(win.isInProgressStatus(), true);
});

test('the visibility list arriving last still highlights the close button', () => {
  const win = load();
  deliverTeam(win);
  deliver(win, statusEnvelope());
  assert.equal(closeButton(win).classList.contains('isa-in-progress-highlight'), false);
  deliverVisibility(win);
  assert.equal(closeButton(win).classList.contains('isa-in-progress-highlight'), true);
});

test('the conversation team arriving last still highlights the close button', () => {
  const win = load();
  deliverVisibility(win);
  deliver(win, statusEnvelope());
  deliverTeam(win);
  assert.equal(closeButton(win).classList.contains('isa-in-progress-highlight'), true);
});
