'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('../support/background-harness');

function askSupportHealth(state) {
  return new Promise((resolve) => {
    const returned = state.listeners.message({ type: 'support-health' }, {}, resolve);
    assert.equal(returned, true, 'support-health must keep the message channel open');
  });
}

function tabRows(response) {
  return Array.from(response.health.tabs);
}

const TAB = { id: 7, url: 'https://app.intercom.com/a/inbox/1', title: 'Inbox', active: true };

function healthWithTabMessage(scripted, tab = TAB) {
  const state = loadBackground({ openTabs: [tab], tabMessages: { [tab.id]: scripted } });
  return askSupportHealth(state).then(tabRows);
}

test('support-health reports unknown when the permission level comes back undefined', async () => {
  const state = loadBackground();
  state.chrome.notifications.getPermissionLevel = (callback) => { callback(undefined); };
  const response = await askSupportHealth(state);

  assert.equal(response.health.notificationLevel, 'unknown');
});

test('support-health reports unknown when the permission level comes back empty', async () => {
  const state = loadBackground({ permissionLevel: '' });
  const response = await askSupportHealth(state);

  assert.equal(response.health.notificationLevel, 'unknown');
});

test('support-health reports unavailable when reading the permission level throws', async () => {
  const state = loadBackground();
  state.chrome.notifications.getPermissionLevel = () => { throw new Error('no notifications api'); };
  const response = await askSupportHealth(state);

  assert.equal(response.ok, true);
  assert.equal(response.health.notificationLevel, 'unavailable');
});

test('support-health answers with unknown after its timeout when the permission level never calls back', async () => {
  const state = loadBackground();
  const timers = [];
  state.win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  state.chrome.notifications.getPermissionLevel = () => {};
  let response;
  askSupportHealth(state).then(value => { response = value; });
  for (let i = 0; i < 50 && !timers.some(timer => timer.ms === 4000); i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(response, undefined, 'no answer before the timeout fires');

  const permissionTimeout = timers.filter(timer => timer.ms === 4000);
  assert.ok(permissionTimeout.length >= 1, 'a 4000 ms timeout was armed');
  permissionTimeout.forEach(timer => timer.fn());
  for (let i = 0; i < 50 && !response; i++) await new Promise(resolve => setImmediate(resolve));

  assert.equal(response.ok, true);
  assert.equal(response.health.notificationLevel, 'unknown');
});

test('support-health still replies with zero tabs and the message when the tab query throws', async () => {
  const state = loadBackground({ queryThrow: new Error('query exploded') });
  const response = await askSupportHealth(state);

  assert.equal(response.ok, true);
  assert.equal(tabRows(response).length, 0);
  assert.equal(response.health.tabsError, 'query exploded');
});

test('support-health reports tabId, title, url and active for a complete tab', async () => {
  const rows = await healthWithTabMessage({ report: { ok: true } });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].tabId, 7);
  assert.equal(rows[0].title, 'Inbox');
  assert.equal(rows[0].url, 'https://app.intercom.com/a/inbox/1');
  assert.equal(rows[0].active, true);
});

test('support-health reports null title and url and a boolean active for a bare tab', async () => {
  const rows = await healthWithTabMessage({ report: { ok: true } }, { id: 8 });

  assert.equal(rows[0].tabId, 8);
  assert.equal(rows[0].title, null);
  assert.equal(rows[0].url, null);
  assert.equal(rows[0].active, false);
});

test('support-health reports null for an empty title and an empty url', async () => {
  const rows = await healthWithTabMessage({ report: { ok: true } }, { id: 8, title: '', url: '', active: false });

  assert.equal(rows[0].title, null);
  assert.equal(rows[0].url, null);
  assert.equal(rows[0].active, false);
});

test('support-health matches the not-loaded error text case-insensitively', async () => {
  const lower = await healthWithTabMessage({ error: 'could not establish connection to the page' });
  const upper = await healthWithTabMessage({ error: 'RECEIVING END DOES NOT EXIST' });

  assert.equal(lower[0].injected, false);
  assert.equal(lower[0].error, 'could not establish connection to the page');
  assert.equal(lower[0].notInjected, true);
  assert.equal(upper[0].injected, false);
  assert.equal(upper[0].error, 'RECEIVING END DOES NOT EXIST');
  assert.equal(upper[0].notInjected, true);
});

test('support-health does not flag notInjected for any other send error', async () => {
  const rows = await healthWithTabMessage({ error: 'The message port closed before a response was received.' });

  assert.equal(rows[0].injected, false);
  assert.equal(rows[0].error, 'The message port closed before a response was received.');
  assert.equal(rows[0].notInjected, false);
});

test('support-health copies captureVersion and extensionVersion from a good reply', async () => {
  const rows = await healthWithTabMessage({ report: { ok: true, captureVersion: 3, extensionVersion: '2.0.16.0' } });

  assert.equal(rows[0].injected, true);
  assert.equal(rows[0].captureVersion, 3);
  assert.equal(rows[0].extensionVersion, '2.0.16.0');
});

test('support-health reports null versions when a good reply lacks them', async () => {
  const rows = await healthWithTabMessage({ report: { ok: true } });

  assert.equal(rows[0].injected, true);
  assert.equal(rows[0].captureVersion, null);
  assert.equal(rows[0].extensionVersion, null);
});

test('support-health reports no-reply when the reply is present but not ok', async () => {
  const rows = await healthWithTabMessage({ report: { ok: false, captureVersion: 3 } });

  assert.equal(rows[0].injected, false);
  assert.equal(rows[0].error, 'no-reply');
});

test('support-health reports the thrown message when sending the ping throws', async () => {
  const state = loadBackground({ openTabs: [TAB] });
  state.chrome.tabs.sendMessage = () => { throw new Error('send exploded'); };
  const response = await askSupportHealth(state);
  const rows = tabRows(response);

  assert.equal(response.ok, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].injected, false);
  assert.equal(rows[0].error, 'send exploded');
});

test('support-health reports unavailable at once when the notifications api has no permission reader', async () => {
  const state = loadBackground();
  state.chrome.notifications.getPermissionLevel = undefined;
  const started = Date.now();
  const response = await askSupportHealth(state);

  assert.equal(response.health.notificationLevel, 'unavailable');
  assert.ok(Date.now() - started < 1000, 'must not wait for the permission timeout');
});

test('support-health marks a tab that never answers the ping as a timeout and ignores its late reply', async () => {
  const state = loadBackground({ openTabs: [TAB] });
  const timers = [];
  state.win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  let reply;
  state.chrome.tabs.sendMessage = (tabId, message, callback) => { reply = callback; };
  let response;
  askSupportHealth(state).then(value => { response = value; });
  for (let i = 0; i < 50 && !reply; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof reply, 'function', 'the ping was sent');
  assert.equal(response, undefined, 'no answer before the timeout fires');

  const pingTimeout = timers.filter(timer => timer.ms === 4000);
  assert.ok(pingTimeout.length >= 1, 'a 4000 ms timeout was armed');
  pingTimeout.forEach(timer => timer.fn());
  for (let i = 0; i < 50 && !response; i++) await new Promise(resolve => setImmediate(resolve));
  reply({ ok: true, captureVersion: 3, extensionVersion: '9.9' });
  const rows = tabRows(response);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].injected, false);
  assert.equal(rows[0].error, 'timeout');
  assert.equal(rows[0].tabId, TAB.id);
});

test('support-health reports a null extension name when the manifest has none', async () => {
  const state = loadBackground();
  state.chrome.runtime.getManifest = () => ({ version: '4.5.6' });
  const response = await askSupportHealth(state);

  assert.equal(response.health.extension.name, null);
  assert.equal(response.health.extension.version, '4.5.6');
});

test('support-health still answers with null extension fields when reading the manifest throws', async () => {
  const state = loadBackground();
  state.chrome.runtime.getManifest = () => { throw new Error('manifest gone'); };
  const response = await askSupportHealth(state);

  assert.equal(response.ok, true);
  assert.deepEqual({ ...response.health.extension }, { name: null, version: null });
});
