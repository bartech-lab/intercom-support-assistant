'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const { TEAM, build, row, TAMSIN, MERROW, chipText, CONTACT_A, CONTACT_B } = require('../support/duplicate-conversations-harness');

const ORIGIN = 'https://app.intercom.com';
const CONVERSATION_URL = `${ORIGIN}/a/inbox/team/123/conversation/456`;
const MAILBOX_TEAM = '90009672';
const MAILBOX_CONVERSATION_ID = '900202944780103';

function deliver(win, data) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: ORIGIN }));
}

const base = { __isaic: true, version: 1 };
const brand = (id, value, source = 'stream') => ({ ...base, kind: 'conversation-company', conversationId: String(id), company: value, source });
const language = (id, value, source = 'stream') => ({ ...base, kind: 'conversation-language', conversationId: String(id), language: value, source });
const identity = (id, email, source = 'stream') => ({ ...base, kind: 'conversation-identity', conversationId: String(id), email, source });
const inboundAddress = (id, addresses) => ({ ...base, kind: 'conversation-inbound-address', conversationId: String(id), source: 'stream', addresses });
const listState = (inboxId, state) => ({ ...base, kind: 'inbox-list-state', inboxType: 'team', inboxId, inboxKey: `team:${inboxId}`, state });
const listIdentities = (entries, inboxId = TEAM) => ({
  ...base,
  kind: 'inbox-list-identity',
  inboxType: 'team',
  inboxId,
  inboxKey: `team:${inboxId}:open`,
  state: 'open',
  identities: entries
});

const hex24 = (n) => n.toString(16).padStart(24, '0');
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const plainWindow = () => loadExtension(fx.inboxHtml({}), { url: CONVERSATION_URL });
const hasKey = (collection, key) => (typeof collection.has === 'function' ? collection.has(key) : key in collection);

const boundedCases = [
  ['brand', (id) => brand(id, `Brand ${id}`), (win, id) => win.resolveNetworkCompany(String(id))],
  ['language', (id) => language(id, 'German'), (win, id) => win.resolveNetworkLanguage(String(id))],
  ['identity', (id) => identity(id, `p${id}@example.com`), (win, id) => win.resolveNetworkIdentity(String(id))]
];

for (const [name, envelope, resolve] of boundedCases) {
  test(`${name} cache keeps 20 conversations and evicts the oldest inserted`, () => {
    const win = plainWindow();
    range(1, 20).forEach((id) => deliver(win, envelope(id)));
    assert.notEqual(resolve(win, 1), null);
    deliver(win, envelope(21));
    assert.equal(resolve(win, 1), null);
    assert.notEqual(resolve(win, 2), null);
    assert.notEqual(resolve(win, 21), null);
  });

  test(`${name} cache: updating an existing conversation is not a new one`, () => {
    const win = plainWindow();
    range(1, 20).forEach((id) => deliver(win, envelope(id)));
    deliver(win, envelope(5));
    range(1, 20).forEach((id) => assert.notEqual(resolve(win, id), null, `conversation ${id}`));
  });
}

function loadMailboxWindow() {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Shared Desk North', conversationAttrs: [] }),
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue('anselm.sample@example.com')),
      fx.userDetailRow('User id', fx.userIdValue('C23250'))
    ]),
    conversation: fx.conversationSpace({ customerText: 'Hallo' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: `${ORIGIN}/a/inbox/demo1234/inbox/team/${MAILBOX_TEAM}/conversation/${MAILBOX_CONVERSATION_ID}` });
}

const mailboxCompany = (win) => win.resolveInboundMailboxCompany(MAILBOX_CONVERSATION_ID);

test('inbound-address cache keeps 200 conversations and evicts the oldest inserted', () => {
  const win = loadMailboxWindow();
  win.console.warn = () => {};
  win.console.debug = () => {};
  deliver(win, inboundAddress(MAILBOX_CONVERSATION_ID, ['help@brightwell.example']));
  assert.notEqual(mailboxCompany(win), null);
  range(1, 199).forEach((id) => deliver(win, inboundAddress(id, ['help@brightwell.example'])));
  assert.notEqual(mailboxCompany(win), null, 'still held at 200 conversations');
  deliver(win, inboundAddress(200, ['help@brightwell.example']));
  assert.equal(mailboxCompany(win), null);
});

const inboxCounts = (ids, observedAt) => ({
  ...base,
  kind: 'inbox-counts',
  observedAt,
  counts: ids.map((n) => ({ inboxType: 'team', inboxId: String(n), count: 1 }))
});

test('inbox counts keep 100 inboxes and forget the one observed longest ago, not the first inserted', () => {
  const win = plainWindow();
  deliver(win, inboxCounts(range(1, 50), 2000));
  deliver(win, inboxCounts(range(51, 100), 1000));
  deliver(win, inboxCounts([101], 3000));
  const seen = (n) => win.networkInboxObservation('team', String(n)) !== null;
  assert.equal(seen(51), false, 'the oldest observation is forgotten');
  assert.deepEqual([1, 50, 52, 100, 101].filter(seen), [1, 50, 52, 100, 101]);
});

const identityWindow = () => build([row('1', TAMSIN)]);
const stateOfCurrentInbox = (win) => win.networkListStateForCurrentInbox();

test('list state per inbox: the current inbox is evicted after 50 other inboxes', () => {
  const win = identityWindow();
  deliver(win, listState(TEAM, 'open'));
  range(1, 50).forEach((n) => deliver(win, listState(String(8000 + n), 'open')));
  assert.equal(stateOfCurrentInbox(win), null);
});

test('list state per inbox: the current inbox survives 49 other inboxes', () => {
  const win = identityWindow();
  deliver(win, listState(TEAM, 'open'));
  range(1, 49).forEach((n) => deliver(win, listState(String(8000 + n), 'open')));
  assert.equal(stateOfCurrentInbox(win), 'open');
});

const brandWindow = () => loadExtension(fx.inboxHtml({
  sidebar: fx.sidebarSection({ teamInbox: 'Shared Desk East', conversationAttrs: [] }),
  userDetails: fx.userDetailsSection([
    fx.userDetailRow('Email', fx.emailValue('elske.arden@example.com')),
    fx.userDetailRow('User id', fx.userIdValue('900801_quayside'))
  ])
}), { url: CONVERSATION_URL });

test('brand precedence per conversation', () => {
  const cases = [
    ['summary only', [['summary', 'Alpha']], 'Alpha'],
    ['stream only', [['stream', 'Beta']], 'Beta'],
    ['both equal', [['summary', 'Gamma'], ['stream', 'Gamma']], 'Gamma'],
    ['different, stream last', [['summary', 'Delta'], ['stream', 'Echo']], 'Echo'],
    ['different, summary last', [['stream', 'Echo'], ['summary', 'Delta']], 'Echo']
  ];
  for (const [label, posts, expected] of cases) {
    const win = brandWindow();
    posts.forEach(([source, value]) => deliver(win, brand(456, value, source)));
    assert.equal(win.resolveNetworkCompany('456'), expected, label);
  }
});

test('brand of only spaces is ignored and keeps the earlier value', () => {
  const win = brandWindow();
  deliver(win, brand(456, 'Alpha'));
  deliver(win, brand(456, '   '));
  assert.equal(win.resolveNetworkCompany('456'), 'Alpha');
});

test('brand surrounding spaces are trimmed before storing', () => {
  const win = brandWindow();
  deliver(win, brand(456, '  Alpha Brand  '));
  assert.equal(win.resolveNetworkCompany('456'), 'Alpha Brand');
});

test('language precedence per conversation', () => {
  const cases = [
    ['conflict', [['summary', 'German'], ['stream', 'French']], null],
    ['equal', [['summary', 'German'], ['stream', 'German']], 'german'],
    ['summary only', [['summary', 'German']], 'german'],
    ['stream only', [['stream', 'French']], 'french']
  ];
  for (const [label, posts, expected] of cases) {
    const win = plainWindow();
    posts.forEach(([source, value]) => deliver(win, language(456, value, source)));
    assert.equal(win.resolveNetworkLanguage('456'), expected, label);
  }
});

test('list identities: re-posting identical identities changes nothing', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW)]);
  const entries = [{ conversationId: '1', contactId: CONTACT_A }, { conversationId: '2', contactId: CONTACT_A }];
  deliver(win, listIdentities(entries));
  assert.equal(chipText(win, '1'), '⧉2');
  deliver(win, listIdentities(entries));
  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '2'), '⧉2');
});

test('list identities: a changed contactId updates the grouping', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW)]);
  deliver(win, listIdentities([{ conversationId: '1', contactId: CONTACT_A }, { conversationId: '2', contactId: CONTACT_A }]));
  assert.equal(chipText(win, '1'), '⧉2');
  deliver(win, listIdentities([{ conversationId: '2', contactId: CONTACT_B }]));
  assert.equal(chipText(win, '1'), null);
  assert.equal(chipText(win, '2'), null);
});

test('list identities: a changed email updates the stored identity', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW)]);
  const entry = (email) => [{ conversationId: '1', contactId: CONTACT_A, email }, { conversationId: '2', contactId: CONTACT_B, email: 'two@example.com' }];
  deliver(win, listIdentities(entry('one@example.com')));
  const before = JSON.stringify(win.listIdentitiesForCurrentInbox().get ? [...win.listIdentitiesForCurrentInbox().entries()] : win.listIdentitiesForCurrentInbox());
  deliver(win, listIdentities(entry('changed@example.com')));
  const after = JSON.stringify(win.listIdentitiesForCurrentInbox().get ? [...win.listIdentitiesForCurrentInbox().entries()] : win.listIdentitiesForCurrentInbox());
  assert.notEqual(after, before);
  assert.match(after, /changed@example\.com/);
});

test('list identities: per inbox 1000 conversations are remembered, the oldest 200 are forgotten', () => {
  const win = build([row('1', TAMSIN)]);
  for (let batch = 0; batch < 6; batch += 1) {
    const ids = range(batch * 200 + 1, batch * 200 + 200);
    deliver(win, listIdentities(ids.map((id) => ({ conversationId: String(id), contactId: hex24(id) }))));
  }
  const known = win.listIdentitiesForCurrentInbox();
  assert.equal(hasKey(known, '1'), false);
  assert.equal(hasKey(known, '200'), false);
  assert.equal(hasKey(known, '201'), true);
  assert.equal(hasKey(known, '1200'), true);
});

const stillPrevious = (win) => win.listRowsStillShowThePreviousState();

test('rows still show previous state after a state change, until the rows change', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  deliver(win, listState(TEAM, 'open'));
  assert.equal(stillPrevious(win), false, 'first state does not set it');
  deliver(win, listState(TEAM, 'closed'));
  assert.equal(stillPrevious(win), true);
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.insertAdjacentHTML('beforeend', row('3', TAMSIN));
  win.refreshDuplicateCustomerHighlights();
  assert.equal(stillPrevious(win), false);
});

test('rows still show previous state: a removed row also clears it', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  deliver(win, listState(TEAM, 'open'));
  deliver(win, listState(TEAM, 'closed'));
  assert.equal(stillPrevious(win), true);
  win.document.querySelector('a[data-conversation-id="2"]').remove();
  win.refreshDuplicateCustomerHighlights();
  assert.equal(stillPrevious(win), false);
});

test('rows still show previous state: a different inbox does not set it', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  deliver(win, listState('9009870', 'open'));
  deliver(win, listState('9009870', 'closed'));
  assert.equal(stillPrevious(win), false);
});
