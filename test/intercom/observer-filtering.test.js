'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

function build(rows, options = {}) {
  return loadExtension(fx.inboxHtml({
    list: fx.conversationList(rows, { state: 'Open', ...options }),
    composer: fx.composer({ mode: 'email' })
  }));
}

function rowsFor(names) {
  return names.map((name, index) => fx.conversationListRow({
    conversationId: `${900 + index}`,
    name
  }));
}

function record(win, { type = 'childList', target, added = [], removed = [] }) {
  return {
    type,
    target: target || win.document.body,
    addedNodes: added,
    removedNodes: removed
  };
}

test('a batch of only our own injected nodes needs no row pass', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  const chip = win.document.createElement('span');
  chip.setAttribute('data-isa-own', '');

  assert.equal(win.mutationsNeedRowPasses([record(win, { added: [chip] })]), false);
});

test('a batch containing an unrecognised node still needs a row pass', () => {
  const win = build(rowsFor(['Ann Lee']));
  const ours = win.document.createElement('span');
  ours.setAttribute('data-isa-own', '');
  const theirs = win.document.createElement('div');

  assert.equal(win.mutationsNeedRowPasses([record(win, { added: [ours, theirs] })]), true);
});

test('a removal of a node that is not ours still needs a row pass', () => {
  const win = build(rowsFor(['Ann Lee']));
  const theirs = win.document.createElement('div');

  assert.equal(win.mutationsNeedRowPasses([record(win, { removed: [theirs] })]), true);
});

test('an empty or absent record list needs a row pass, so an unknown shape fails open', () => {
  const win = build(rowsFor(['Ann Lee']));

  assert.equal(win.mutationsNeedRowPasses([]), true);
  assert.equal(win.mutationsNeedRowPasses(null), true);
  assert.equal(win.mutationsNeedRowPasses(undefined), true);
});

test('a childList record with no added or removed nodes needs a row pass', () => {
  const win = build(rowsFor(['Ann Lee']));

  assert.equal(win.mutationsNeedRowPasses([record(win, {})]), true);
});

test('text inside our own chip needs no row pass', () => {
  const win = build(rowsFor(['Ann Lee']));
  const chip = win.document.createElement('span');
  chip.setAttribute('data-isa-own', '');
  chip.textContent = 'x';

  assert.equal(win.mutationsNeedRowPasses([
    record(win, { type: 'characterData', target: chip.firstChild })
  ]), false);
});

test('a decorated row is never treated as ours, because real changes land there', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());

  const decorated = win.conversationListRows()[0];
  assert.ok(decorated.classList.contains('isa-duplicate-customer-row'), 'row is decorated');
  assert.equal(win.isOwnInjectedNode(decorated), false);

  const text = win.document.createTextNode('renamed');
  decorated.appendChild(text);
  assert.equal(win.mutationsNeedRowPasses([
    record(win, { target: decorated, added: [text] })
  ]), true);
});

test('a composer keystroke needs no row pass', () => {
  const win = build(rowsFor(['Ann Lee']));
  const editor = win.document.querySelector('[data-testid="composer-orchestrator"]')
    || win.document.querySelector('.inbox2__composer__container');
  assert.ok(editor, 'the fixture provides a composer container');

  const typed = win.document.createTextNode('hello');
  editor.appendChild(typed);

  assert.equal(win.mutationsNeedRowPasses([
    record(win, { type: 'characterData', target: typed })
  ]), false);
});

test('a text change outside the composer needs a row pass', () => {
  const win = build(rowsFor(['Ann Lee']));
  const row = win.conversationListRows()[0];
  const text = win.document.createTextNode('Ann Lee');
  row.appendChild(text);

  assert.equal(win.mutationsNeedRowPasses([
    record(win, { type: 'characterData', target: text })
  ]), true);
});

test('a self-inflicted batch runs no pass while the heartbeat is not due', async () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  let passes = 0;
  win.refreshDuplicateCustomerHighlights = () => { passes += 1; };

  const ours = win.document.createElement('span');
  ours.setAttribute('data-isa-own', '');
  list.appendChild(ours);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(passes, 0, 'our own insertion woke nothing');

  list.appendChild(win.document.createElement('div'));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(passes > 0, 'a change that is not ours still wakes the pass');
});

test('the heartbeat forces a pass even when every record is ours', async () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  let passes = 0;
  win.refreshDuplicateCustomerHighlights = () => { passes += 1; };
  win.passClock = () => Date.now() + 60000;

  const ours = win.document.createElement('span');
  ours.setAttribute('data-isa-own', '');
  list.appendChild(ours);

  await new Promise(resolve => setTimeout(resolve, 300));

  assert.ok(passes > 0, 'the overdue heartbeat ran a pass for a batch that held only our own node');
});

test('once a shadow root is adopted, light-DOM changes still wake a pass', async () => {
  const html = fx.inboxHtml({
    list: fx.conversationList(rowsFor(['Ann Lee', 'Ann Lee']), { state: 'Open' }),
    composer: fx.composer({ mode: 'email' })
  }).replace('<body>', '<body><div id="teammate-app-react"></div>');

  const win = loadExtension(html, {
    beforeScripts: target => target.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' })
  });
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  let passes = 0;
  win.refreshDuplicateCustomerHighlights = () => { passes += 1; };

  list.appendChild(win.document.createElement('div'));
  await new Promise(resolve => setTimeout(resolve, 300));

  assert.ok(passes > 0,
    'adopting the shadow root must not stop the extension from observing light-DOM mutations');
});

test('a class strip that leaves our chip behind is recognised and needs a pass', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());

  const row = win.conversationListRows()[0];
  assert.ok(row.querySelector('.isa-duplicate-customer-chip'), 'chip is present');
  row.className = 'ember-view group';

  assert.equal(win.mutationsNeedRowPasses([
    { type: 'attributes', attributeName: 'class', target: row, addedNodes: [], removedNodes: [] }
  ]), true, 'the screenshot case: chip kept, colours gone');
});

test('an ordinary class change elsewhere needs no pass', () => {
  const win = build(rowsFor(['Ann Lee']));
  const row = win.conversationListRows()[0];

  assert.equal(win.mutationsNeedRowPasses([
    { type: 'attributes', attributeName: 'class', target: row, addedNodes: [], removedNodes: [] }
  ]), false, 'an undecorated row is not a strip');
});

test('a decorated row that still has its class needs no pass, so re-asserting cannot loop', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());
  const row = win.conversationListRows()[0];

  assert.equal(win.mutationsNeedRowPasses([
    { type: 'attributes', attributeName: 'class', target: row, addedNodes: [], removedNodes: [] }
  ]), false);
});

test('a support marker stripped of its class is recognised too', () => {
  const win = build(rowsFor(['Ann Lee']));
  win.rememberInboundAddresses('900', ['support@brightwell.example']);
  win.runWithPassCache(() => win.refreshSupportOriginHighlights());

  const row = win.conversationListRows()[0];
  assert.ok(row.hasAttribute('data-isa-support-origin'));
  row.className = 'ember-view group';

  assert.equal(win.mutationsNeedRowPasses([
    { type: 'attributes', attributeName: 'class', target: row, addedNodes: [], removedNodes: [] }
  ]), true);
});

test('Intercom removing our chip is not treated as self-inflicted', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());
  const chip = win.document.querySelector('.isa-duplicate-customer-chip');

  assert.equal(win.mutationsNeedRowPasses([
    { type: 'childList', target: chip.parentElement, addedNodes: [], removedNodes: [chip] }
  ]), true, 'a removal must never be mistaken for our own insertion');
});

test('a stripped row regains its colour on the next pass with the chip unduplicated', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());

  win.conversationListRows().forEach(row => { row.className = 'ember-view group'; });
  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());

  for (const row of win.conversationListRows()) {
    assert.ok(row.classList.contains('isa-duplicate-customer-row'), 'colour restored');
    assert.equal(row.querySelectorAll('.isa-duplicate-customer-chip').length, 1, 'chip not stacked');
  }
});

test('a record that adds our chip and also removes a node is not self-inflicted', () => {
  const win = build(rowsFor(['Ann Lee']));
  const chip = win.document.createElement('span');
  chip.setAttribute('data-isa-own', '');
  const gone = win.document.createElement('div');

  assert.equal(win.mutationsNeedRowPasses([record(win, { added: [chip], removed: [gone] })]), true);
  assert.equal(win.mutationsNeedRowPasses([record(win, { added: [chip], removed: [] })]), false);
});

test('a pass slower than the throttle window does not start the next pass back to back', async () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  await new Promise(resolve => setTimeout(resolve, 300));

  let now = win.Date.now();
  win.Date.now = () => now;
  let passes = 0;
  win.refreshDuplicateCustomerHighlights = () => {
    passes += 1;
    now += 1000;
    if (passes < 20) list.appendChild(win.document.createElement('div'));
  };

  list.appendChild(win.document.createElement('div'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(passes, 1, 'the mutations of a slow pass wait for the trailing edge');
});

test('an unresolved user id is left alone, so an idle conversation runs no passes', async () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Shared Desk North', conversationAttrs: [] }),
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue('anselm.sample@example.com')),
      fx.userDetailRow('User id', fx.userIdValue('C23250'))
    ]),
    conversation: fx.conversationSpace({ customerText: 'Hallo' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: 'https://app.intercom.com/a/inbox/demo1234/inbox/team/90009672/conversation/900202944780103' });
  win.console.warn = () => {};
  win.console.debug = () => {};
  await new Promise(resolve => setTimeout(resolve, 300));

  const value = win.document.querySelector('[data-original-user-id]');
  assert.ok(value, 'the user id row was seen');
  const textNode = value.firstChild;
  let passes = 0;
  win.refreshDuplicateCustomerHighlights = () => { passes += 1; };
  await new Promise(resolve => setTimeout(resolve, 500));

  assert.equal(passes, 0, 'no pass ran on an idle conversation');
  assert.equal(value.firstChild, textNode, 'the user id text node was not replaced');
  assert.equal(value.textContent, 'C23250');
});
