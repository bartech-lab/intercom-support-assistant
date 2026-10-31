'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { CONVERSATION_ID, SUMMARY_URL, STREAM_URL, hookWith, relayed } = require('../support/intercom-page-hook-harness');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const ofKind = (envelopes, kind) => envelopes.filter(e => e.kind === kind);

async function observe(payload) {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(JSON.stringify(payload), { url: SUMMARY_URL }) });
  return (await relayed(ctx, SUMMARY_URL)).envelopes;
}

test('conversation state in upper case is relayed lower-cased, like the lower-case state', async () => {
  const upper = ofKind(await observe({ state: 'OPEN', attributes: [] }), 'conversation-state');
  const lower = ofKind(await observe({ state: 'open', attributes: [] }), 'conversation-state');
  assert.equal(upper.length, 1);
  assert.equal(upper[0].state, 'open');
  assert.equal(lower.length, 1);
  assert.equal(lower[0].state, 'open');
});

test('a conversation state that is not letters or underscore relays no state', async () => {
  assert.equal(ofKind(await observe({ state: 'op en', attributes: [] }), 'conversation-state').length, 0);
});

const withOptions = (option) => observe({
  state: 'open',
  attributes: [{
    descriptor: { id: 'language', name: 'Language', options: [{ id: 'opt-a', label: 'de', name: 'de', value: 'de' }, { id: 'opt-b', ...option }] },
    value: 'opt-b'
  }]
});

test('a summary option relays its label ahead of its name and value', async () => {
  const languages = ofKind(await withOptions({ label: 'French', name: 'Francais', value: 'fr' }), 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'French');
});

test('a summary option without a label relays its name ahead of its value', async () => {
  const languages = ofKind(await withOptions({ name: 'Francais', value: 'fr' }), 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'Francais');
});

const part = (id, value, createdAt) => ({
  id,
  conversation_id: Number(CONVERSATION_ID),
  created_at: createdAt,
  renderable_type: 14,
  renderable_data: { attribute_summary: { id: 'language', name: 'Language' }, value }
});

async function streamLanguages(parts) {
  const body = JSON.stringify({
    id: Number(CONVERSATION_ID),
    renderable_parts: [{ id: 1, renderable_type: 2, renderable_data: { body: 'Hello' } }, ...parts]
  });
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  return ofKind(envelopes, 'conversation-language').map(e => e.language);
}

test('stream parts with non-numeric ids are ordered by created_at, whatever the array order', async () => {
  const older = part('part-b', 'French', '2026-08-01T10:00:00.000Z');
  const newer = part('part-a', 'German', '2026-08-12T10:00:00.000Z');
  assert.deepEqual(await streamLanguages([older, newer]), ['German']);
  assert.deepEqual(await streamLanguages([newer, older]), ['German']);
});

async function armedBody(draft) {
  const requests = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push(init);
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(init.body).body }), { url: CREATE_URL }));
    }
  });
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft,
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-pin', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));
  await hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: draft })
  });
  await delay(0);
  assert.equal(requests.length, 1);
  return JSON.parse(requests[0].body).body;
}

test('a temporary note save with an empty draft sends the footer with no leading blank lines', async () => {
  const body = await armedBody('');
  assert.match(body, /ISA-AUTO-DELETE/);
  assert.equal(body.startsWith('\n'), false);
});

test('a temporary note save with a draft separates it from the footer by one blank line', async () => {
  const empty = await armedBody('');
  const body = await armedBody('hi');
  assert.ok(body.startsWith('hi\n\n'));
  const timeless = (text) => text.replace(/^Auto-delete after: .*$/m, '').replace(/expires=[^;\]]+/, '');
  assert.equal(timeless(body.slice('hi\n\n'.length)), timeless(empty));
});

async function saveWithCompanyField(isCompany) {
  const requests = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push(init);
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(init.body).body }), { url: CREATE_URL }));
    }
  });
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'hi',
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-pin', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));
  const payload = { model_id: CONTACT, body: 'hi' };
  if (isCompany !== undefined) payload.is_company = isCompany;
  const outcome = await hook.window.fetch(CREATE_URL, { method: 'POST', body: JSON.stringify(payload) }).then(() => 'sent', () => 'rejected');
  await delay(0);
  return { outcome, footed: requests.filter((init) => /ISA-AUTO-DELETE/.test(JSON.parse(init.body).body)).length };
}

test('a temporary note save is rewritten only when the request says is_company false', async () => {
  assert.deepEqual(await saveWithCompanyField(false), { outcome: 'sent', footed: 1 });
  for (const value of [undefined, null, 'false', 0]) {
    assert.deepEqual(await saveWithCompanyField(value), { outcome: 'rejected', footed: 0 }, String(value));
  }
});
