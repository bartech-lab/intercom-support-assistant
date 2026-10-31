'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('../support/background-harness');

const NOTE_LEASE_WORKSPACE = 'demo1234';
const NOTE_LEASE_CONTACT = 'contact-123';
const NOTE_LEASE_NOTE = 'note-456';

function noteLeaseSender(tabId = 17, workspace = NOTE_LEASE_WORKSPACE, urlPrefix = 'inbox') {
  return {
    origin: 'https://app.intercom.com',
    tab: { id: tabId, url: `https://app.intercom.com/a/${urlPrefix}/${workspace}/inbox/conversation/1` }
  };
}

function noteLeaseMessage(type, overrides = {}) {
  return Object.assign({
    type,
    workspaceId: NOTE_LEASE_WORKSPACE,
    contactId: NOTE_LEASE_CONTACT,
    noteId: NOTE_LEASE_NOTE
  }, overrides);
}

function requestNoteLease(state, message, sender) {
  return new Promise((resolve) => {
    const kept = state.listeners.message(message, sender, resolve);
    assert.equal(kept, true, 'lease messages keep the response channel open');
  });
}

test('note lease acquisition serializes concurrent tabs and returns a sixty-second owner lease', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const now = state.win.Date.now();
  state.win.Date.now = () => now;
  const [first, second] = await Promise.all([
    requestNoteLease(state, noteLeaseMessage('isa-note-lease-acquire'), noteLeaseSender(17)),
    requestNoteLease(state, noteLeaseMessage('isa-note-lease-acquire'), noteLeaseSender(18))
  ]);

  const acquired = first;
  const held = second;
  assert.equal(acquired.ok, true);
  assert.equal(acquired.lease.ownerTabId, 17);
  assert.match(acquired.lease.ownerToken, /^[0-9a-f-]{36}$/i);
  assert.equal(acquired.lease.expiresAt, now + 60000);
  assert.equal(held.ok, false);
  assert.equal(held.reason, 'lease-held');
  assert.equal(held.expiresAt, acquired.lease.expiresAt);
});

test('note lease release requires both the owning tab and owner token', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const acquired = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(17)
  );
  const wrongTab = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-release', { ownerToken: acquired.lease.ownerToken }),
    noteLeaseSender(18)
  );
  const wrongToken = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-release', { ownerToken: '00000000-0000-4000-8000-900045045695' }),
    noteLeaseSender(17)
  );
  const released = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-release', { ownerToken: acquired.lease.ownerToken }),
    noteLeaseSender(17)
  );

  assert.equal(wrongTab.ok, false);
  assert.equal(wrongTab.reason, 'not-owner');
  assert.equal(wrongToken.ok, false);
  assert.equal(wrongToken.reason, 'not-owner');
  assert.equal(released.ok, true);
  assert.equal(released.released, true);
  const reacquired = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(18)
  );
  assert.equal(reacquired.ok, true);
  assert.equal(reacquired.lease.ownerTabId, 18);
});

test('an expired note lease can be acquired after its sixty-second lifetime', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const acquired = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(17)
  );
  const realNow = state.win.Date.now;
  state.win.Date.now = () => acquired.lease.expiresAt;
  try {
    const replacement = await requestNoteLease(
      state,
      noteLeaseMessage('isa-note-lease-acquire'),
      noteLeaseSender(18)
    );
    assert.equal(replacement.ok, true);
    assert.equal(replacement.lease.ownerTabId, 18);
  } finally {
    state.win.Date.now = realNow;
  }
});

test('note leases reject invalid identifiers and unauthenticated or mismatched Intercom senders', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const cases = [
    [noteLeaseMessage('isa-note-lease-acquire', { noteId: '../other-note' }), noteLeaseSender(17), 'invalid-request'],
    [noteLeaseMessage('isa-note-lease-acquire'), { tab: { id: 17, url: 'https://example.com/a/inbox/demo1234/conversation/1' } }, 'invalid-sender'],
    [noteLeaseMessage('isa-note-lease-acquire'), noteLeaseSender(17, 'other-workspace'), 'invalid-sender'],
    [noteLeaseMessage('isa-note-lease-acquire'), Object.assign(noteLeaseSender(17), { origin: 'https://evil.example' }), 'invalid-sender'],
    [noteLeaseMessage('isa-note-lease-acquire'), { origin: 'https://app.intercom.com', tab: { id: 17, url: 'https://evil.example.com/a/inbox/demo1234/inbox/conversation/1' } }, 'invalid-sender'],
    [noteLeaseMessage('isa-note-lease-acquire'), { origin: 'https://app.intercom.com', tab: { id: 17, url: 'http://app.intercom.com/a/inbox/demo1234/inbox/conversation/1' } }, 'invalid-sender'],
    [noteLeaseMessage('isa-note-lease-release', { ownerToken: 'not-a-uuid' }), noteLeaseSender(17), 'invalid-request']
  ];
  for (const [message, sender, reason] of cases) {
    const response = await requestNoteLease(state, message, sender);
    assert.equal(response.ok, false);
    assert.equal(response.reason, reason);
  }
});

test('note lease records survive a worker restart through session storage', async () => {
  const first = loadBackground({ storageSessionSeed: {} });
  const acquired = await requestNoteLease(
    first,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(17)
  );
  const restarted = loadBackground({ storageSessionSeed: first.sessionStorageState });
  const response = await requestNoteLease(
    restarted,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(18)
  );
  assert.equal(response.ok, false);
  assert.equal(response.reason, 'lease-held');
  assert.equal(response.expiresAt, acquired.lease.expiresAt);
});

test('note lease operations fail closed when session storage is unavailable or errors', async () => {
  const unavailable = loadBackground();
  const unavailableResponse = await requestNoteLease(
    unavailable,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(17)
  );
  const failedGet = loadBackground({ storageSessionSeed: {}, sessionGetError: { message: 'denied' } });
  const failedResponse = await requestNoteLease(
    failedGet,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(17)
  );
  const failedSet = loadBackground({ storageSessionSeed: {}, sessionSetError: { message: 'quota' } });
  const setResponse = await requestNoteLease(
    failedSet,
    noteLeaseMessage('isa-note-lease-acquire'),
    noteLeaseSender(17)
  );
  assert.equal(unavailableResponse.ok, false);
  assert.equal(unavailableResponse.reason, 'storage-unavailable');
  assert.equal(failedResponse.ok, false);
  assert.equal(failedResponse.reason, 'storage-failed');
  assert.equal(setResponse.ok, false);
  assert.equal(setResponse.reason, 'storage-failed');
});
