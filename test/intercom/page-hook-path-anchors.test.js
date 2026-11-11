'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { SUMMARY_URL } = require('../support/intercom-page-hook-harness');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL } = require('../support/temporary-notes-harness');

const STAMP = '2026-09-08T13:00:00.000Z';
const UUID = '9000b0a1-4c2e-4d7a-9e11-5a3f0c7d2b10';

function hookServing(bodyText) {
  return loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input) => {
      const url = typeof input === 'string' ? input : input.url;
      return Promise.resolve(makeIntercomResponse(bodyText, { url }));
    }
  });
}

async function kindsRelayed(bodyText, url, init, prepare) {
  const ctx = hookServing(bodyText);
  ctx.sendReady();
  if (prepare) prepare(ctx);
  await ctx.window.fetch(url, init);
  await delay(0);
  await delay(0);
  return ctx.posted.filter(m => m && typeof m.kind === 'string');
}

const ofKind = (messages, kind) => messages.filter(m => m.kind === kind);

const DESCRIPTORS = JSON.stringify([
  { id: '900641', name: 'Escalation Status', archived: false, visible_to_team_ids: ['900202'] }
]);

test('attribute descriptors: exact path relays escalation-status-visibility, a prefixed path relays nothing', async () => {
  const exact = await kindsRelayed(DESCRIPTORS, `${ORIGIN}/ember/conversation_attributes/descriptors?app_id=${WORKSPACE}`);
  const prefixed = await kindsRelayed(DESCRIPTORS, `${ORIGIN}/x/ember/conversation_attributes/descriptors?app_id=${WORKSPACE}`);
  assert.equal(ofKind(exact, 'escalation-status-visibility').length, 1);
  assert.equal(ofKind(prefixed, 'escalation-status-visibility').length, 0);
});

const COUNTS = JSON.stringify({ inboxes: [{ id: 'team-1', inbox_type: 'team', count: 4 }] });
const POLL = { method: 'POST' };

test('inbox counts poll: exact path is read on POST, a prefixed path is not', async () => {
  const exact = await kindsRelayed(COUNTS, `${ORIGIN}/ember/inbox/inboxes/inboxes?app_id=${WORKSPACE}`, POLL);
  const prefixed = await kindsRelayed(COUNTS, `${ORIGIN}/x/ember/inbox/inboxes/inboxes?app_id=${WORKSPACE}`, POLL);
  assert.equal(ofKind(exact, 'inbox-counts').length, 1);
  assert.equal(ofKind(prefixed, 'inbox-counts').length, 0);
});

test('inbox counts poll: exact path is read on POST, a suffixed path is not', async () => {
  const exact = await kindsRelayed(COUNTS, `${ORIGIN}/ember/inbox/inboxes/inboxes?app_id=${WORKSPACE}`, POLL);
  const suffixed = await kindsRelayed(COUNTS, `${ORIGIN}/ember/inbox/inboxes/inboxes/extra?app_id=${WORKSPACE}`, POLL);
  assert.equal(ofKind(exact, 'inbox-counts').length, 1);
  assert.equal(ofKind(suffixed, 'inbox-counts').length, 0);
});

function arm(ctx) {
  ctx.window.dispatchEvent(new ctx.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note',
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'anchor-token', revision: 1 },
    source: ctx.window,
    origin: ORIGIN
  }));
}

async function saveTo(path) {
  const url = `${ORIGIN}${path}?app_id=${WORKSPACE}`;
  const ctx = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => Promise.resolve(makeIntercomResponse(
      JSON.stringify({ id: 1, body: JSON.parse(init.body).body }), { url }))
  });
  ctx.sendReady();
  arm(ctx);
  await ctx.window.fetch(url, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' })
  });
  await delay(0);
  await delay(0);
  return ctx.posted.filter(m => m && typeof m.kind === 'string');
}

test('temporary note save: exact /ember/inbox/notes is the create request, a prefixed path is not', async () => {
  const exact = await saveTo('/ember/inbox/notes');
  const prefixed = await saveTo('/x/ember/inbox/notes');
  assert.equal(ofKind(exact, 'temporary-note-save').length, 1);
  assert.equal(ofKind(prefixed, 'temporary-note-save').length, 0);
});

const NOTES = JSON.stringify([{ id: 100, body: 'n100', created_at: STAMP, updated_at: STAMP }]);
const notesQuery = `app_id=${WORKSPACE}&ids[]=100`;

test('temporary note fetch: exact /ember/inbox/notes is observed, a prefixed path is not', async () => {
  const exact = await kindsRelayed(NOTES, `${ORIGIN}/ember/inbox/notes?${notesQuery}`);
  const prefixed = await kindsRelayed(NOTES, `${ORIGIN}/x/ember/inbox/notes?${notesQuery}`);
  assert.equal(ofKind(exact, 'temporary-note-notes').length, 1);
  assert.equal(ofKind(prefixed, 'temporary-note-notes').length, 0);
});

test('every relayed temporary-note envelope carries __isaic strictly true and version 1', async () => {
  const messages = [
    ...await saveTo('/ember/inbox/notes'),
    ...await kindsRelayed(NOTES, `${ORIGIN}/ember/inbox/notes?${notesQuery}`)
  ];
  const noteEnvelopes = messages.filter(m => m.kind.startsWith('temporary-note-'));
  const kinds = new Set(noteEnvelopes.map(m => m.kind));
  assert.ok(kinds.has('temporary-note-save') && kinds.has('temporary-note-notes'));
  for (const envelope of noteEnvelopes) {
    assert.strictEqual(envelope.__isaic, true, envelope.kind);
    assert.strictEqual(envelope.version, 1, envelope.kind);
  }
});

async function brandFor(value) {
  const body = JSON.stringify({
    state: 'open',
    attributes: [{ descriptor: { id: 9006335, name: 'Brand' }, value }]
  });
  const messages = await kindsRelayed(body, SUMMARY_URL);
  return ofKind(messages, 'conversation-company').map(m => m.company);
}

test('summary brand: a bare UUID in any case is an option id and is not relayed', async () => {
  assert.deepEqual(await brandFor(UUID), []);
  assert.deepEqual(await brandFor(UUID.toUpperCase()), []);
  assert.deepEqual(await brandFor('9e00a0b1-EF00-4000-8abc-900000000043'), []);
});

test('summary brand: a UUID with extra characters before or after is relayed as the brand', async () => {
  assert.deepEqual(await brandFor(`x${UUID}`), [`x${UUID}`]);
  assert.deepEqual(await brandFor(`${UUID}x`), [`${UUID}x`]);
  assert.deepEqual(await brandFor('alderpoint'), ['alderpoint']);
});
