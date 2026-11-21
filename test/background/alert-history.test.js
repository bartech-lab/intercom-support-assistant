'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, settle } = require('../support/background-harness');

const SENDER = { tab: { id: 1, windowId: 1 } };
const INTERCOM = { type: 'inbox-alert', teamId: '90025568', label: 'Urgent Northside', count: 2 };
const SECOND = { type: 'inbox-alert', teamId: '900206', label: 'Urgent Saltmarsh Crafts', count: 1 };

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function send(state, message, sendResponse = () => {}) {
  return state.listeners.message(message, SENDER, sendResponse);
}

function entry(at, seen, extra = {}) {
  return { at, seen, label: `L${at}`, count: 1, teamId: '1', ...extra };
}

test('an Intercom ring is stored with the full entry shape', async () => {
  const state = loadBackground({ storageSeed: {} });
  state.win.Date.now = () => 900576;
  send(state, INTERCOM);
  await settle();
  assert.deepStrictEqual(plain(state.storageState.isaAlertHistory), [
    { at: 900576, seen: false, label: 'Urgent Northside', count: 2, teamId: '90025568' }
  ]);
});

test('an Intercom ring without a label is called Urgent inbox', async () => {
  const state = loadBackground({ storageSeed: {} });
  send(state, { type: 'inbox-alert', teamId: '90025568', count: 1 });
  await settle();
  assert.equal(state.storageState.isaAlertHistory[0].label, 'Urgent inbox');
});

test('rings are kept in arrival order, oldest first', async () => {
  const state = loadBackground({ storageSeed: {} });
  let clock = 1000;
  state.win.Date.now = () => { clock += 1; return clock; };
  send(state, { ...INTERCOM, label: 'first' });
  await settle();
  send(state, { ...SECOND, label: 'second' });
  await settle();
  const history = plain(state.storageState.isaAlertHistory);
  assert.deepStrictEqual(history.map(item => item.label), ['first', 'second']);
  assert.ok(history[0].at < history[1].at);
});

test('after 55 rings the list holds the newest 50, oldest first', async () => {
  const state = loadBackground({ storageSeed: {} });
  for (let i = 1; i <= 55; i += 1) {
    send(state, { ...INTERCOM, count: i });
    await settle();
  }
  const counts = plain(state.storageState.isaAlertHistory).map(item => item.count);
  assert.equal(counts.length, 50);
  assert.equal(counts[0], 6);
  assert.equal(counts[49], 55);
  assert.deepStrictEqual(counts, [...counts].sort((a, b) => a - b));
});

test('two rings sent back to back are both kept', async () => {
  const state = loadBackground({ storageSeed: {} });
  send(state, { ...INTERCOM, label: 'one' });
  send(state, { ...SECOND, label: 'two' });
  await settle();
  const labels = plain(state.storageState.isaAlertHistory).map(item => item.label);
  assert.deepStrictEqual(labels, ['one', 'two']);
});

test('the badge shows the number of unseen rings as a string', async () => {
  const state = loadBackground({ storageSeed: {} });
  send(state, INTERCOM);
  send(state, SECOND);
  send(state, INTERCOM);
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '3');
});

test('the badge colour is red', async () => {
  const state = loadBackground({ storageSeed: {} });
  send(state, INTERCOM);
  await settle();
  assert.ok(state.badgeColors.length > 0);
  assert.equal(state.badgeColors[state.badgeColors.length - 1], '#c92a16');
});

test('seen marks every entry seen and keeps all other fields and order', async () => {
  const seed = [entry(1, false), entry(2, true, { teamId: '9' }), entry(3, false)];
  const state = loadBackground({ storageSeed: { isaAlertHistory: seed } });
  send(state, { type: 'alert-history-seen' });
  await settle();
  assert.deepStrictEqual(
    plain(state.storageState.isaAlertHistory),
    seed.map(item => ({ ...item, seen: true }))
  );
});

test('seen clears the badge text', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [entry(1, false)] } });
  send(state, { type: 'alert-history-seen' });
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '');
});

test('seen answers ok and the listener returns true for the async response', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [entry(1, false)] } });
  const responses = [];
  const returned = send(state, { type: 'alert-history-seen' }, response => responses.push(plain(response)));
  await settle();
  assert.equal(returned, true);
  assert.deepStrictEqual(responses, [{ ok: true }]);
});

test('a ring after seen counts only the new ring in the badge', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [entry(1, false), entry(2, false)] } });
  send(state, { type: 'alert-history-seen' });
  await settle();
  send(state, INTERCOM);
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '1');
  assert.equal(state.storageState.isaAlertHistory.length, 3);
});

test('a ring is recorded and no notification is created when notifications are unavailable', async () => {
  const state = loadBackground({ storageSeed: {} });
  delete state.chrome.notifications;
  send(state, INTERCOM);
  await settle();
  assert.equal(state.storageState.isaAlertHistory.length, 1);
  assert.equal(state.notificationsCreated.length, 0);
});

test('the self-test writes nothing to the history', async () => {
  const state = loadBackground({ storageSeed: {} });
  send(state, { type: 'alert-test' });
  await settle();
  assert.ok(!state.storageState.isaAlertHistory || state.storageState.isaAlertHistory.length === 0);
});

test('the self-test does not change the badge count', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [entry(1, false), entry(2, false)] } });
  await settle();
  send(state, { type: 'alert-test' });
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '2');
});

test('on load the badge counts only unseen stored entries', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [entry(1, false), entry(2, true), entry(3, false)] } });
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '2');
});

test('on load an empty list gives an empty badge', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [] } });
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '');
});

test('on load a missing list gives an empty badge', async () => {
  const state = loadBackground({ storageSeed: {} });
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '');
});

test('browser startup sets the badge again from storage', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [entry(1, true)] } });
  await settle();
  state.storageState.isaAlertHistory = [entry(1, false), entry(2, false), entry(3, false), entry(4, true)];
  state.listeners.startup();
  await settle();
  assert.equal(state.badgeTexts[state.badgeTexts.length - 1], '3');
});

test('loading does not rewrite or reorder the stored list', async () => {
  const seed = [entry(3, false), entry(1, true), entry(2, false)];
  const state = loadBackground({ storageSeed: { isaAlertHistory: seed } });
  await settle();
  state.listeners.startup();
  await settle();
  assert.deepStrictEqual(plain(state.storageState.isaAlertHistory), seed);
});

test('a stored string is treated as an empty list', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: 'garbage' } });
  send(state, INTERCOM);
  await settle();
  assert.equal(state.storageState.isaAlertHistory.length, 1);
  assert.equal(state.storageState.isaAlertHistory[0].label, 'Urgent Northside');
});

test('a stored object is treated as an empty list', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: { 0: entry(1, false), length: 1 } } });
  send(state, SECOND);
  await settle();
  assert.ok(Array.isArray(state.storageState.isaAlertHistory));
  assert.equal(state.storageState.isaAlertHistory.length, 1);
  assert.equal(state.storageState.isaAlertHistory[0].label, 'Urgent Saltmarsh Crafts');
});

test('opening the workspace activates the first tab and focuses its window', async () => {
  const state = loadBackground({
    storageSeed: {},
    openTabs: [
      { id: 7, windowId: 3, url: 'https://app.intercom.com/a/inbox' },
      { id: 8, windowId: 4, url: 'https://app.intercom.com/a/other' }
    ]
  });
  const responses = [];
  send(state, { type: 'alert-history-open' }, r => responses.push(plain(r)));
  await settle();
  assert.deepStrictEqual(plain(state.tabUpdates), [{ tabId: 7, props: { active: true } }]);
  assert.deepStrictEqual(plain(state.windowUpdates), [{ windowId: 3, props: { focused: true } }]);
  assert.deepStrictEqual(responses, [{ ok: true }]);
});

test('opening the workspace never navigates or creates a tab', async () => {
  const state = loadBackground({
    storageSeed: {},
    openTabs: [{ id: 7, windowId: 3, url: 'https://app.intercom.com/a/inbox' }]
  });
  send(state, { type: 'alert-history-open' });
  await settle();
  assert.ok(state.tabUpdates.length > 0);
  assert.ok(state.tabUpdates.every(update => !('url' in update.props)));
  assert.equal(state.tabsCreated.length, 0);
});

test('opening the workspace with no open tab answers no-tab and updates nothing', async () => {
  const state = loadBackground({ storageSeed: {}, openTabs: [] });
  const responses = [];
  send(state, { type: 'alert-history-open' }, r => responses.push(plain(r)));
  await settle();
  assert.deepStrictEqual(responses, [{ ok: false, reason: 'no-tab' }]);
  assert.equal(state.tabUpdates.length, 0);
  assert.equal(state.windowUpdates.length, 0);
  assert.equal(state.tabsCreated.length, 0);
});

test('a history entry does not contain the sender tab id', async () => {
  const state = loadBackground({ storageSeed: {} });
  state.listeners.message(INTERCOM, { tab: { id: 900163, windowId: 900844 } }, () => {});
  state.listeners.message(SECOND, { tab: { id: 900163, windowId: 900844 } }, () => {});
  await settle();
  const raw = JSON.stringify(state.storageState.isaAlertHistory);
  assert.equal(state.storageState.isaAlertHistory.length, 2);
  assert.ok(!raw.includes('900163'));
  assert.ok(!raw.includes('900844'));
});
