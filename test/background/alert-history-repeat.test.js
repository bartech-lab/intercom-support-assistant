'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, settle } = require('../support/background-harness');

const SENDER = { tab: { id: 1, windowId: 1 } };
const INTERCOM = { type: 'inbox-alert', teamId: '90025568', label: 'Urgent Northside', count: 2 };

const plain = value => JSON.parse(JSON.stringify(value));
const send = (state, message) => state.listeners.message(message, SENDER, () => {});
const lastBadge = state => state.badgeTexts[state.badgeTexts.length - 1];
const history = state => plain(state.storageState.isaAlertHistory);

function intercomEntry(extra = {}) {
  return { at: 111, seen: false, label: 'Urgent Northside', count: 2, teamId: '90025568', ...extra };
}

function secondEntry(extra = {}) {
  return { at: 222, seen: false, label: 'Urgent Saltmarsh Crafts', count: 1, teamId: '900206', ...extra };
}

async function ring(seed, message) {
  const state = loadBackground({ storageSeed: { isaAlertHistory: seed } });
  await settle();
  send(state, message);
  await settle();
  return state;
}

test('a muted Intercom ring is listed and counted on the badge but makes no desktop notification', async () => {
  const state = await ring([], { ...INTERCOM, muted: true });
  assert.equal(history(state).length, 1);
  assert.equal(history(state)[0].label, 'Urgent Northside');
  assert.equal(lastBadge(state), '1');
  assert.equal(state.notificationsCreated.length, 0);
});

test('a ring that is not muted still makes a desktop notification', async () => {
  const state = await ring([], INTERCOM);
  assert.equal(state.notificationsCreated.length, 1);
});

test('muted: false makes a desktop notification', async () => {
  const state = await ring([], { ...INTERCOM, muted: false });
  assert.equal(state.notificationsCreated.length, 1);
});

test('a repeat updates the newest matching entry instead of appending', async () => {
  const seed = [intercomEntry({ rings: 1 })];
  const state = await ring(seed, { ...INTERCOM, count: 7, repeat: 2 });
  assert.deepStrictEqual(history(state), [intercomEntry({ rings: 3, count: 7 })]);
});

test('a repeat sets rings to the repeat number plus one when the entry had no rings field', async () => {
  const state = await ring([intercomEntry()], { ...INTERCOM, repeat: 2 });
  assert.equal(history(state)[0].rings, 3);
});

test('a repeat makes a desktop notification', async () => {
  const state = await ring([intercomEntry()], { ...INTERCOM, repeat: 1 });
  assert.equal(state.notificationsCreated.length, 1);
});

test('a repeat keeps the original time and the other fields', async () => {
  const state = await ring([intercomEntry({ at: 5 })], { ...INTERCOM, count: 9, repeat: 1 });
  const item = history(state)[0];
  assert.equal(item.at, 5);
  assert.equal(item.teamId, '90025568');
  assert.equal(item.label, 'Urgent Northside');
});

test('a repeat leaves other entries untouched and the list length unchanged', async () => {
  const other = secondEntry();
  const older = intercomEntry({ at: 1, label: 'Urgent Saltmarsh Crafts', teamId: '2' });
  const seed = [older, intercomEntry(), other];
  const state = await ring(seed, { ...INTERCOM, count: 4, repeat: 1 });
  const result = history(state);
  assert.equal(result.length, 3);
  assert.deepStrictEqual(result[0], older);
  assert.deepStrictEqual(result[2], other);
  assert.equal(result[1].count, 4);
});

test('a repeat updates the newest entry with that label and leaves an older one alone', async () => {
  const older = intercomEntry({ at: 1, count: 3 });
  const newer = intercomEntry({ at: 2, count: 4 });
  const state = await ring([older, newer], { ...INTERCOM, count: 8, repeat: 1 });
  const result = history(state);
  assert.deepStrictEqual(result[0], older);
  assert.equal(result[1].count, 8);
  assert.equal(result[1].rings, 2);
});

test('a repeat makes a seen entry unseen again and raises the badge by one', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [intercomEntry({ seen: true }), secondEntry()] } });
  await settle();
  assert.equal(lastBadge(state), '1');
  send(state, { ...INTERCOM, repeat: 1 });
  await settle();
  assert.equal(history(state)[0].seen, false);
  assert.equal(lastBadge(state), '2');
});

test('a repeat on an unseen entry does not raise the badge twice', async () => {
  const state = loadBackground({ storageSeed: { isaAlertHistory: [intercomEntry()] } });
  await settle();
  send(state, { ...INTERCOM, repeat: 1 });
  await settle();
  assert.equal(lastBadge(state), '1');
});

test('a repeat with no matching entry appends a new one', async () => {
  const state = await ring([secondEntry()], { ...INTERCOM, repeat: 1 });
  const result = history(state);
  assert.equal(result.length, 2);
  assert.equal(result[1].label, 'Urgent Northside');
  assert.equal(result[1].seen, false);
});

test('a repeat with an empty history appends a new entry', async () => {
  const state = await ring([], { ...INTERCOM, repeat: 3 });
  assert.equal(history(state).length, 1);
  assert.equal(history(state)[0].label, 'Urgent Northside');
});

test('a repeat for one label never touches an entry for another label', async () => {
  const other = intercomEntry({ label: 'Urgent Saltmarsh Crafts', teamId: '2' });
  const state = await ring([other], { ...INTERCOM, repeat: 1 });
  const result = history(state);
  assert.equal(result.length, 2);
  assert.deepStrictEqual(result[0], other);
});

for (const bad of [0, -1, 1.5, '2x', 99, NaN, null, 11]) {
  test(`repeat value ${JSON.stringify(bad)} is treated as an ordinary first ring and appended`, async () => {
    const state = await ring([intercomEntry()], { ...INTERCOM, repeat: bad });
    const result = history(state);
    assert.equal(result.length, 2);
    assert.deepStrictEqual(result[0], intercomEntry());
  });
}

test('repeat 10 is accepted as a repeat and updates the entry', async () => {
  const state = await ring([intercomEntry()], { ...INTERCOM, repeat: 10 });
  assert.equal(history(state).length, 1);
  assert.equal(history(state)[0].rings, 11);
});

test('a message that is both muted and a repeat updates the entry and makes no notification', async () => {
  const state = await ring([intercomEntry({ seen: true })], { ...INTERCOM, count: 6, muted: true, repeat: 1 });
  const result = history(state);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 6);
  assert.equal(result[0].rings, 2);
  assert.equal(result[0].seen, false);
  assert.equal(state.notificationsCreated.length, 0);
  assert.equal(lastBadge(state), '1');
});
