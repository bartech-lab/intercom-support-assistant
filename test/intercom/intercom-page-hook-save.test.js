'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const MAX_RESPONSE_CHARS = 200000 * 6 + 4096;

const DRAFT = 'temporary note';
const TOKEN = 'save-token-1';
const STAMP = '2026-09-08T13:00:00.000Z';

function makeHook(fetchImpl) {
  const timers = new Map();
  let nextTimer = 1;
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl,
    beforeScripts: (win) => {
      win.setTimeout = (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, ms }); return id; };
      win.clearTimeout = (id) => { timers.delete(id); };
    }
  });
  hook.sendReady();
  const fireTimers = () => [...timers.values()].forEach(timer => timer.callback());
  return { ...hook, timers, fireTimers };
}

function arm(hook, { draft = DRAFT, token = TOKEN, revision = 1 } = {}) {
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft,
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token, revision },
    source: hook.window,
    origin: ORIGIN
  }));
}

function postNote(hook, body = DRAFT, extra = {}) {
  return hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body, ...extra })
  });
}

const savesOf = hook => hook.posted.filter(message => message && message.kind === 'temporary-note-save');

function sentOf(requests, index = 0) {
  return JSON.parse(requests[index].init.body);
}

function footerOf(sent) {
  return sent.body.slice(DRAFT.length + 2);
}

async function save(respond, { status = 200 } = {}) {
  const requests = [];
  const hook = makeHook((input, init) => {
    requests.push({ input, init });
    return respond(JSON.parse(init.body), status, requests.length);
  });
  arm(hook);
  const outcome = {};
  try {
    outcome.value = await postNote(hook);
  } catch (error) {
    outcome.error = error;
  }
  await delay(0);
  await delay(0);
  return { hook, requests, outcome, saves: savesOf(hook), sent: requests[0] && sentOf(requests) };
}

const echo = (mutate = body => body, status = 200) => async (sent) =>
  makeIntercomResponse(JSON.stringify({ id: 1, body: mutate(sent.body) }), { url: CREATE_URL, status });

function assertSingle(result, status, reason) {
  assert.equal(result.saves.length, 1, 'exactly one verdict is posted');
  assert.equal(result.saves[0].status, status);
  assert.equal(result.saves[0].reason, reason);
  assert.equal(result.saves[0].token, TOKEN);
  assert.equal(result.saves[0].revision, 1);
}

test('the armed save is sent with the footer as the last text of the body', async () => {
  const result = await save(echo());
  assert.ok(result.sent.body.startsWith(`${DRAFT}\n\n`));
  assert.match(footerOf(result.sent), /\[ISA-AUTO-DELETE:v1;[^\]]*;token=save-token-1\]$/);
});

for (const status of [200, 299]) {
  test(`HTTP ${status} echoing the footer at the end is a success`, async () => {
    const result = await save(echo(body => body, status));
    assertSingle(result, 'success', undefined);
    assert.equal(result.outcome.value.status, status, 'the server response is returned unchanged');
  });
}

test('a successful save consumes the arm, so the next identical POST goes out unchanged', async () => {
  const result = await save(echo());
  assertSingle(result, 'success', undefined);
  await postNote(result.hook);
  assert.equal(result.requests.length, 2);
  assert.equal(sentOf(result.requests, 1).body, DRAFT);
});

test('text after the footer in the response is uncertain, because the footer is not last', async () => {
  const result = await save(echo(body => `${body} trailing`));
  assertSingle(result, 'uncertain', 'response-footer');
  assert.equal(result.outcome.value.status, 200);
});

test('a response body with the footer removed entirely is uncertain', async () => {
  const result = await save(echo(() => DRAFT));
  assertSingle(result, 'uncertain', 'response-footer');
});

test('a response body that ends with a footer carrying a different token is uncertain', async () => {
  const result = await save(echo(body => body.replace(`token=${TOKEN}`, 'token=other-token')));
  assertSingle(result, 'uncertain', 'response-footer');
});

test('a 2xx response that is not JSON is uncertain', async () => {
  const result = await save(async () => makeIntercomResponse('<html>ok</html>', { url: CREATE_URL }));
  assertSingle(result, 'uncertain', 'response-footer');
});

test('a 2xx response with an empty text is uncertain', async () => {
  const result = await save(async () => makeIntercomResponse('', { url: CREATE_URL }));
  assertSingle(result, 'uncertain', 'response-footer');
});

test('a 2xx response of exactly the 1,204,096-character cap is still read', async () => {
  const result = await save(async (sent) => {
    const wrapper = JSON.stringify({ body: '' }).length;
    const padding = 'x'.repeat(MAX_RESPONSE_CHARS - wrapper - JSON.stringify(sent.body).length + 2);
    const text = JSON.stringify({ body: padding + sent.body });
    assert.equal(text.length, MAX_RESPONSE_CHARS);
    return makeIntercomResponse(text, { url: CREATE_URL });
  });
  assertSingle(result, 'success', undefined);
});

test('a 2xx response one character over the cap is unreadable and uncertain', async () => {
  const result = await save(async (sent) => {
    const wrapper = JSON.stringify({ body: '' }).length;
    const padding = 'x'.repeat(MAX_RESPONSE_CHARS + 1 - wrapper - JSON.stringify(sent.body).length + 2);
    const text = JSON.stringify({ body: padding + sent.body });
    assert.equal(text.length, MAX_RESPONSE_CHARS + 1);
    return makeIntercomResponse(text, { url: CREATE_URL });
  });
  assertSingle(result, 'uncertain', 'response-footer');
});

for (const [name, text] of [['an array', '[]'], ['null', 'null'], ['an object with a numeric body', '{"body":5}'], ['an object without a body', '{"id":1}']]) {
  test(`a 2xx response that is ${name} is uncertain with a shape reason`, async () => {
    const result = await save(async () => makeIntercomResponse(text, { url: CREATE_URL }));
    assertSingle(result, 'uncertain', 'response-shape');
  });
}

const brokenClones = {
  'has no clone function': () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => '{}' }),
  'has a clone that throws': () => makeIntercomResponse('{}', { url: CREATE_URL, cloneThrows: true }),
  'has a clone without text': () => ({ status: 200, ok: true, headers: { get: () => null }, clone: () => ({}) })
};
for (const [name, make] of Object.entries(brokenClones)) {
  test(`a 2xx response that ${name} is uncertain and still returned to the caller`, async () => {
    const result = await save(async () => make());
    assertSingle(result, 'uncertain', 'response-footer');
    assert.equal(result.outcome.value.status, 200);
  });
}

for (const [status, verdict, reason] of [
  [199, 'uncertain', 'http-199'],
  [300, 'uncertain', 'http-300'],
  [400, 'failed', 'http-400'],
  [499, 'failed', 'http-499'],
  [500, 'uncertain', 'http-500']
]) {
  test(`HTTP ${status} posts ${verdict} with reason ${reason} and returns the response`, async () => {
    const result = await save(async () => makeIntercomResponse('{"errors":[]}', { url: CREATE_URL, status }));
    assertSingle(result, verdict, reason);
    assert.equal(result.outcome.value.status, status);
  });
}

test('a rejected fetch is uncertain with a network reason and the same error reaches the caller', async () => {
  const failure = new Error('offline');
  const result = await save(() => Promise.reject(failure));
  assertSingle(result, 'uncertain', 'network');
  assert.equal(result.outcome.error, failure);
});

test('a fetch that throws synchronously is uncertain with a network reason and rejects the caller', async () => {
  const failure = new Error('sync boom');
  const result = await save(() => { throw failure; });
  assertSingle(result, 'uncertain', 'network');
  assert.ok(result.outcome.error, 'the caller promise rejects');
});

test('a save with no response for 15000 ms is uncertain, and a later 500 posts no second uncertain', async () => {
  const requests = [];
  let release;
  const hook = makeHook((input, init) => {
    requests.push({ input, init });
    return new Promise((resolve) => { release = resolve; });
  });
  arm(hook);
  const pending = postNote(hook);
  const caught = pending.then(() => null, error => error);
  await delay(0);
  assert.ok([...hook.timers.values()].some(timer => timer.ms === 15000), 'a 15000 ms timeout is scheduled');
  hook.fireTimers();
  const error = await caught;
  assert.match(error.message, /reconciliation is required/);
  await delay(0);
  assert.equal(savesOf(hook).length, 1);
  assert.equal(savesOf(hook)[0].status, 'uncertain');
  assert.equal(savesOf(hook)[0].reason, 'timeout');

  release(makeIntercomResponse('{}', { url: CREATE_URL, status: 500 }));
  await delay(0);
  await delay(0);
  assert.equal(savesOf(hook).length, 1, 'no second uncertain after the timeout');
});

test('a save that timed out and then receives a valid echo posts success afterwards', async () => {
  let release;
  let sent;
  const hook = makeHook((input, init) => {
    sent = JSON.parse(init.body);
    return new Promise((resolve) => { release = resolve; });
  });
  arm(hook);
  const caught = postNote(hook).then(() => null, error => error);
  await delay(0);
  hook.fireTimers();
  await caught;
  await delay(0);
  assert.equal(savesOf(hook)[0].reason, 'timeout');

  release(makeIntercomResponse(JSON.stringify({ id: 1, body: sent.body }), { url: CREATE_URL }));
  await delay(0);
  await delay(0);
  const verdicts = savesOf(hook).map(message => message.status);
  assert.deepEqual(verdicts, ['uncertain', 'success']);
});

test('a POST whose body does not match the armed draft is blocked and never sent', async () => {
  const requests = [];
  const hook = makeHook((input, init) => { requests.push(init); return Promise.resolve(makeIntercomResponse('{}')); });
  arm(hook);
  await assert.rejects(postNote(hook, 'a different note'), /does not match the armed draft/);
  await delay(0);
  assert.deepEqual(requests, []);
  assert.equal(savesOf(hook).length, 1);
  assert.equal(savesOf(hook)[0].status, 'blocked');
  assert.equal(savesOf(hook)[0].reason, 'request-mismatch');
});

test('the outgoing body keeps model_id and forces is_company to boolean false', async () => {
  const requests = [];
  const hook = makeHook((input, init) => {
    requests.push(init);
    return Promise.resolve(makeIntercomResponse(JSON.stringify({ body: JSON.parse(init.body).body }), { url: CREATE_URL }));
  });
  arm(hook);
  await postNote(hook);
  const sent = JSON.parse(requests[0].body);
  assert.equal(sent.model_id, CONTACT);
  assert.strictEqual(sent.is_company, false);
});

function respondWith(payload, { date, url } = {}) {
  const headers = {
    get(name) {
      const key = String(name).toLowerCase();
      if (key === 'date') return date === undefined ? null : date;
      if (key === 'content-type') return 'application/json; charset=utf-8';
      return null;
    }
  };
  return makeResponse(JSON.stringify(payload), headers, url);
}

function makeResponse(text, headers, url) {
  return {
    status: 200,
    ok: true,
    url,
    headers,
    clone() { return { status: 200, url, headers, text: async () => text }; },
    text: async () => text
  };
}

async function relayKind(kind, url, payload, opts) {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(respondWith(payload, { ...opts, url }))
  });
  hook.sendReady();
  await hook.window.fetch(url);
  await delay(0);
  await delay(0);
  return hook.posted.filter(message => message && message.kind === kind);
}

const CONTACT_URL = `${ORIGIN}/ember/users/${CONTACT}?app_id=${WORKSPACE}`;

async function contactIds(payload, opts) {
  const messages = await relayKind('temporary-note-contact', CONTACT_URL, payload, opts);
  return messages.length ? Array.from(messages[0].noteIds) : null;
}

test('contact references are read from note_ids and notes at the root and in users[0]', async () => {
  assert.deepEqual(await contactIds({ note_ids: ['11'] }), ['11']);
  assert.deepEqual(await contactIds({ notes: [{ id: '12' }] }), ['12']);
  assert.deepEqual(await contactIds({ users: [{ note_ids: ['13'] }] }), ['13']);
  assert.deepEqual(await contactIds({ users: [{ notes: [{ id: '14' }] }] }), ['14']);
  assert.deepEqual(await contactIds({ note_ids: ['21'], notes: [{ id: '22' }] }), ['21', '22'], 'both keys are read');
});

test('bare numeric and digit-string ids at the root are relayed as strings, objects by their id', async () => {
  const ids = await contactIds({ note_ids: [101, '102'], notes: [{ id: 103 }, { id: '104' }] });
  assert.deepEqual(ids, ['101', '102', '103', '104']);
  assert.ok(ids.every(id => typeof id === 'string'));
});

test('ids that are not 1 to 32 digits are dropped, as are null entries and null ids', async () => {
  const long32 = '7'.repeat(32);
  const ids = await contactIds({
    note_ids: ['abc', '12a', '', '9'.repeat(33), long32, null, undefined, 5],
    notes: [{ id: null }, null, { id: '-3' }, { id: '6' }]
  });
  assert.deepEqual(ids, [long32, '5', '6']);
});

test('duplicate ids are relayed once', async () => {
  assert.deepEqual(await contactIds({ note_ids: ['1', 1, '1'], notes: [{ id: 1 }, { id: '2' }] }), ['1', '2']);
});

test('exactly 200 valid ids are all relayed and a 201st is dropped', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => String(index + 1));
  const relayed = await contactIds({ note_ids: ids });
  assert.equal(relayed.length, 200);
  assert.equal(relayed[0], '1');
  assert.equal(relayed[199], '200');
  const exact = await contactIds({ note_ids: ids.slice(0, 200) });
  assert.equal(exact.length, 200);
});

test('no valid id means no contact message', async () => {
  assert.equal(await contactIds({ note_ids: ['x', null], notes: [{ id: null }] }), null);
  assert.equal(await contactIds({}), null);
});

test('serverDate is the Date header as an ISO string, or null when missing or unparsable', async () => {
  const dated = await relayKind('temporary-note-contact', CONTACT_URL, { note_ids: ['1'] }, { date: 'Tue, 08 Sep 2026 13:00:00 GMT' });
  assert.equal(dated[0].serverDate, STAMP);
  const missing = await relayKind('temporary-note-contact', CONTACT_URL, { note_ids: ['1'] });
  assert.equal(missing[0].serverDate, null);
  const bad = await relayKind('temporary-note-contact', CONTACT_URL, { note_ids: ['1'] }, { date: 'not a date' });
  assert.equal(bad[0].serverDate, null);
});

test('users[0] is read only when users is an array', async () => {
  assert.equal(await contactIds({ users: { 0: { note_ids: ['1'] } } }), null);
  assert.equal(await contactIds({ users: 'x' }), null);
  assert.deepEqual(await contactIds({ users: [{ note_ids: ['1'] }, { note_ids: ['2'] }] }), ['1'], 'only the first user is read');
});

const idsQuery = ids => ids.map(id => `ids%5B%5D=${id}`).join('&');
const notesUrl = ids => `${ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}&${idsQuery(ids)}`;
const note = (id, extra = {}) => ({ id, body: `n${id}`, created_at: STAMP, updated_at: STAMP, ...extra });

async function noteIds(requested, payload, opts) {
  const messages = await relayKind('temporary-note-notes', notesUrl(requested), payload, opts);
  return messages.length ? Array.from(messages[0].notes, item => item.id) : null;
}

test('only requested notes with a string body and parseable timestamps are relayed', async () => {
  const ids = await noteIds(['1', '2', '3', '4', '5'], [
    note(1),
    note(9),
    note(2, { body: 5 }),
    note(3, { created_at: 'garbage' }),
    note(4, { updated_at: 'garbage' }),
    note(5)
  ]);
  assert.deepEqual(ids, ['1', '5']);
});

test('camelCase timestamps are accepted and an empty-string timestamp drops the note', async () => {
  const camel = { id: 1, body: 'b', createdAt: STAMP, updatedAt: STAMP };
  assert.deepEqual(await noteIds(['1', '2', '3'], [
    camel,
    note(2, { created_at: '' }),
    note(3, { updated_at: '' })
  ]), ['1']);
  assert.deepEqual(await noteIds(['1'], [{ id: 1, body: 'b', createdAt: '', updatedAt: STAMP }]), null);
});

test('note ids compare as strings, a missing id is dropped, and a null entry does not stop later notes', async () => {
  const ids = await noteIds(['0', '7'], [null, { body: 'b', created_at: STAMP, updated_at: STAMP }, note(0), null, note('7')]);
  assert.deepEqual(ids, ['0', '7']);
});

test('a string or number payload relays no notes', async () => {
  assert.equal(await noteIds(['1'], 'text'), null);
  assert.equal(await noteIds(['1'], 5), null);
});

test('at most 200 notes are relayed', async () => {
  const ids = Array.from({ length: 200 }, (_, index) => String(index + 1));
  const payload = Array.from({ length: 201 }, (_, index) => note(index + 1));
  const relayed = await noteIds(ids, payload);
  assert.equal(relayed.length, 200);
  assert.ok(!relayed.includes('201'));
});

test('note-read serverDate is the Date header as ISO, or null when missing or unparsable', async () => {
  const get = opts => relayKind('temporary-note-notes', notesUrl(['1']), [note(1)], opts);
  assert.equal((await get({ date: 'Tue, 08 Sep 2026 13:00:00 GMT' }))[0].serverDate, STAMP);
  assert.equal((await get())[0].serverDate, null);
  assert.equal((await get({ date: 'nope' }))[0].serverDate, null);
});
