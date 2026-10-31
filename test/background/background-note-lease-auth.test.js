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

function assertRejected(response, reason, message) {
  assert.equal(response.ok, false, message);
  assert.equal(response.reason, reason, message);
}

function senderWithUrl(url) {
  return { origin: 'https://app.intercom.com', tab: { id: 17, url } };
}

const TYPES = ['isa-note-lease-acquire', 'isa-note-lease-release'];
const FIELDS = ['workspaceId', 'contactId', 'noteId'];

for (const type of TYPES) {
  for (const field of FIELDS) {
    test(`${type} rejects a missing ${field} as invalid-request`, async () => {
      const state = loadBackground({ storageSessionSeed: {} });
      const message = noteLeaseMessage(type);
      delete message[field];
      const response = await requestNoteLease(state, message, noteLeaseSender(17));
      assertRejected(response, 'invalid-request');
    });

    test(`${type} rejects a numeric ${field} as invalid-request`, async () => {
      const state = loadBackground({ storageSessionSeed: {} });
      const message = noteLeaseMessage(type, { [field]: 12345 });
      const response = await requestNoteLease(state, message, noteLeaseSender(17));
      assertRejected(response, 'invalid-request');
    });
  }
}

for (const field of FIELDS) {
  const badValues = ['', '-abc', '.abc', 'ab/cd', 'ab cd', 'a'.repeat(129)];
  test(`${field} rejects empty, bad-leading, bad-character and 129-character values`, async () => {
    const state = loadBackground({ storageSessionSeed: {} });
    for (const value of badValues) {
      const response = await requestNoteLease(
        state,
        noteLeaseMessage('isa-note-lease-acquire', { [field]: value }),
        noteLeaseSender(17)
      );
      assertRejected(response, 'invalid-request', `value of length ${value.length}: ${JSON.stringify(value)}`);
    }
  });

  test(`${field} of exactly 128 valid characters passes the identifier check`, async () => {
    const state = loadBackground({ storageSessionSeed: {} });
    const value = ('a' + 'b.C_d:e-1'.repeat(15)).slice(0, 128);
    assert.equal(value.length, 128);
    const overrides = { [field]: value };
    const sender = field === 'workspaceId' ? noteLeaseSender(17, value) : noteLeaseSender(17);
    const response = await requestNoteLease(state, noteLeaseMessage('isa-note-lease-acquire', overrides), sender);
    assert.equal(response.ok, true);
  });
}

test('identifiers may start with a digit and contain dots, underscores, colons and hyphens', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const response = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-acquire', { contactId: '9a.b_c:d-e', noteId: '0' }),
    noteLeaseSender(17)
  );
  assert.equal(response.ok, true);
});

test('a sender without a tab is invalid-sender', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const response = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-acquire'),
    { origin: 'https://app.intercom.com' }
  );
  assertRejected(response, 'invalid-sender');
});

for (const badId of ['17', 1.5, -1, undefined, null]) {
  test(`tab id ${String(badId)} is invalid-sender`, async () => {
    const state = loadBackground({ storageSessionSeed: {} });
    const sender = noteLeaseSender(17);
    sender.tab.id = badId;
    const response = await requestNoteLease(state, noteLeaseMessage('isa-note-lease-acquire'), sender);
    assertRejected(response, 'invalid-sender');
  });
}

test('tab id 0 is accepted', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const response = await requestNoteLease(state, noteLeaseMessage('isa-note-lease-acquire'), noteLeaseSender(0));
  assert.equal(response.ok, true);
  assert.equal(response.lease.ownerTabId, 0);
});

test('tab url that is missing, not a string or unparseable is invalid-sender', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const urls = [undefined, null, 42, {}, 'not a url', ''];
  for (const url of urls) {
    const response = await requestNoteLease(
      state,
      noteLeaseMessage('isa-note-lease-acquire'),
      { origin: 'https://app.intercom.com', tab: { id: 17, url } }
    );
    assertRejected(response, 'invalid-sender', `url ${JSON.stringify(url)}`);
  }
});

test('a missing sender origin is invalid-sender', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const sender = noteLeaseSender(17);
  delete sender.origin;
  const response = await requestNoteLease(state, noteLeaseMessage('isa-note-lease-acquire'), sender);
  assertRejected(response, 'invalid-sender');
});

test('the apps section of the Intercom path is accepted', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const response = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-acquire'),
    senderWithUrl(`https://app.intercom.com/a/apps/${NOTE_LEASE_WORKSPACE}/x`)
  );
  assert.equal(response.ok, true);
});

test('Intercom paths with the wrong shape or workspace are invalid-sender', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const w = NOTE_LEASE_WORKSPACE;
  const paths = [
    `/b/inbox/${w}/x`,
    `/a/settings/${w}/x`,
    '/a/inbox',
    `/a/inbox/other/x`,
    `/x/a/inbox/${w}`,
    `/a/inbox/${w}extra/x`,
    `/a/inbox/x${w}/x`,
    `/a/inbox/${w.toUpperCase()}/x`
  ];
  for (const path of paths) {
    const response = await requestNoteLease(
      state,
      noteLeaseMessage('isa-note-lease-acquire'),
      senderWithUrl(`https://app.intercom.com${path}`)
    );
    assertRejected(response, 'invalid-sender', path);
  }
});

test('a path with exactly three parts is accepted and empty parts are dropped', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const response = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-acquire'),
    senderWithUrl(`https://app.intercom.com//a//inbox//${NOTE_LEASE_WORKSPACE}`)
  );
  assert.equal(response.ok, true);
});

test('an invalid identifier wins over an invalid sender', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const response = await requestNoteLease(
    state,
    noteLeaseMessage('isa-note-lease-release', { contactId: 'bad id' }),
    {}
  );
  assertRejected(response, 'invalid-request');
});
