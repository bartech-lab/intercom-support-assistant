'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONVERSATION_URL } = require('../support/temporary-notes-harness');

const STAMP = '2026-09-08T13:00:00.000Z';

function note(id, over = {}) {
  return { id, body: 'n' + id, created_at: STAMP, updated_at: STAMP, ...over };
}

async function envelopeFor(requestUrl, payload, kind) {
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse(JSON.stringify(payload), { url: requestUrl }))
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  await hook.window.fetch(requestUrl);
  await delay(0);
  await delay(0);
  return posted.find(item => item && item.kind === kind) || null;
}

const idsQuery = ids => ids.map(id => `ids%5B%5D=${id}`).join('&');
const notesUrl = ids => `${ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}&${idsQuery(ids)}`;

async function relayedNotes(ids, payload) {
  const message = await envelopeFor(notesUrl(ids), payload, 'temporary-note-notes');
  return message ? Array.from(message.notes, item => item.id) : null;
}

test('T1: a top-level note_ids list still relays when users holds a null entry', async () => {
  const userUrl = `${ORIGIN}/ember/users/900fcbb36062854afdf312d1?app_id=${WORKSPACE}`;
  const message = await envelopeFor(userUrl, { note_ids: ['111'], users: [null] }, 'temporary-note-contact');
  assert.ok(message, 'the contact envelope is posted');
  assert.deepEqual(Array.from(message.noteIds), ['111']);
});

test('T2: a note with a numeric created_at is not relayed while an ISO sibling is', async () => {
  const relayed = await relayedNotes(['100', '101'], [note(100, { created_at: 2026 }), note(101)]);
  assert.deepEqual(relayed, ['101']);
});

test('T2: a note with a numeric updated_at is not relayed while an ISO sibling is', async () => {
  const relayed = await relayedNotes(['100', '101'], [note(100, { updated_at: 2026 }), note(101)]);
  assert.deepEqual(relayed, ['101']);
});

test('T3: 200 requested ids with 201 valid notes relays exactly the first 200 in response order', async () => {
  const ids = Array.from({ length: 200 }, (_, index) => String(index + 1));
  const payload = ids.map(id => note(id)).concat([note('200')]);
  const relayed = await relayedNotes(ids, payload);
  assert.equal(relayed.length, 200);
  assert.deepEqual(relayed, ids);
});
