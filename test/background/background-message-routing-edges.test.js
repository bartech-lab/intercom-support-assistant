'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, settle } = require('../support/background-harness');

const WS = 'demo1234';
const LEASE_KEY = 'isaNoteLeases';
const OWNER_TOKEN = '00000000-0000-4000-8000-900045045597';
const OTHER_TOKEN = '00000000-0000-4000-8000-900045045598';

function sender(tabId = 17) {
  return {
    origin: 'https://app.intercom.com',
    tab: { id: tabId, url: `https://app.intercom.com/a/inbox/${WS}/inbox/conversation/1` }
  };
}

function record(noteId, overrides = {}) {
  return {
    workspaceId: WS,
    contactId: 'contact-123',
    noteId,
    ownerTabId: 17,
    ownerToken: OWNER_TOKEN,
    expiresAt: Date.now() + 3600000,
    ...overrides
  };
}

function key(noteId) {
  return `${WS}/contact-123/${noteId}`;
}

function release(noteId, ownerToken = OWNER_TOKEN) {
  return { type: 'isa-note-lease-release', workspaceId: WS, contactId: 'contact-123', noteId, ownerToken };
}

function request(state, message, from) {
  return new Promise((resolve) => {
    const kept = state.listeners.message(message, from, resolve);
    assert.equal(kept, true);
  });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function countWrites(state, failure) {
  const writes = [];
  const session = state.chrome.storage.session;
  session.set = (values, callback) => {
    writes.push(plain(values));
    state.chrome.runtime.lastError = failure || null;
    if (typeof callback === 'function') callback();
    state.chrome.runtime.lastError = null;
  };
  return writes;
}

function seeded(leases) {
  return loadBackground({ storageSessionSeed: { [LEASE_KEY]: leases } });
}

test('C1 release with a failing storage read responds storage-failed', async () => {
  const state = loadBackground({
    storageSessionSeed: { [LEASE_KEY]: { [key('note-1')]: record('note-1') } },
    sessionGetError: { message: 'read denied' }
  });
  const response = await request(state, release('note-1'), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'storage-failed' });
});

test('C1 release with a throwing storage read responds storage-failed', async () => {
  const state = seeded({ [key('note-1')]: record('note-1') });
  state.chrome.storage.session.get = () => { throw new Error('boom'); };
  const response = await request(state, release('note-1'), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'storage-failed' });
});

for (const [label, from, token] of [
  ['wrong tab', 18, OWNER_TOKEN],
  ['wrong token', 17, OTHER_TOKEN]
]) {
  test(`C2 non-owner release (${label}) prunes the expired lease with one write`, async () => {
    const live = record('note-1');
    const state = seeded({ [key('note-1')]: live, [key('old')]: record('old', { expiresAt: Date.now() - 1000 }) });
    const writes = countWrites(state);
    const response = await request(state, release('note-1', token), sender(from));
    assert.deepEqual(plain(response), { ok: false, reason: 'not-owner' });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], { [LEASE_KEY]: { [key('note-1')]: plain(live) } });
  });
}

test('C2 non-owner release with no lease held for the key prunes the expired lease', async () => {
  const live = record('live');
  const state = seeded({ [key('live')]: live, [key('old')]: record('old', { expiresAt: Date.now() - 1000 }) });
  const writes = countWrites(state);
  const response = await request(state, release('missing'), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'not-owner' });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { [LEASE_KEY]: { [key('live')]: plain(live) } });
});

test('C2 pruning drops every expired lease, not only the first', async () => {
  const live = record('live');
  const state = seeded({
    [key('old1')]: record('old1', { expiresAt: Date.now() - 1000 }),
    [key('live')]: live,
    [key('old2')]: record('old2', { expiresAt: Date.now() - 5000 })
  });
  const writes = countWrites(state);
  const response = await request(state, release('live', OTHER_TOKEN), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'not-owner' });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { [LEASE_KEY]: { [key('live')]: plain(live) } });
});

test('C3 non-owner release with nothing expired writes nothing and ignores a failing write', async () => {
  const state = loadBackground({
    storageSessionSeed: { [LEASE_KEY]: { [key('note-1')]: record('note-1'), [key('n2')]: record('n2', { ownerTabId: 20 }) } },
    sessionSetError: { message: 'quota' }
  });
  const writes = countWrites(state, { message: 'quota' });
  const response = await request(state, release('note-1', OTHER_TOKEN), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'not-owner' });
  assert.equal(writes.length, 0);
});

test('C3 non-owner release on empty storage writes nothing', async () => {
  const state = seeded({});
  const writes = countWrites(state, { message: 'quota' });
  const response = await request(state, release('note-1'), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'not-owner' });
  assert.equal(writes.length, 0);
});

test('C4 non-owner prune with a failing write responds storage-failed', async () => {
  const state = seeded({ [key('note-1')]: record('note-1'), [key('old')]: record('old', { expiresAt: Date.now() - 1000 }) });
  const writes = countWrites(state, { message: 'quota' });
  const response = await request(state, release('note-1', OTHER_TOKEN), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'storage-failed' });
  assert.equal(writes.length, 1);
});

test('C4 non-owner prune with a throwing write responds storage-failed', async () => {
  const state = seeded({ [key('note-1')]: record('note-1'), [key('old')]: record('old', { expiresAt: Date.now() - 1000 }) });
  state.chrome.storage.session.set = () => { throw new Error('boom'); };
  const response = await request(state, release('note-1', OTHER_TOKEN), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'storage-failed' });
});

test('C5 owner release with a failing write responds storage-failed and keeps the lease', async () => {
  const state = loadBackground({
    storageSessionSeed: { [LEASE_KEY]: { [key('note-1')]: record('note-1') } },
    sessionSetError: { message: 'quota' }
  });
  const response = await request(state, release('note-1'), sender(17));
  assert.deepEqual(plain(response), { ok: false, reason: 'storage-failed' });
  assert.deepEqual(Object.keys(state.sessionStorageState[LEASE_KEY]), [key('note-1')]);
});

test('C5 owner release with a successful write responds released and removes only that lease', async () => {
  const other = record('n2', { ownerTabId: 20 });
  const state = seeded({ [key('note-1')]: record('note-1'), [key('n2')]: other });
  const response = await request(state, release('note-1'), sender(17));
  assert.deepEqual(plain(response), { ok: true, released: true });
  assert.deepEqual(state.sessionStorageState[LEASE_KEY], { [key('n2')]: plain(other) });
});

const ACK_CASES = [
  ['open-preview', { type: 'open-preview', section: 'notes' }, { tab: { id: 5, windowId: 3 } }],
  ['inbox-alert', { type: 'inbox-alert', teamId: '900101', label: 'Team', count: 2 }, { tab: { id: 5, windowId: 3 } }]
];

for (const [name, message, from] of ACK_CASES) {
  test(`C6 ${name} acknowledges once with { ok: true } and returns undefined`, async () => {
    const state = loadBackground();
    const responses = [];
    const returned = state.listeners.message(message, from, value => responses.push(plain(value)));
    await settle();
    assert.equal(returned, undefined);
    assert.deepEqual(responses, [{ ok: true }]);
  });
}

const ASYNC_CASES = [
  ['capture-tabs', { type: 'capture-tabs' }, {}],
  ['dom-capture', { type: 'dom-capture', tabId: 4 }, {}]
];

for (const [name, message, from] of ASYNC_CASES) {
  test(`C7 ${name} keeps the response channel open`, async () => {
    const state = loadBackground({ storageSessionSeed: {}, storageSeed: {} });
    const returned = state.listeners.message(message, from, () => {});
    assert.equal(returned, true);
    await settle();
  });
}

for (const [label, message] of [['unknown type', { type: 'no-such-type' }], ['null message', null]]) {
  test(`C9 ${label} is ignored without a response`, async () => {
    const state = loadBackground({ storageSessionSeed: {} });
    let calls = 0;
    let returned = 'unset';
    assert.doesNotThrow(() => {
      returned = state.listeners.message(message, sender(17), () => { calls += 1; });
    });
    await settle();
    assert.equal(returned, undefined);
    assert.equal(calls, 0);
  });
}

test('C10 an unknown notification id clears itself and focuses nothing', () => {
  const state = loadBackground();
  assert.doesNotThrow(() => state.listeners.notificationClicked('isa-unknown'));
  assert.equal(state.tabUpdates.length, 0);
  assert.equal(state.windowUpdates.length, 0);
  assert.deepEqual(Array.from(state.notificationsCleared), ['isa-unknown']);
});

test('C10 an id with a tab and no window focuses the tab and never a window', () => {
  const state = loadBackground();
  state.listeners.notificationClicked('isa-inbox-900101-123-t42-w');
  assert.equal(state.tabUpdates.length, 1);
  assert.deepEqual(plain(state.tabUpdates[0]), { tabId: 42, props: { active: true } });
  assert.equal(state.windowUpdates.length, 0);
  assert.deepEqual(Array.from(state.notificationsCleared), ['isa-inbox-900101-123-t42-w']);
});

test('C10 an id with tab 42 and window 7 focuses window 7 after the tab callback', () => {
  const state = loadBackground();
  const order = [];
  const realUpdate = state.chrome.tabs.update;
  state.chrome.tabs.update = (tabId, props, callback) => {
    order.push('tab');
    realUpdate(tabId, props, callback);
  };
  const realWindow = state.chrome.windows.update;
  state.chrome.windows.update = (windowId, props, callback) => {
    order.push('window');
    realWindow(windowId, props, callback);
  };
  state.listeners.notificationClicked('isa-inbox-900101-123-t42-w7');
  assert.deepEqual(order, ['tab', 'window']);
  assert.deepEqual(plain(state.windowUpdates), [{ windowId: 7, props: { focused: true } }]);
  assert.deepEqual(plain(state.tabUpdates), [{ tabId: 42, props: { active: true } }]);
});
