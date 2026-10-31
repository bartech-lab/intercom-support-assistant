'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground } = require('../support/background-harness');

function fireInbox(state, teamId, count = 1) {
  state.listeners.message(
    { type: 'inbox-alert', teamId, label: `Urgent ${teamId}`, count }, { tab: { id: 1, windowId: 1 } }, () => {});
}

function withSteppedClock(state, run) {
  const realm = state.win.Date;
  const realNow = realm.now;
  let clock = realNow();
  realm.now = () => (clock += 1000);
  try { run(); } finally { realm.now = realNow; }
}

test('reload notice defaults to Intercom and blocks textarea use', () => {
  const { win } = loadBackground();
  win.showReloadNotice();

  const notice = win.document.getElementById('isa-signature-reload-notice');
  assert.ok(notice);
  assert.match(notice.textContent, /Reload Intercom/);
  assert.equal(notice.hasAttribute('data-isa-own'), true,
    'an injected notice is ours, so a capture inventories it');

  const textarea = win.document.createElement('textarea');
  win.document.body.appendChild(textarea);
  const event = new win.Event('input', { bubbles: true, cancelable: true });
  textarea.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
});

test('reload notice routing resolves Intercom URLs only', () => {
  const { win } = loadBackground();
  assert.equal(win.getReloadNoticePlatform('https://app.intercom.com/a/inbox'), 'Intercom');
  assert.equal(win.getReloadNoticePlatform('https://other.example/messenger'), null);
  assert.equal(win.getReloadNoticePlatform('https://example.com/'), null);
});

test('inbox-alert message creates an OS notification for the inbox', () => {
  const state = loadBackground();
  state.listeners.message(
    { type: 'inbox-alert', teamId: '90005450', label: 'Urgent Alderpoint', count: 3 },
    { tab: { id: 7, windowId: 2 } },
    () => {}
  );

  assert.equal(state.notificationsCreated.length, 1);
  const notification = state.notificationsCreated[0];
  assert.match(notification.id, /^isa-inbox-90005450-\d+-t7-w2$/);
  assert.match(notification.options.title, /Urgent Alderpoint/);
  assert.match(notification.options.message, /3 conversations waiting/);
  assert.equal(notification.options.iconUrl, 'chrome-extension://test/icons/icon128.png');
});

test('clicking an inbox-alert notification focuses the originating tab', () => {
  const state = loadBackground();
  state.listeners.message(
    { type: 'inbox-alert', teamId: '9005326', label: 'Urgent alderpoint', count: 1 },
    { tab: { id: 42, windowId: 9 } },
    () => {}
  );

  const createdId = state.notificationsCreated[0].id;
  assert.match(createdId, /^isa-inbox-9005326-\d+-t42-w9$/);
  state.listeners.notificationClicked(createdId);

  assert.equal(state.tabUpdates.length, 1);
  assert.equal(state.tabUpdates[0].tabId, 42);
  assert.equal(state.tabUpdates[0].props.active, true);
  assert.equal(state.windowUpdates.length, 1);
  assert.equal(state.windowUpdates[0].windowId, 9);
  assert.equal(state.windowUpdates[0].props.focused, true);
  assert.deepEqual(Array.from(state.notificationsCleared), [createdId]);
});

test('a notification click after a service worker restart still focuses the originating tab', () => {
  const first = loadBackground();
  first.listeners.message(
    { type: 'inbox-alert', teamId: '9005326', label: 'Urgent alderpoint', count: 1 },
    { tab: { id: 42, windowId: 9 } },
    () => {}
  );
  const createdId = first.notificationsCreated[0].id;

  const restarted = loadBackground();
  restarted.listeners.notificationClicked(createdId);

  assert.equal(restarted.tabUpdates.length, 1);
  assert.equal(restarted.tabUpdates[0].tabId, 42);
  assert.equal(restarted.windowUpdates[0].windowId, 9);
  assert.deepEqual(Array.from(restarted.notificationsCleared), [createdId]);
});

test('a click on a toast whose tab has closed reads lastError and focuses no window', () => {
  const state = loadBackground({ updateError: { message: 'No tab with id: 42.' } });
  state.listeners.message(
    { type: 'inbox-alert', teamId: '9005326', label: 'Urgent alderpoint', count: 1 },
    { tab: { id: 42, windowId: 9 } },
    () => {}
  );
  state.listeners.notificationClicked(state.notificationsCreated[0].id);
  assert.equal(state.tabUpdates.length, 1);
  assert.equal(state.windowUpdates.length, 0);
});

test('single-conversation notification uses singular wording', () => {
  const state = loadBackground();
  state.listeners.message(
    { type: 'inbox-alert', teamId: '90005450', label: 'Urgent Alderpoint', count: 1 },
    { tab: { id: 1, windowId: 1 } },
    () => {}
  );
  assert.match(state.notificationsCreated[0].options.message, /1 conversation waiting/);
});

test('alert-test self-check creates a test notification and reports the permission level', () => {
  const state = loadBackground();
  let response = null;
  const kept = state.listeners.message({ type: 'alert-test' }, {}, (r) => { response = r; });
  assert.equal(kept, true, 'must keep the message channel open for the async response');
  assert.equal(state.notificationsCreated.length, 1);
  assert.match(state.notificationsCreated[0].id, /^isa-test-\d+$/);
  assert.match(state.notificationsCreated[0].options.title, /test/i);
  assert.ok(response && response.ok === true);
  assert.equal(response.level, 'granted');
});

test('alert-test reports a denied permission level back to the popup', () => {
  const state = loadBackground({ permissionLevel: 'denied' });
  let response = null;
  state.listeners.message({ type: 'alert-test' }, {}, (r) => { response = r; });
  assert.equal(response.level, 'denied');
  assert.equal(state.notificationsCreated.length, 1);
});

test('alert-test surfaces a create() failure to the popup', () => {
  const state = loadBackground({ createError: { message: 'boom' } });
  let response = null;
  state.listeners.message({ type: 'alert-test' }, {}, (r) => { response = r; });
  assert.equal(response.ok, false);
  assert.equal(response.error, 'boom');
});

test('installed reload notice scans Intercom tabs and passes the platform name', () => {
  const state = loadBackground();
  state.chrome.tabs.query = (_query, callback) => callback([
    { id: 1, status: 'complete', url: 'https://app.intercom.com/a/inbox' }
  ]);

  state.listeners.installed({ reason: 'update' });

  assert.deepEqual(
    state.executeCalls.map(call => Array.from(call.args)),
    [['Intercom']]
  );
});

test('a superseded toast is found by asking the OS, so a worker restart cannot stack toasts', () => {
  const first = loadBackground();
  fireInbox(first, '900101');
  const before = first.notificationsCreated[0].id;

  const restarted = loadBackground({ shownSeed: [before] });
  withSteppedClock(restarted, () => fireInbox(restarted, '900101'));

  const after = restarted.notificationsCreated[0].id;
  assert.notEqual(after, before);
  assert.deepEqual(Array.from(restarted.notificationsCleared), [before],
    'the fresh worker holds no in-memory id, yet clears the toast the OS still shows');
  assert.deepEqual(Array.from(restarted.shownNotifications), [after], 'only the newest toast remains');
});

test('a toast for another inbox is never cleared', () => {
  const state = loadBackground();
  withSteppedClock(state, () => {
    fireInbox(state, '900101');
    fireInbox(state, '900102');
  });

  assert.deepEqual(Array.from(state.notificationsCleared), []);
  assert.equal(state.shownNotifications.size, 2);
});

test('an inbox whose id extends another is not cleared by it', () => {
  const state = loadBackground();
  withSteppedClock(state, () => {
    fireInbox(state, '9002993');
    fireInbox(state, '900101');
  });

  assert.deepEqual(Array.from(state.notificationsCleared), [],
    'isa-inbox-900101- must not match isa-inbox-9002993-<timestamp>');
  assert.equal(state.shownNotifications.size, 2);
});

test('a toast still fires when the browser cannot list notifications', () => {
  const state = loadBackground({ supportsGetAll: false });
  withSteppedClock(state, () => {
    fireInbox(state, '900101');
    fireInbox(state, '900101');
  });

  assert.equal(state.notificationsCreated.length, 2, 'the alert is never dropped');
});
