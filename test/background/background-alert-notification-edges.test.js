'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, settle } = require('../support/background-harness');

function send(state, message, sender) {
  const responses = [];
  let thrown = null;
  try {
    state.listeners.message(message, sender, response => responses.push(JSON.parse(JSON.stringify(response))));
  } catch (error) {
    thrown = error;
  }
  return { responses, thrown };
}

const TAB = { tab: { id: 5, windowId: 3 } };

test('A1 inbox-alert defaults: unknown team, default label, count coercion', async () => {
  const state = loadBackground();
  const first = send(state, { type: 'inbox-alert' }, TAB);
  await settle();
  assert.equal(first.thrown, null);
  assert.match(state.notificationsCreated[0].id, /^isa-inbox-unknown-\d+-t5-w3$/);
  assert.equal(state.notificationsCreated[0].options.title, 'New in Urgent inbox');
  assert.equal(state.notificationsCreated[0].options.message, '0 conversations waiting');
  send(state, { type: 'inbox-alert', teamId: '1', count: 'two' }, TAB);
  assert.equal(state.notificationsCreated[1].options.message, '0 conversations waiting');
  send(state, { type: 'inbox-alert', teamId: '1', count: 1 }, TAB);
  assert.equal(state.notificationsCreated[2].options.message, '1 conversation waiting');
});

test('A3 sender without usable tab id gets no target suffix', async () => {
  for (const sender of [{}, { tab: { id: '5', windowId: 3 } }]) {
    const state = loadBackground();
    const result = send(state, { type: 'inbox-alert', teamId: '900101', label: 'L', count: 1 }, sender);
    await settle();
    assert.equal(result.thrown, null);
    assert.equal(state.notificationsCreated.length, 1);
    assert.match(state.notificationsCreated[0].id, /^isa-inbox-900101-\d+$/);
    assert.deepEqual(result.responses, [{ ok: true }]);
  }
});

test('A4 non-integer windowId leaves an empty window part', () => {
  for (const sender of [{ tab: { id: 5 } }, { tab: { id: 5, windowId: 'x' } }]) {
    const state = loadBackground();
    send(state, { type: 'inbox-alert', teamId: '900101', label: 'L', count: 1 }, sender);
    assert.match(state.notificationsCreated[0].id, /^isa-inbox-900101-\d+-t5-w$/);
  }
});

test('A5 getAll throwing still creates the notification once', async () => {
  const state = loadBackground();
  state.chrome.notifications.getAll = () => { throw new Error('boom'); };
  const result = send(state, { type: 'inbox-alert', teamId: '1', label: 'L', count: 1 }, TAB);
  await settle();
  assert.equal(result.thrown, null);
  assert.equal(state.notificationsCreated.length, 1);
  assert.deepEqual(result.responses, [{ ok: true }]);
});

test('A6 missing notifications api or create function does not throw', async () => {
  const absent = loadBackground();
  delete absent.chrome.notifications;
  for (const message of [{ type: 'inbox-alert', teamId: '1', label: 'L', count: 1 }]) {
    const result = send(absent, message, TAB);
    await settle();
    assert.equal(result.thrown, null);
    assert.deepEqual(result.responses, [{ ok: true }]);
  }
  const noCreate = loadBackground();
  let getAllCalls = 0;
  noCreate.chrome.notifications.getAll = () => { getAllCalls += 1; };
  delete noCreate.chrome.notifications.create;
  const result = send(noCreate, { type: 'inbox-alert', teamId: '1', label: 'L', count: 1 }, TAB);
  await settle();
  assert.equal(result.thrown, null);
  assert.equal(getAllCalls, 0);
});

test('A8 failing create never breaks the acknowledgement', async () => {
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const throwing = loadBackground();
    throwing.chrome.notifications.create = () => { throw new Error('boom'); };
    const first = send(throwing, { type: 'inbox-alert', teamId: '1', label: 'L', count: 1 }, TAB);
    await settle();
    assert.equal(first.thrown, null);
    assert.deepEqual(first.responses, [{ ok: true }]);

    const failing = loadBackground({ createError: { message: 'nope' } });
    const second = send(failing, { type: 'inbox-alert', teamId: '2', label: 'L', count: 1 }, TAB);
    await settle();
    assert.equal(second.thrown, null);
    assert.deepEqual(second.responses, [{ ok: true }]);
    assert.equal(failing.notificationsCreated.length, 2);
    assert.equal('iconUrl' in failing.notificationsCreated[1].options, false);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('A9 alert-test without notifications api reports unavailable once', async () => {
  const state = loadBackground();
  delete state.chrome.notifications;
  const result = send(state, { type: 'alert-test' }, TAB);
  await settle();
  assert.equal(result.thrown, null);
  assert.deepEqual(result.responses, [{ ok: false, level: 'unavailable' }]);
});
