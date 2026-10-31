'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const STAMP = '2026-09-08T13:00:00.000Z';

function note(id) {
  return { id, body: 'n' + id, created_at: STAMP, updated_at: STAMP };
}

async function relay(requestUrl, notes, init) {
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse(JSON.stringify(notes), { url: requestUrl }))
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  await hook.window.fetch(requestUrl, init);
  await delay(0);
  await delay(0);
  const message = posted.find(item => item && item.kind === 'temporary-note-notes');
  return message ? Array.from(message.notes, item => item.id) : null;
}

const idsQuery = ids => ids.map(id => `ids%5B%5D=${id}`).join('&');
const notesUrl = (ids, app = WORKSPACE, path = '/ember/inbox/notes') =>
  `${ORIGIN}${path}?${app === null ? '' : `app_id=${app}&`}${idsQuery(ids)}`;

test('a note-read path that is not exactly /ember/inbox/notes relays nothing', async () => {
  assert.deepEqual(await relay(notesUrl(['100'], WORKSPACE, '/ember/inbox/notes'), [note(100)]), ['100']);
  assert.equal(await relay(notesUrl(['100'], WORKSPACE, '/ember/inbox/notes/extra'), [note(100)]), null);
  assert.equal(await relay(notesUrl(['100'], WORKSPACE, '/ember/inbox/notesx'), [note(100)]), null);
});

test('a missing or invalid app_id relays nothing', async () => {
  assert.equal(await relay(notesUrl(['100'], null), [note(100)]), null);
  assert.equal(await relay(notesUrl(['100'], ''), [note(100)]), null);
  assert.equal(await relay(notesUrl(['100'], 'bad%20id!'), [note(100)]), null);
});

test('requested ids that are not 1 to 32 digits are ignored while valid ones still relay', async () => {
  const long33 = '1'.repeat(33);
  const long32 = '2'.repeat(32);
  const url = notesUrl(['abc', '12a', long33, long32, '100']);
  const relayed = await relay(url, [note('abc'), note('12a'), note(long33), note(long32), note(100)]);
  assert.deepEqual(relayed, [long32, '100']);
});

test('a duplicated requested id is relayed once', async () => {
  const relayed = await relay(notesUrl(['100', '100']), [note(100)]);
  assert.deepEqual(relayed, ['100']);
});

test('only the first 200 requested ids are honoured', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => String(index + 1));
  const relayed = await relay(notesUrl(ids), [note(200), note(201)]);
  assert.deepEqual(relayed, ['200']);
});

test('ignored ids do not use up the 200-id cap', async () => {
  const ids = Array.from({ length: 200 }, (_, index) => `x${index}`).concat(['500']);
  assert.deepEqual(await relay(notesUrl(ids), [note(500)]), ['500']);
});

test('repeated ids count once toward the 200-id cap', async () => {
  const ids = Array.from({ length: 200 }, () => '7').concat(['500']);
  assert.deepEqual(await relay(notesUrl(ids), [note(7), note(500)]), ['7', '500']);
});

test('a single requested id relays and the second of two requested ids relays too', async () => {
  assert.deepEqual(await relay(notesUrl(['100']), [note(100)]), ['100']);
  assert.deepEqual(await relay(notesUrl(['100', '200']), [note(200)]), ['200']);
});

test('a POST to the note endpoint with valid read parameters relays nothing', async () => {
  const relayed = await relay(notesUrl(['100']), [note(100)], { method: 'POST', body: '{}' });
  assert.equal(relayed, null);
});

async function armedSave(call, { cloneHook } = {}) {
  const requests = [];
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push({ input, init });
      const text = init && typeof init.body === 'string' ? init.body : input.body;
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(text).body }), { url: CREATE_URL }));
    }
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note',
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-req', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));
  let outcome;
  try {
    outcome = { value: await call(hook.window.fetch.bind(hook.window)) };
  } catch (error) {
    outcome = { error };
  }
  await delay(0);
  const save = posted.filter(message => message && message.kind === 'temporary-note-save').shift();
  return { requests, save, outcome };
}

const PLAIN = JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' });

function sentBody(requests) {
  const { input, init } = requests[0];
  return init && typeof init.body === 'string' ? init.body : input.body;
}

function assertFooter(result) {
  assert.equal(result.requests.length, 1);
  const parsed = JSON.parse(sentBody(result.requests));
  assert.match(parsed.body, /ISA-AUTO-DELETE/);
  assert.ok(parsed.body.startsWith('temporary note'));
}

function assertBlocked(result) {
  assert.ok(result.outcome.error, 'the fetch promise rejects');
  assert.deepEqual(result.requests, [], 'the network is never called');
  assert.equal(result.save && result.save.status, 'blocked');
  assert.equal(result.save && result.save.reason, 'request-body-unreadable');
}

test('an armed save reads the body through clone().text() when the request has no string body', async () => {
  const result = await armedSave(f => f({
    url: CREATE_URL,
    method: 'POST',
    clone: () => ({ text: async () => PLAIN })
  }));
  assertFooter(result);
});

const unreadable = {
  'a non-string init body': f => f(CREATE_URL, { method: 'POST', body: { not: 'text' } }),
  'a FormData-like init body': f => f(CREATE_URL, { method: 'POST', body: { append() {}, entries() { return []; } } }),
  'a request with neither a string body nor a clone function': f => f({ url: CREATE_URL, method: 'POST' }),
  'a clone that throws': f => f({ url: CREATE_URL, method: 'POST', clone() { throw new Error('no clone'); } }),
  'a clone result without a text function': f => f({ url: CREATE_URL, method: 'POST', clone: () => ({}) }),
  'a clone text that rejects': f => f({ url: CREATE_URL, method: 'POST', clone: () => ({ text: () => Promise.reject(new Error('gone')) }) }),
  'a clone text that resolves to an object': f => f({ url: CREATE_URL, method: 'POST', clone: () => ({ text: async () => ({ body: PLAIN }) }) })
};

for (const [name, call] of Object.entries(unreadable)) {
  test(`an armed save is blocked as unreadable for ${name}`, async () => {
    assertBlocked(await armedSave(call));
  });
}

test('an init with a body key wins over the request object body, in both directions', async () => {
  const blocked = await armedSave(f => f({ url: CREATE_URL, method: 'POST', body: PLAIN }, { method: 'POST', body: { not: 'text' } }));
  assertBlocked(blocked);

  const saved = await armedSave(f => f({ url: CREATE_URL, method: 'POST' }, { method: 'POST', body: PLAIN }));
  assertFooter(saved);
});
