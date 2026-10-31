'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('../support/background-harness');

const WS = 'demo1234';
const LEASE_KEY = 'isaNoteLeases';

function sender(tabId = 17) {
  return {
    origin: 'https://app.intercom.com',
    tab: { id: tabId, url: `https://app.intercom.com/a/inbox/${WS}/inbox/conversation/1` }
  };
}

function msg(type, overrides = {}) {
  return { type, workspaceId: WS, contactId: 'contact-123', noteId: 'note-456', ...overrides };
}

function request(state, message, from) {
  return new Promise((resolve) => {
    assert.equal(state.listeners.message(message, from, resolve), true);
  });
}

function spyOnSessionSet(state, failWith = null) {
  const calls = [];
  const original = state.chrome.storage.session.set;
  state.chrome.storage.session.set = (values, callback) => {
    calls.push(values);
    if (failWith) {
      state.chrome.runtime.lastError = { message: failWith };
      if (typeof callback === 'function') callback();
      state.chrome.runtime.lastError = null;
      return;
    }
    original(values, callback);
  };
  return calls;
}

function setNow(state, value) {
  state.win.Date.now = () => value;
}

async function seedExpiredAndHeld(state) {
  const t0 = 1_800_000_000_000;
  setNow(state, t0);
  const a = await request(state, msg('isa-note-lease-acquire', { noteId: 'note-A' }), sender(17));
  setNow(state, t0 + 30000);
  const b = await request(state, msg('isa-note-lease-acquire', { noteId: 'note-B' }), sender(18));
  setNow(state, t0 + 70000);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(Object.keys(state.sessionStorageState[LEASE_KEY]).length, 2);
  return { a, b };
}

test('acquire replies token-unavailable and writes nothing when the UUID source returns nothing', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  Object.defineProperty(state.win.crypto, 'randomUUID', { configurable: true, value: () => undefined });
  const sets = spyOnSessionSet(state);
  const response = await request(state, msg('isa-note-lease-acquire'), sender(17));
  assert.deepEqual({ ...response }, { ok: false, reason: 'token-unavailable' });
  assert.equal(sets.length, 0);

  const control = loadBackground({ storageSessionSeed: {} });
  const ok = await request(control, msg('isa-note-lease-acquire'), sender(17));
  assert.equal(ok.ok, true);
});

test('a failed acquire still persists removal of an expired lease on another key', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const { b } = await seedExpiredAndHeld(state);
  const response = await request(state, msg('isa-note-lease-acquire', { noteId: 'note-B' }), sender(19));
  assert.deepEqual({ ...response }, { ok: false, reason: 'lease-held', expiresAt: b.lease.expiresAt });
  const remaining = Object.values(state.sessionStorageState[LEASE_KEY]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].ownerToken, b.lease.ownerToken);
});

test('a throwing cleanup write during a lease-held acquire replies storage-failed', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  await seedExpiredAndHeld(state);
  const sets = spyOnSessionSet(state, 'quota');
  const response = await request(state, msg('isa-note-lease-acquire', { noteId: 'note-B' }), sender(19));
  assert.deepEqual({ ...response }, { ok: false, reason: 'storage-failed' });
  assert.equal(sets.length, 1);
});

test('a lease-held acquire with nothing expired does not write storage', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const first = await request(state, msg('isa-note-lease-acquire'), sender(17));
  const sets = spyOnSessionSet(state);
  const response = await request(state, msg('isa-note-lease-acquire'), sender(18));
  assert.deepEqual({ ...response }, { ok: false, reason: 'lease-held', expiresAt: first.lease.expiresAt });
  assert.equal(sets.length, 0);
});

test('release rejects a non-UUID-v1-to-v5 owner token as invalid-request and keeps the lease', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const acquired = await request(state, msg('isa-note-lease-acquire'), sender(17));
  const bad = [
    ['undefined', undefined], ['null', null], ['number', 12345], ['object', {}], ['empty', ''],
    ['version 6', '00000000-0000-6000-8000-900045045597'],
    ['version 0', '00000000-0000-0000-8000-900045045597'],
    ['variant c', '00000000-0000-4000-c000-900045045597'],
    ['variant 7', '00000000-0000-4000-7000-900045045597'],
    ['non-hex', '00000000-0000-4000-8000-00000000000g'],
    ['too long', '00000000-0000-4000-8000-9001818745568'],
    ['no dashes', '90098146023511721873180937370065']
  ];
  for (const [label, ownerToken] of bad) {
    const response = await request(state, msg('isa-note-lease-release', { ownerToken }), sender(17));
    assert.deepEqual({ ...response }, { ok: false, reason: 'invalid-request' }, label);
  }
  assert.equal(Object.keys(state.sessionStorageState[LEASE_KEY]).length, 1);
  const still = await request(state, msg('isa-note-lease-acquire'), sender(18));
  assert.equal(still.reason, 'lease-held');
  assert.equal(still.expiresAt, acquired.lease.expiresAt);
});

test('release accepts v1 and v5 tokens, any case, with variants 8 9 a b as a well-formed token', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  await request(state, msg('isa-note-lease-acquire'), sender(17));
  const good = [
    '00000000-0000-1000-8000-900045045597',
    '00000000-0000-5000-9000-900045045597',
    'ABCDEF00-0000-4000-A000-0000000000AB',
    'abcdef00-0000-3000-b000-0000000000ab'
  ];
  for (const ownerToken of good) {
    const response = await request(state, msg('isa-note-lease-release', { ownerToken }), sender(17));
    assert.deepEqual({ ...response }, { ok: false, reason: 'not-owner' }, ownerToken);
  }
});

test('release replies storage-unavailable when extension storage is unavailable', async () => {
  const state = loadBackground();
  const response = await request(state, msg('isa-note-lease-release', {
    ownerToken: '00000000-0000-4000-8000-900045045597'
  }), sender(17));
  assert.deepEqual({ ...response }, { ok: false, reason: 'storage-unavailable' });
});

test('release with an array holding the valid owner token is invalid-request and keeps the lease', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const acquired = await request(state, msg('isa-note-lease-acquire'), sender(17));
  const token = acquired.lease.ownerToken;
  assert.match(String([token]), /^[0-9a-f-]{36}$/i);
  const response = await request(state, msg('isa-note-lease-release', { ownerToken: [token] }), sender(17));
  assert.deepEqual({ ...response }, { ok: false, reason: 'invalid-request' });
  assert.equal(Object.keys(state.sessionStorageState[LEASE_KEY]).length, 1);
  const released = await request(state, msg('isa-note-lease-release', { ownerToken: token }), sender(17));
  assert.equal(released.ok, true);
});
