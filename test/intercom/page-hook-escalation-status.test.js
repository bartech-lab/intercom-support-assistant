'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeIntercomResponse } = require('../support/helpers');
const { CONVERSATION_ID, SUMMARY_URL, STREAM_URL, hookWith, relayed } = require('../support/intercom-page-hook-harness');

const KIND = 'conversation-escalation-status';

const statusPart = (id, value, name = 'Escalation Status') => ({
  id,
  conversation_id: Number(CONVERSATION_ID),
  created_at: '2026-01-15T10:00:00.000Z',
  renderable_type: 14,
  renderable_data: {
    renderable_type: 14,
    attribute_summary: { id: '9006221', name, is_built_in: false, type: 'list' },
    source: 'unknown',
    value
  }
});

async function streamEnvelopes(parts, { id = Number(CONVERSATION_ID) } = {}) {
  const body = JSON.stringify({
    id,
    renderable_parts: [{ id: 1, renderable_type: 2, renderable_data: { body: 'Hello' } }, ...parts]
  });
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  return envelopes.filter(m => m.kind === KIND);
}

test('the newest Escalation Status part in progress relays inProgress true from the stream', async () => {
  const envelopes = await streamEnvelopes([statusPart(90010000001, 'in progress')]);
  assert.deepEqual(envelopes.map(m => ({ ...m })), [{
    __isaic: true,
    version: 1,
    kind: KIND,
    conversationId: CONVERSATION_ID,
    inProgress: true,
    source: 'stream'
  }]);
});

test('a later DONE replaces an earlier in progress', async () => {
  const envelopes = await streamEnvelopes([statusPart(90010000001, 'in progress'), statusPart(90020000002, 'DONE')]);
  assert.deepEqual(envelopes.map(m => m.inProgress), [false]);
});

test('the newest part is chosen by part id, not array order', async () => {
  const envelopes = await streamEnvelopes([statusPart(90020000002, 'DONE'), statusPart(90010000001, 'in progress')]);
  assert.deepEqual(envelopes.map(m => m.inProgress), [false]);
});

test('a status cleared after being in progress relays inProgress false', async () => {
  const envelopes = await streamEnvelopes([statusPart(90010000001, 'in progress'), statusPart(90020000002, null)]);
  assert.deepEqual(envelopes.map(m => m.inProgress), [false]);
});

test('a capitalised In Progress counts as in progress', async () => {
  const envelopes = await streamEnvelopes([statusPart(90010000001, '  In Progress ')]);
  assert.deepEqual(envelopes.map(m => m.inProgress), [true]);
});

test('an in progress value on the Handed to attribute is not a status', async () => {
  const envelopes = await streamEnvelopes([statusPart(90010000001, 'in progress', 'Handed to')]);
  assert.deepEqual(envelopes, []);
});

test('a stream without any Escalation Status part relays nothing', async () => {
  assert.deepEqual(await streamEnvelopes([]), []);
});

test('a stream whose root id is another conversation relays nothing', async () => {
  const envelopes = await streamEnvelopes([statusPart(90010000001, 'in progress')], { id: 900903972229001 });
  assert.deepEqual(envelopes, []);
});

test('a newest part with an unreadable value relays nothing rather than an older value', async () => {
  const envelopes = await streamEnvelopes([statusPart(90010000001, 'in progress'), statusPart(90020000002, { label: 'DONE' })]);
  assert.deepEqual(envelopes, []);
});

test('the summary option id never produces a status', async () => {
  const body = JSON.stringify({
    attributes: [{ descriptor: { id: 9006221, name: 'Escalation Status', type: 'list' }, value: '90059389-46da-4db2-8ea4-fc6c9848a778' }]
  });
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(body, { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.deepEqual(envelopes.filter(m => m.kind === KIND), []);
});

const DESCRIPTORS_URL = 'https://app.intercom.com/ember/conversation_attributes/descriptors?app_id=demo1234';

async function visibilityFrom(descriptors) {
  const ctx = hookWith({ [DESCRIPTORS_URL]: makeIntercomResponse(JSON.stringify(descriptors), { url: DESCRIPTORS_URL }) });
  const { envelopes } = await relayed(ctx, DESCRIPTORS_URL);
  await new Promise(resolve => setTimeout(resolve, 0));
  return ctx.posted.filter(m => m && m.__isaic === true && m.kind === 'escalation-status-visibility').map(m => m.teamIds === null ? null : Array.from(m.teamIds));
}

test('the live Escalation Status descriptor relays its team list, skipping the archived one and Brand', async () => {
  const lists = await visibilityFrom([
    { id: '9006335', name: 'Brand', archived: false, visible_to_team_ids: ['9001631'] },
    { id: '9004206', name: 'Escalation Status', archived: true, visible_to_team_ids: null },
    { id: '9006221', name: 'Escalation Status', archived: false, visible_to_team_ids: ['90031012', 900202] }
  ]);
  assert.deepEqual(lists, [['90031012', '900202']]);
});

test('an Escalation Status descriptor visible to every team relays null', async () => {
  const lists = await visibilityFrom([{ id: '9006221', name: 'Escalation Status', archived: false, visible_to_team_ids: null }]);
  assert.deepEqual(lists, [null]);
});

test('two live Escalation Status descriptors relay nothing', async () => {
  const lists = await visibilityFrom([
    { id: '9006221', name: 'Escalation Status', archived: false, visible_to_team_ids: ['1'] },
    { id: '9004092', name: 'Escalation Status', archived: false, visible_to_team_ids: ['2'] }
  ]);
  assert.deepEqual(lists, []);
});
