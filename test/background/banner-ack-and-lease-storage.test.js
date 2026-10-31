'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, INTERCOM_TAB } = require('../support/background-harness');

const LEASE_KEY = 'isaNoteLeases';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function sessionStorageReturning(state, stored, lastError) {
  return {
    get(_keys, callback) {
      state.chrome.runtime.lastError = lastError || null;
      callback({ [LEASE_KEY]: stored });
      state.chrome.runtime.lastError = null;
    },
    set(_values, callback) {
      state.chrome.runtime.lastError = lastError || null;
      if (typeof callback === 'function') callback();
      state.chrome.runtime.lastError = null;
    }
  };
}

test('B4 noteLeaseStorage is null when session storage lacks get', () => {
  const state = loadBackground({ storageSessionSeed: {} });
  state.chrome.storage.session = { set() {} };
  assert.equal(state.win.noteLeaseStorage(), null);
});

test('B4 noteLeaseStorage is null when session storage lacks set', () => {
  const state = loadBackground({ storageSessionSeed: {} });
  state.chrome.storage.session = { get() {} };
  assert.equal(state.win.noteLeaseStorage(), null);
});

test('B5 a get lastError rejects with its message', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const storage = sessionStorageReturning(state, {}, { message: 'quota' });
  await assert.rejects(state.win.noteLeaseStorageGet(storage), error => error.message === 'quota');
});

test('B5 a get lastError without a message rejects with storage-get-failed', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const storage = sessionStorageReturning(state, {}, {});
  await assert.rejects(state.win.noteLeaseStorageGet(storage), error => error.message === 'storage-get-failed');
});

test('B5 an array under the lease key rejects with storage-invalid', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const storage = sessionStorageReturning(state, []);
  await assert.rejects(state.win.noteLeaseStorageGet(storage), error => error.message === 'storage-invalid');
});

test('B5 a string under the lease key rejects with storage-invalid', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const storage = sessionStorageReturning(state, 'leases');
  await assert.rejects(state.win.noteLeaseStorageGet(storage), error => error.message === 'storage-invalid');
});

test('B5 a set lastError rejects with its message', async () => {
  const state = loadBackground({ storageSessionSeed: {} });
  const storage = sessionStorageReturning(state, {}, { message: 'quota' });
  await assert.rejects(state.win.noteLeaseStorageSet(storage, {}), error => error.message === 'quota');
});
