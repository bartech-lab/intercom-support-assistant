'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL } = require('../support/temporary-notes-harness');

const NOTE_UUID = 'aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa';
const EXPIRES = '2026-09-09T07:55:12.120Z';
const FOOTER = 'Auto-delete after: 2026-09-09 07:55 UTC\n'
  + `[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT};expires=${EXPIRES};token=${NOTE_UUID}]`;
const NOTE = '900661995';
const PUT_URL = id => `${ORIGIN}/ember/inbox/notes/${id}?app_id=${WORKSPACE}`;

function setup(respond) {
  const calls = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      calls.push({ input, init });
      return respond ? respond(input, init, calls.length) : Promise.resolve(makeIntercomResponse('{}'));
    }
  });
  hook.sendReady();
  hook.calls = calls;
  return hook;
}

function keepData(overrides = {}) {
  return {
    __isaTempNote: true,
    kind: 'edit-keep',
    workspace: WORKSPACE,
    contact: CONTACT,
    noteId: NOTE,
    token: NOTE_UUID,
    expiresAt: EXPIRES,
    ...overrides
  };
}

async function send(hook, data) {
  const before = hook.posted.length;
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', { data, source: hook.window, origin: ORIGIN }));
  await delay(0);
  return hook.posted.slice(before);
}

const editReplies = messages => messages.filter(item => item && item.kind === 'temporary-note-edit')
  .map(item => ({ ...item }));

async function put(hook, id, body, { url = PUT_URL(id), method = 'PUT' } = {}) {
  const before = hook.posted.length;
  const init = { method, body: typeof body === 'string' ? body : JSON.stringify(body) };
  const result = await hook.window.fetch(url, init).then(response => ({ response }), error => ({ error }));
  await delay(0);
  await delay(0);
  return { ...result, init, replies: editReplies(hook.posted.slice(before)) };
}

const sentBody = call => JSON.parse(call.init.body);
const okResponse = text => Promise.resolve(makeIntercomResponse(JSON.stringify({ id: Number(NOTE), body: text })));

test('a valid edit-keep is answered with a kept envelope and no creation-flow envelope', async () => {
  const hook = setup();
  const messages = await send(hook, keepData());
  assert.deepEqual(editReplies(messages), [{
    __isaic: true, version: 1, kind: 'temporary-note-edit', noteId: NOTE, status: 'kept', token: null, revision: null, reason: null
  }]);
  assert.equal(messages.some(item => item && ['temporary-note-armed', 'temporary-note-save'].includes(item.kind)), false);
});

test('an edit-keep with a non-digit note id posts nothing and remembers nothing', async () => {
  const hook = setup();
  for (const noteId of ['abc', '12a', '', '1'.repeat(33), 123, null]) {
    const messages = await send(hook, keepData({ noteId }));
    assert.deepEqual(editReplies(messages), [], String(noteId));
  }
  const result = await put(hook, 'abc', { body: 'x' });
  assert.equal(sentBody(hook.calls[0]).body, 'x');
  assert.deepEqual(result.replies, []);
});

test('a 32-digit note id is accepted', async () => {
  const hook = setup();
  const messages = await send(hook, keepData({ noteId: '9'.repeat(32) }));
  assert.equal(editReplies(messages)[0].status, 'kept');
});

test('each invalid field blocks the edit and forgets an earlier remembered edit', async () => {
  const cases = {
    workspace: 'other123',
    contact: 'bad contact!',
    token: 'short',
    expiresAt: '2026-09-09T07:55:12Z'
  };
  for (const [field, value] of Object.entries(cases)) {
    const hook = setup();
    assert.equal(editReplies(await send(hook, keepData()))[0].status, 'kept');
    const messages = await send(hook, keepData({ [field]: value }));
    const replies = editReplies(messages);
    assert.equal(replies.length, 1, field);
    assert.equal(replies[0].status, 'blocked', field);
    assert.equal(replies[0].noteId, NOTE, field);
    assert.equal(replies[0].token, null, field);
    assert.equal(replies[0].revision, null, field);
    await put(hook, NOTE, { body: 'plain', app_id: WORKSPACE });
    assert.equal(sentBody(hook.calls[0]).body, 'plain', `${field} edit forgotten`);
  }
});

test('an expiry that does not round-trip through toISOString is blocked', async () => {
  for (const expiresAt of ['2026-02-31T07:55:12.120Z', '2026-09-09T07:55:12.12Z', '2026-09-09 07:55:12.120Z', '', 5, null]) {
    const hook = setup();
    const replies = editReplies(await send(hook, keepData({ expiresAt })));
    assert.equal(replies[0].status, 'blocked', String(expiresAt));
  }
});

test('token length bounds are 8 to 128 characters', async () => {
  const hook = setup();
  assert.equal(editReplies(await send(hook, keepData({ token: 'a'.repeat(7) })))[0].status, 'blocked');
  assert.equal(editReplies(await send(hook, keepData({ token: 'a'.repeat(8) })))[0].status, 'kept');
  assert.equal(editReplies(await send(hook, keepData({ token: 'a'.repeat(128) })))[0].status, 'kept');
  assert.equal(editReplies(await send(hook, keepData({ token: 'a'.repeat(129) })))[0].status, 'blocked');
});

test('a workspace that differs from the page workspace is blocked even when well formed', async () => {
  const hook = setup();
  assert.equal(editReplies(await send(hook, keepData({ workspace: 'other999' })))[0].status, 'blocked');
});

test('at most 50 note ids are remembered; a re-sent id still works and a forgotten place frees room', async () => {
  const hook = setup();
  for (let index = 1; index <= 50; index += 1) {
    assert.equal(editReplies(await send(hook, keepData({ noteId: String(index) })))[0].status, 'kept', String(index));
  }
  assert.equal(editReplies(await send(hook, keepData({ noteId: '51' })))[0].status, 'blocked');
  assert.equal(editReplies(await send(hook, keepData({ noteId: '1' })))[0].status, 'kept');
  await send(hook, { __isaTempNote: true, kind: 'edit-forget', noteId: '2' });
  assert.equal(editReplies(await send(hook, keepData({ noteId: '51' })))[0].status, 'kept');
});

test('a blocked 51st id is not remembered', async () => {
  const hook = setup();
  for (let index = 1; index <= 50; index += 1) await send(hook, keepData({ noteId: String(index) }));
  await send(hook, keepData({ noteId: '51' }));
  await put(hook, '51', { body: 'x' });
  assert.equal(sentBody(hook.calls[0]).body, 'x');
});

test('edit-forget removes the remembered edit and sends no reply', async () => {
  const hook = setup();
  await send(hook, keepData());
  const messages = await send(hook, { __isaTempNote: true, kind: 'edit-forget', noteId: NOTE });
  assert.deepEqual(editReplies(messages), []);
  await put(hook, NOTE, { body: 'x', app_id: WORKSPACE });
  assert.equal(sentBody(hook.calls[0]).body, 'x');
});

test('a PUT for a remembered note gets the hook-built footer appended and keeps every other key', async () => {
  const hook = setup(() => okResponse('unused'));
  await send(hook, keepData());
  await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE, extra: 7 });
  assert.equal(hook.calls.length, 1);
  assert.deepEqual({ ...sentBody(hook.calls[0]) }, { body: `hello\n\n${FOOTER}`, app_id: WORKSPACE, extra: 7 });
  assert.equal(hook.calls[0].init.method, 'PUT');
  assert.equal(hook.calls[0].input, PUT_URL(NOTE));
});

test('an empty note text gets just the footer, without a leading blank line', async () => {
  const hook = setup(() => okResponse('unused'));
  await send(hook, keepData());
  await put(hook, NOTE, { body: '', app_id: WORKSPACE });
  assert.equal(sentBody(hook.calls[0]).body, FOOTER);
});

test('the footer is never taken from the message, whatever extra fields it carries', async () => {
  const hook = setup(() => okResponse('unused'));
  await send(hook, keepData({ footer: 'EVIL FOOTER', body: 'EVIL BODY', text: 'EVIL' }));
  await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(sentBody(hook.calls[0]).body, `hello\n\n${FOOTER}`);
});

test('the caller receives the server response, and a matching body posts saved', async () => {
  const text = `hello\n\n${FOOTER}`;
  const hook = setup(() => okResponse(text));
  await send(hook, keepData());
  const result = await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(result.error, undefined);
  assert.equal(result.response.status, 200);
  assert.equal(await result.response.clone().text(), JSON.stringify({ id: Number(NOTE), body: text }));
  assert.deepEqual(result.replies.map(item => item.status), ['saved']);
  assert.equal(result.replies[0].noteId, NOTE);
  assert.equal(result.replies[0].token, null);
  assert.equal(result.replies[0].revision, null);
});

test('a saved edit is consumed: the next PUT for that note passes through unchanged', async () => {
  const hook = setup(() => okResponse(`hello\n\n${FOOTER}`));
  await send(hook, keepData());
  await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  const second = await put(hook, NOTE, { body: 'again', app_id: WORKSPACE });
  assert.equal(hook.calls[1].init.body, second.init.body);
  assert.deepEqual({ ...sentBody(hook.calls[1]) }, { body: 'again', app_id: WORKSPACE });
  assert.deepEqual(second.replies, []);
});

test('a 2xx response whose body lacks the footer posts unconfirmed and still reaches the caller', async () => {
  const bodies = [
    JSON.stringify({ id: 1, body: 'hello' }),
    JSON.stringify({ id: 1, body: `hello\n\n${FOOTER}\ntrailing` }),
    JSON.stringify({ id: 1, body: `${FOOTER}\n\nhello` }),
    'not json at all',
    JSON.stringify({ id: 1 })
  ];
  for (const bodyText of bodies) {
    const hook = setup(() => Promise.resolve(makeIntercomResponse(bodyText)));
    await send(hook, keepData());
    const result = await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
    assert.equal(result.response.status, 200, bodyText);
    assert.deepEqual(result.replies.map(item => item.status), ['unconfirmed'], bodyText);
  }
});

test('a non-2xx response posts failed, reaches the caller, and the retry is rewritten again', async () => {
  let attempt = 0;
  const hook = setup(() => {
    attempt += 1;
    return attempt === 1
      ? Promise.resolve(makeIntercomResponse('{"error":"x"}', { status: 500 }))
      : okResponse(`hello\n\n${FOOTER}`);
  });
  await send(hook, keepData());
  const first = await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(first.response.status, 500);
  assert.deepEqual(first.replies.map(item => item.status), ['failed']);
  const retry = await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(sentBody(hook.calls[1]).body, `hello\n\n${FOOTER}`);
  assert.deepEqual(retry.replies.map(item => item.status), ['saved']);
});

test('a network error posts failed, rejects the caller, and keeps the edit for a retry', async () => {
  let attempt = 0;
  const hook = setup(() => {
    attempt += 1;
    return attempt === 1 ? Promise.reject(new Error('offline')) : okResponse(`hello\n\n${FOOTER}`);
  });
  await send(hook, keepData());
  const first = await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(first.error.message, 'offline');
  assert.deepEqual(first.replies.map(item => item.status), ['failed']);
  await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(sentBody(hook.calls[1]).body, `hello\n\n${FOOTER}`);
});

test('a request body that already holds an auto-delete marker is sent byte for byte unchanged', async () => {
  const hook = setup(() => okResponse('x'));
  await send(hook, keepData());
  const original = JSON.stringify({ body: `hi\n\n${FOOTER}`, app_id: WORKSPACE });
  const result = await put(hook, NOTE, original);
  assert.equal(hook.calls.length, 1);
  assert.equal(hook.calls[0].init.body, original);
  assert.equal(result.response.status, 200);
  assert.equal(result.replies.some(item => item.status === 'blocked'), false);
});

test('a marker anywhere in the text, not only at the end, stops a second footer', async () => {
  const hook = setup(() => okResponse('x'));
  await send(hook, keepData());
  const original = JSON.stringify({ body: 'see [ISA-AUTO-DELETE: in the middle of text', app_id: WORKSPACE });
  await put(hook, NOTE, original);
  assert.equal(hook.calls[0].init.body, original);
});

test('an unreadable request body rejects the fetch, is never sent, posts blocked and keeps the edit', async () => {
  const hook = setup(() => okResponse(`hello\n\n${FOOTER}`));
  await send(hook, keepData());
  const unreadable = [
    new hook.window.FormData(),
    new hook.window.Blob(['{"body":"x"}']),
    '{not json',
    '[{"body":"x"}]',
    '{"body":5}',
    '{"app_id":"x"}',
    'null'
  ];
  for (const body of unreadable) {
    const before = hook.posted.length;
    const outcome = await hook.window.fetch(PUT_URL(NOTE), { method: 'PUT', body }).then(() => null, error => error);
    await delay(0);
    assert.notEqual(outcome, null, 'fetch must reject');
    assert.equal(hook.calls.length, 0, 'the request must not be sent');
    assert.deepEqual(editReplies(hook.posted.slice(before)).map(item => item.status), ['blocked']);
  }
  await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(sentBody(hook.calls[0]).body, `hello\n\n${FOOTER}`);
});

test('a PUT for a note with no remembered edit passes through unchanged', async () => {
  const hook = setup();
  await send(hook, keepData());
  const body = JSON.stringify({ body: 'hello', app_id: WORKSPACE });
  const result = await put(hook, '999', body);
  assert.equal(hook.calls[0].init.body, body);
  assert.deepEqual(result.replies, []);
});

test('a PUT for a remembered note under another workspace passes through and keeps the edit', async () => {
  const hook = setup(() => okResponse(`hello\n\n${FOOTER}`));
  await send(hook, keepData());
  const body = JSON.stringify({ body: 'hello', app_id: 'other123' });
  const result = await put(hook, NOTE, body, { url: `${ORIGIN}/ember/inbox/notes/${NOTE}?app_id=other123` });
  assert.equal(hook.calls[0].init.body, body);
  assert.deepEqual(result.replies, []);
  await put(hook, NOTE, { body: 'hello', app_id: WORKSPACE });
  assert.equal(sentBody(hook.calls[1]).body, `hello\n\n${FOOTER}`);
});

test('a PUT without an app_id query passes through unchanged', async () => {
  const hook = setup();
  await send(hook, keepData());
  const body = JSON.stringify({ body: 'hello' });
  await put(hook, NOTE, body, { url: `${ORIGIN}/ember/inbox/notes/${NOTE}` });
  assert.equal(hook.calls[0].init.body, body);
});

test('a PUT to another origin passes through unchanged', async () => {
  const hook = setup();
  await send(hook, keepData());
  const body = JSON.stringify({ body: 'hello', app_id: WORKSPACE });
  const result = await put(hook, NOTE, body, { url: `https://evil.example.com/ember/inbox/notes/${NOTE}?app_id=${WORKSPACE}` });
  assert.equal(hook.calls[0].init.body, body);
  assert.deepEqual(result.replies, []);
});

test('GET, DELETE and POST requests are never rewritten', async () => {
  for (const method of ['GET', 'DELETE']) {
    const hook = setup();
    await send(hook, keepData());
    const body = method === 'GET' ? undefined : JSON.stringify({ body: 'hello', app_id: WORKSPACE });
    await hook.window.fetch(PUT_URL(NOTE), { method, body });
    await delay(0);
    assert.equal(hook.calls[0].init.body, body, method);
  }
  const hook = setup();
  await send(hook, keepData());
  const body = JSON.stringify({ body: 'hello', app_id: WORKSPACE });
  await hook.window.fetch(`${ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}`, { method: 'POST', body });
  await delay(0);
  assert.equal(hook.calls[0].init.body, body);
  assert.equal(hook.posted.some(item => item && item.kind === 'temporary-note-save'), false);
});

test('a PUT to a deeper path under the note is never rewritten', async () => {
  const hook = setup();
  await send(hook, keepData());
  const body = JSON.stringify({ body: 'hello', app_id: WORKSPACE });
  await put(hook, NOTE, body, { url: `${ORIGIN}/ember/inbox/notes/${NOTE}/something?app_id=${WORKSPACE}` });
  assert.equal(hook.calls[0].init.body, body);
});

test('a remembered edit applies to its own note id only', async () => {
  const hook = setup(() => okResponse('x'));
  await send(hook, keepData({ noteId: '111' }));
  const body = JSON.stringify({ body: 'hello', app_id: WORKSPACE });
  await put(hook, '2111', body);
  await put(hook, '1111', body);
  assert.equal(hook.calls[0].init.body, body);
  assert.equal(hook.calls[1].init.body, body);
});

test('an edit-keep never produces armed or save envelopes and does not block a later creation arm', async () => {
  const hook = setup();
  const messages = await send(hook, keepData());
  assert.equal(messages.some(item => item && /^temporary-note-(armed|save)$/.test(item.kind)), false);
  const armed = await send(hook, {
    __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'note',
    lifetime: { mode: 'relative', delayMs: 86400000 }, token: 'arm-token-0001', revision: 1
  });
  assert.equal(armed.find(item => item && item.kind === 'temporary-note-armed').status, 'armed');
});

test('an edit-keep from a foreign source or origin is ignored', async () => {
  const hook = setup();
  const before = hook.posted.length;
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', { data: keepData(), source: null, origin: ORIGIN }));
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', { data: keepData(), source: hook.window, origin: 'https://evil.example.com' }));
  await delay(0);
  assert.deepEqual(editReplies(hook.posted.slice(before)), []);
});
