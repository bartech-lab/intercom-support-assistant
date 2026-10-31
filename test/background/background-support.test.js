'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, VERSION_ENDPOINT, settle } = require('../support/background-harness');

function askSupportHealth(state) {
  return new Promise((resolve) => {
    const returned = state.listeners.message({ type: 'support-health' }, {}, resolve);
    assert.equal(returned, true, 'support-health must keep the message channel open');
  });
}

function matchesPattern(url, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(url);
}

function honourUrlQuery(state) {
  const tabs = state.chrome.tabs;
  const all = tabs.query;
  tabs.query = (query, callback) => all(query, (found) => {
    const patterns = [].concat((query && query.url) || []);
    callback(found && patterns.length
      ? found.filter(tab => patterns.some(pattern => matchesPattern(tab.url, pattern)))
      : found);
  });
}

test('capture-tabs lists every Intercom tab and skips other tabs', () => {
  const state = loadBackground({
    openTabs: [
      { id: 11, title: 'Intercom', url: 'https://app.intercom.com/a/inbox/1', active: true },
      { id: 33, title: 'Other', url: 'https://example.com/page', active: false },
      { id: 22, title: 'Intercom 2', url: 'https://app.intercom.com/a/inbox/2', active: false }
    ]
  });
  honourUrlQuery(state);
  const responses = [];
  state.listeners.message({ type: 'capture-tabs' }, {}, r => responses.push(r));

  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, true);
  assert.deepEqual(Array.from(responses[0].tabs, t => t.tabId).sort(), [11, 22]);
  assert.equal(responses[0].tabs[0].active, true);
});

test('dom-capture targets exactly the requested tab', () => {
  const state = loadBackground({
    openTabs: [
      { id: 11, title: 'One', url: 'https://app.intercom.com/a/inbox/1' },
      { id: 22, title: 'Two', url: 'https://app.intercom.com/a/inbox/2' }
    ],
    tabMessages: {
      22: { report: { ok: true, html: '<!doctype html><html></html>', filename: 'isa-capture.html' } }
    }
  });
  const responses = [];
  state.listeners.message({ type: 'dom-capture', tabId: 22 }, {}, r => responses.push(r));

  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].filename, 'isa-capture.html');
  assert.equal(state.tabMessageCalls.length, 1, 'only the requested tab is messaged');
  assert.equal(state.tabMessageCalls[0].tabId, 22);
  assert.equal(state.tabMessageCalls[0].message.type, 'isa-dom-capture');
});

test('dom-capture reports a closed tab as not injected rather than hanging', () => {
  const state = loadBackground({
    openTabs: [{ id: 11, title: 'One', url: 'https://app.intercom.com/a/inbox/1' }],
    tabMessages: { 11: { error: 'Could not establish connection. Receiving end does not exist.' } }
  });
  const responses = [];
  state.listeners.message({ type: 'dom-capture', tabId: 11 }, {}, r => responses.push(r));

  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].reason, 'unreachable');
  assert.equal(responses[0].notInjected, true);
});

test('dom-capture rejects a missing tab id without messaging any tab', () => {
  const state = loadBackground({ openTabs: [] });
  const responses = [];
  state.listeners.message({ type: 'dom-capture' }, {}, r => responses.push(r));

  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].reason, 'no-tab-id');
  assert.equal(state.tabMessageCalls.length, 0);
});

test('support-health reports the build, the browser, and notification access', async () => {
  const state = loadBackground({ manifest: { version: '2.0.16.0', name: 'Intercom Support Assistant' } });
  const response = await askSupportHealth(state);

  assert.equal(response.ok, true);
  assert.equal(response.health.extension.version, '2.0.16.0');
  assert.equal(response.health.notificationLevel, 'granted');
  assert.equal(response.health.browser.chromeVersion, '141.0.7390.54');
  assert.equal(Array.from(response.health.tabs).length, 0);
});

test('support-health pings every supported tab and reports which one is loaded', async () => {
  const state = loadBackground({
    openTabs: [
      { id: 7, url: 'https://app.intercom.com/a/inbox/1', title: 'Inbox', active: true },
      { id: 9, url: 'https://example.com/other', title: 'Other', active: false }
    ],
    tabMessages: {
      7: { report: { ok: true, captureVersion: 1, extensionVersion: '2.0.16.0' } },
      9: { error: 'Could not establish connection. Receiving end does not exist.' }
    }
  });
  const response = await askSupportHealth(state);
  const tabs = Array.from(response.health.tabs);

  assert.equal(tabs.length, 2);
  assert.deepEqual(Array.from(state.tabMessageCalls).map(call => call.message.type), ['isa-support-ping', 'isa-support-ping']);
  assert.equal(tabs[0].injected, true);
  assert.equal(tabs[0].captureVersion, 1);
  assert.equal(tabs[1].injected, false);
  assert.equal(tabs[1].notInjected, true);
});

test('support-health reports a tab reply that is not a ping as not loaded', async () => {
  const state = loadBackground({
    openTabs: [{ id: 7, url: 'https://app.intercom.com/a/inbox/1', title: 'Inbox', active: true }],
    tabMessages: { 7: { report: undefined } }
  });
  const response = await askSupportHealth(state);
  const tabs = Array.from(response.health.tabs);

  assert.equal(tabs[0].injected, false);
  assert.equal(tabs[0].error, 'no-reply');
});

test('support-health surfaces a failed tab query instead of reporting zero tabs', async () => {
  const state = loadBackground({ queryError: { message: 'query blew up' } });
  const response = await askSupportHealth(state);

  assert.equal(response.ok, true);
  assert.equal(response.health.tabsError, 'query blew up');
  assert.equal(Array.from(response.health.tabs).length, 0);
});

test('support-health still answers when notifications are unavailable', async () => {
  const state = loadBackground();
  delete state.chrome.notifications.getPermissionLevel;
  const response = await askSupportHealth(state);

  assert.equal(response.health.notificationLevel, 'unavailable');
});
