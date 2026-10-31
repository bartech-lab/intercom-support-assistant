'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { JSDOM } = require('jsdom');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL } = require('../support/temporary-notes-harness');

const TOKEN = 'arm-test-0001';
const REPLY_KINDS = ['temporary-note-armed', 'temporary-note-save'];
const STAMP = '2026-09-08T13:00:00.000Z';
const SERVER_DATE = 'Wed, 21 Oct 2026 07:28:00 GMT';

function freshHook() {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}'))
  });
  hook.sendReady();
  return hook;
}

function armData(overrides = {}) {
  return {
    __isaTempNote: true,
    kind: 'arm',
    workspace: WORKSPACE,
    contact: CONTACT,
    draft: 'note',
    lifetime: { mode: 'relative', delayMs: 86400000 },
    token: TOKEN,
    revision: 1,
    ...overrides
  };
}

function disarmData(overrides = {}) {
  return { __isaTempNote: true, kind: 'disarm', workspace: WORKSPACE, contact: CONTACT, token: TOKEN, revision: 2, ...overrides };
}

async function dispatch(hook, data, { source = hook.window, origin = ORIGIN } = {}) {
  const before = hook.posted.length;
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', { data, source, origin }));
  await delay(0);
  return hook.posted.slice(before).filter(message => message && REPLY_KINDS.includes(message.kind));
}

function withDate(response, dateValue) {
  const headers = {
    get(name) {
      return String(name).toLowerCase() === 'date' ? dateValue : response.headers.get(name);
    }
  };
  return {
    status: response.status,
    ok: response.ok,
    url: response.url,
    headers,
    clone() {
      const cloned = response.clone();
      return { status: cloned.status, url: cloned.url, headers, text: () => cloned.text() };
    }
  };
}

async function relay(requestUrl, payload, dateValue, kind) {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => {
      const response = makeIntercomResponse(JSON.stringify(payload), { url: requestUrl });
      return Promise.resolve(dateValue === undefined ? response : withDate(response, dateValue));
    }
  });
  hook.sendReady();
  await hook.window.fetch(requestUrl);
  await delay(0);
  await delay(0);
  return hook.posted.find(item => item && item.kind === kind) || null;
}

const idsQuery = ids => ids.map(id => `ids%5B%5D=${id}`).join('&');
const notesUrl = ids => `${ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}&${idsQuery(ids)}`;
const userUrl = `${ORIGIN}/ember/users/900fcbb36062854afdf312d1?app_id=${WORKSPACE}`;

function note(id, over = {}) {
  return { id, body: 'n' + id, created_at: STAMP, updated_at: STAMP, ...over };
}

test('an arm whose source is a different JSDOM window gets no reply', async () => {
  const other = new JSDOM('<body></body>', { url: CONVERSATION_URL }).window;
  assert.deepEqual(await dispatch(freshHook(), armData(), { source: other }), []);
});

test('an arm with a null source gets no reply', async () => {
  assert.deepEqual(await dispatch(freshHook(), armData(), { source: null }), []);
});

test('a disarm whose source is a different JSDOM window gets no reply', async () => {
  const other = new JSDOM('<body></body>', { url: CONVERSATION_URL }).window;
  assert.deepEqual(await dispatch(freshHook(), disarmData(), { source: other }), []);
});

test('an arm from the page window with origin https://evil.example gets no reply', async () => {
  assert.deepEqual(await dispatch(freshHook(), armData(), { origin: 'https://evil.example' }), []);
});

test('a disarm from the page window with origin https://evil.example gets no reply', async () => {
  assert.deepEqual(await dispatch(freshHook(), disarmData(), { origin: 'https://evil.example' }), []);
});

test('an arm with an empty origin gets no reply', async () => {
  assert.deepEqual(await dispatch(freshHook(), armData(), { origin: '' }), []);
});

test('a rejected foreign message does not change the state for a later valid arm', async () => {
  const hook = freshHook();
  await dispatch(hook, armData({ token: 'foreign-token-1' }), { origin: 'https://evil.example' });
  const replies = await dispatch(hook, armData({ token: 'genuine-token-1', revision: 3 }));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].token, 'genuine-token-1');
  assert.equal(replies[0].revision, 3);
});

test('a well-formed message with kind save or other gets no reply', async () => {
  for (const kind of ['save', 'other']) {
    assert.deepEqual(await dispatch(freshHook(), armData({ kind })), [], kind);
  }
});

test('an arm for another workspace is blocked with workspace-mismatch and echoes the token and revision', async () => {
  const replies = await dispatch(freshHook(), armData({ workspace: 'otherws1', token: 'mismatch-token-1', revision: 9 }));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].kind, 'temporary-note-armed');
  assert.equal(replies[0].status, 'blocked');
  assert.equal(replies[0].reason, 'workspace-mismatch');
  assert.equal(replies[0].token, 'mismatch-token-1');
  assert.equal(replies[0].revision, 9);
});

test('a disarm for another workspace is a blocked temporary-note-save with workspace-mismatch', async () => {
  const hook = freshHook();
  await dispatch(hook, armData());
  const replies = await dispatch(hook, disarmData({ workspace: 'otherws1', token: 'mismatch-token-2', revision: 11 }));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].kind, 'temporary-note-save');
  assert.equal(replies[0].status, 'blocked');
  assert.equal(replies[0].reason, 'workspace-mismatch');
  assert.equal(replies[0].token, 'mismatch-token-2');
  assert.equal(replies[0].revision, 11);
});

test('a note list of 205 requested valid notes is relayed as the first 200 in input order', async () => {
  const ids = Array.from({ length: 205 }, (_, index) => String(index + 1));
  const message = await relay(notesUrl(ids), ids.map(id => note(id)), undefined, 'temporary-note-notes');
  assert.ok(message, 'the notes message is posted');
  assert.equal(message.notes.length, 200);
  assert.deepEqual(Array.from(message.notes, item => item.id), ids.slice(0, 200));
});

test('the notes message carries the Date header as an ISO serverDate', async () => {
  const message = await relay(notesUrl(['100']), [note(100)], SERVER_DATE, 'temporary-note-notes');
  assert.equal(message.serverDate, '2026-10-21T07:28:00.000Z');
});

test('the notes message serverDate is null when the Date header is missing or not a date', async () => {
  for (const value of [undefined, null, 'not a date', '']) {
    const message = await relay(notesUrl(['100']), [note(100)], value, 'temporary-note-notes');
    assert.ok(message, `message for ${JSON.stringify(value)}`);
    assert.equal(message.serverDate, null, `Date ${JSON.stringify(value)}`);
  }
});

test('the contact message carries the Date header as an ISO serverDate', async () => {
  const message = await relay(userUrl, { note_ids: ['111'], users: [null] }, SERVER_DATE, 'temporary-note-contact');
  assert.ok(message, 'the contact message is posted');
  assert.equal(message.serverDate, '2026-10-21T07:28:00.000Z');
});

test('the contact message serverDate is null when the Date header is missing or not a date', async () => {
  for (const value of [undefined, null, 'not a date']) {
    const message = await relay(userUrl, { note_ids: ['111'], users: [null] }, value, 'temporary-note-contact');
    assert.ok(message, `message for ${JSON.stringify(value)}`);
    assert.equal(message.serverDate, null, `Date ${JSON.stringify(value)}`);
  }
});
