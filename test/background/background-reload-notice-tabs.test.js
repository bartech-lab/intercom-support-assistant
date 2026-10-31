'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('../support/background-harness');

const INTERCOM_URL = 'https://app.intercom.com/a/inbox';
const SECOND_URL = 'https://app.intercom.com/a/inbox/demo/inbox/shared/all';
const WINDOW_MS = 30000;

function platforms(state) {
  return state.executeCalls.map(call => Array.from(call.args));
}

function installWith(tabs, reason = 'install') {
  const state = loadBackground();
  const clock = { now: state.win.Date.now() };
  state.win.Date.now = () => clock.now;
  state.chrome.tabs.query = (_query, callback) => callback(tabs);
  state.listeners.installed({ reason });
  return { state, clock };
}

function complete(state, tabId, url) {
  state.listeners.updated(tabId, { status: 'complete' }, { id: tabId, url, status: 'complete' });
}

test('install injects now for a complete tab and leaves a loading tab pending', () => {
  const { state } = installWith([
    { id: 1, status: 'loading', url: INTERCOM_URL },
    { id: 2, status: 'complete', url: SECOND_URL }
  ]);

  assert.deepEqual(platforms(state), [['Intercom']]);
  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), [['Intercom'], ['Intercom']]);
});

test('other install reasons do nothing', () => {
  const { state } = installWith([{ id: 1, status: 'loading', url: INTERCOM_URL }], 'chrome_update');

  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), []);
});

test('unsupported hosts are neither injected nor made pending', () => {
  const { state } = installWith([
    { id: 1, status: 'complete', url: 'https://example.com/' },
    { id: 2, status: 'loading', url: 'https://app.intercom.com.evil.test/' }
  ]);

  complete(state, 2, SECOND_URL);
  assert.deepEqual(platforms(state), []);
});

test('update reason also opens the window', () => {
  const { state } = installWith([{ id: 1, status: 'loading', url: INTERCOM_URL }], 'update');

  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), [['Intercom']]);
});

test('a loading event then a complete event injects once, for the second pending tab', () => {
  const { state } = installWith([
    { id: 1, status: 'loading', url: INTERCOM_URL },
    { id: 2, status: 'loading', url: SECOND_URL }
  ]);

  state.listeners.updated(2, { status: 'loading' }, { id: 2, url: SECOND_URL });
  assert.deepEqual(platforms(state), []);
  complete(state, 2, SECOND_URL);
  assert.deepEqual(platforms(state), [['Intercom']]);
  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), [['Intercom'], ['Intercom']]);
});

test('a pending tab now on an unsupported URL injects nothing', () => {
  const { state } = installWith([{ id: 1, status: 'loading', url: INTERCOM_URL }]);

  complete(state, 1, 'https://example.com/');
  assert.deepEqual(platforms(state), []);
});

test('a tab that was never pending injects nothing', () => {
  const { state } = installWith([{ id: 1, status: 'loading', url: INTERCOM_URL }]);

  complete(state, 7, INTERCOM_URL);
  assert.deepEqual(platforms(state), []);
});

test('a second complete event does not inject again', () => {
  const { state } = installWith([{ id: 1, status: 'loading', url: INTERCOM_URL }]);

  complete(state, 1, INTERCOM_URL);
  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), [['Intercom']]);
});

test('exactly 30 seconds after install still injects', () => {
  const { state, clock } = installWith([{ id: 1, status: 'loading', url: INTERCOM_URL }]);

  clock.now += WINDOW_MS;
  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), [['Intercom']]);
});

test('just over 30 seconds after install injects nothing', () => {
  const { state, clock } = installWith([{ id: 1, status: 'loading', url: INTERCOM_URL }]);

  clock.now += WINDOW_MS + 1;
  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), []);
});

test('a removed tab is dropped from pending', () => {
  const { state } = installWith([
    { id: 1, status: 'loading', url: INTERCOM_URL },
    { id: 2, status: 'loading', url: INTERCOM_URL }
  ]);

  state.listeners.removed(1);
  complete(state, 1, INTERCOM_URL);
  assert.deepEqual(platforms(state), []);
  complete(state, 2, INTERCOM_URL);
  assert.deepEqual(platforms(state), [['Intercom']]);
});

test('a failed injection retries once after one second and then stops', () => {
  const state = loadBackground();
  state.chrome.tabs.query = (_query, callback) => callback([
    { id: 1, status: 'complete', url: INTERCOM_URL }
  ]);
  const pending = [];
  const realSet = state.win.setTimeout;
  state.win.setTimeout = (fn, ms, ...rest) => {
    if (ms === 1000) {
      pending.push(fn);
      return pending.length;
    }
    return realSet.call(state.win, fn, ms, ...rest);
  };
  state.chrome.scripting.executeScript = (details, callback) => {
    state.executeCalls.push(details);
    state.chrome.runtime.lastError = { message: 'no host permission' };
    callback(undefined);
    state.chrome.runtime.lastError = null;
  };

  state.listeners.installed({ reason: 'install' });
  assert.equal(state.executeCalls.length, 1);
  assert.equal(pending.length, 1, 'one retry is scheduled 1000 ms out');

  pending.shift()();
  assert.equal(state.executeCalls.length, 2);
  assert.deepEqual(platforms(state), [['Intercom'], ['Intercom']]);
  assert.equal(pending.length, 0, 'the retry does not schedule another');
});
