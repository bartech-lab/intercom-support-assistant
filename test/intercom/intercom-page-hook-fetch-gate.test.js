'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const DRAFT = 'temporary note';
const OTHER_ORIGIN = 'https://evil.example.com';

function makeHook() {
  const requests = [];
  const impl = (input, init) => {
    requests.push({ input, init });
    if (requests.length === 1) return new Promise(() => {});
    return Promise.resolve(makeIntercomResponse('{}', { url: CREATE_URL }));
  };
  const hook = loadIntercomPageHook({ url: CONVERSATION_URL, fetchImpl: impl });
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: {
      __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: DRAFT,
      lifetime: { mode: 'relative', delayMs: 86400000 }, token: 'gate-token-1', revision: 1
    },
    source: hook.window,
    origin: ORIGIN
  }));
  return { ...hook, requests };
}

async function makeBlockingHook() {
  const hook = makeHook();
  hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: DRAFT })
  });
  await delay(0);
  assert.equal(hook.requests.length, 1, 'the pending first save reached the network');
  return hook;
}

const blockedSaves = hook => hook.posted.filter(
  message => message && message.kind === 'temporary-note-save' && message.status === 'blocked'
);

async function probe(hook, input, init) {
  const before = hook.requests.length;
  const outcome = await Promise.resolve(hook.window.fetch(input, init)).then(() => null, caught => caught);
  await delay(0);
  return { outcome, reached: hook.requests.slice(before) };
}

test('a cross-origin POST to the create path passes through while a same-origin POST is blocked', async () => {
  const hook = await makeBlockingHook();
  const foreignUrl = `${OTHER_ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}`;
  const foreign = await probe(hook, foreignUrl, { method: 'POST', body: '{}' });
  assert.equal(foreign.outcome, null);
  assert.equal(foreign.reached.length, 1);
  assert.equal(foreign.reached[0].input, foreignUrl);
  assert.equal(blockedSaves(hook).length, 0);

  const own = await probe(hook, CREATE_URL, { method: 'POST', body: '{}' });
  assert.ok(own.outcome, 'the same-origin POST rejects');
  assert.equal(own.reached.length, 0);
  assert.equal(blockedSaves(hook).at(-1).reason, 'save-pending');
});

test('a relative create URL resolves against the page origin and is gated', async () => {
  const hook = await makeBlockingHook();
  const relative = await probe(hook, `/ember/inbox/notes?app_id=${WORKSPACE}`, { method: 'POST', body: '{}' });
  assert.ok(relative.outcome);
  assert.equal(relative.reached.length, 0);
  assert.equal(blockedSaves(hook).at(-1).reason, 'save-pending');
});

test('a same-origin GET to the create path passes through', async () => {
  const hook = await makeBlockingHook();
  const get = await probe(hook, CREATE_URL, { method: 'GET' });
  assert.equal(get.outcome, null);
  assert.equal(get.reached.length, 1);
  assert.equal(get.reached[0].input, CREATE_URL);
  assert.equal(blockedSaves(hook).length, 0);
});

test('a request with no method passes through as GET', async () => {
  const hook = await makeBlockingHook();
  const bare = await probe(hook, CREATE_URL);
  assert.equal(bare.outcome, null);
  assert.equal(bare.reached.length, 1);
  assert.equal(blockedSaves(hook).length, 0);
});

test('a lowercase post method is still gated', async () => {
  const hook = await makeBlockingHook();
  const lower = await probe(hook, CREATE_URL, { method: 'post', body: '{}' });
  assert.ok(lower.outcome);
  assert.equal(lower.reached.length, 0);
  assert.equal(blockedSaves(hook).at(-1).reason, 'save-pending');
});

for (const path of ['/ember/inbox/notes/123', '/ember/inbox/notesx']) {
  test(`a same-origin POST to ${path} passes through`, async () => {
    const hook = await makeBlockingHook();
    const url = `${ORIGIN}${path}?app_id=${WORKSPACE}`;
    const other = await probe(hook, url, { method: 'POST', body: '{}' });
    assert.equal(other.outcome, null);
    assert.equal(other.reached.length, 1);
    assert.equal(other.reached[0].input, url);
    assert.equal(blockedSaves(hook).length, 0);
  });
}

test('a gated POST given as a Request-like object with no init is blocked', async () => {
  const hook = await makeBlockingHook();
  const result = await probe(hook, { url: CREATE_URL, method: 'POST' });
  assert.ok(result.outcome);
  assert.equal(result.reached.length, 0);
  assert.equal(blockedSaves(hook).at(-1).reason, 'save-pending');
});

test('a Request-like GET object and a cross-origin Request-like POST object pass through', async () => {
  const hook = await makeBlockingHook();
  const getLike = { url: CREATE_URL, method: 'GET' };
  const get = await probe(hook, getLike);
  assert.equal(get.reached.length, 1);
  assert.equal(get.reached[0].input, getLike);
  const foreignLike = { url: `${OTHER_ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}`, method: 'POST' };
  const foreign = await probe(hook, foreignLike);
  assert.equal(foreign.reached.length, 1);
  assert.equal(foreign.reached[0].input, foreignLike);
  assert.equal(blockedSaves(hook).length, 0);
});

test('the hook leaves window.fetch undefined when it is absent at load', () => {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    beforeScripts: (win) => { delete win.fetch; }
  });
  hook.sendReady();
  assert.equal(hook.window.fetch, undefined);
});
