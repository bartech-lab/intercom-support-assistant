'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const DRAFT = 'temporary note';

function makeHook(fetchImpl, { manualTimers = false } = {}) {
  const timers = new Map();
  let nextTimer = 1;
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl,
    beforeScripts: (win) => {
      if (manualTimers) {
        win.setTimeout = (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, ms }); return id; };
        win.clearTimeout = (id) => { timers.delete(id); };
      }
    }
  });
  hook.sendReady();
  const fireTimers = () => [...timers.values()].forEach(timer => timer.callback());
  return { ...hook, fireTimers };
}

function arm(hook, { token = 'first-token', revision = 1 } = {}) {
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: {
      __isaTempNote: true,
      kind: 'arm',
      workspace: WORKSPACE,
      contact: CONTACT,
      draft: DRAFT,
      lifetime: { mode: 'relative', delayMs: 86400000 },
      token,
      revision
    },
    source: hook.window,
    origin: ORIGIN
  }));
}

function postNote(hook) {
  return hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: DRAFT })
  });
}

const armedReplies = hook => hook.posted.filter(message => message && message.kind === 'temporary-note-armed');

async function pendingSave() {
  let release;
  const requests = [];
  const hook = makeHook((input, init) => {
    requests.push({ input, init });
    return new Promise((resolve) => { release = resolve; });
  });
  arm(hook);
  await delay(0);
  const first = postNote(hook).then(() => null, error => error);
  await delay(0);
  assert.equal(requests.length, 1, 'the first save is in flight');
  return { hook, requests, first, release: (response) => release(response) };
}

async function uncertainSave() {
  const requests = [];
  const hook = makeHook((input, init) => {
    requests.push({ input, init });
    return new Promise(() => {});
  }, { manualTimers: true });
  arm(hook);
  await delay(0);
  const first = postNote(hook).then(() => null, error => error);
  await delay(0);
  hook.fireTimers();
  assert.ok(await first, 'the timed-out save rejects');
  await delay(0);
  const saves = hook.posted.filter(message => message && message.kind === 'temporary-note-save');
  assert.equal(saves[0].reason, 'timeout');
  return { hook, requests };
}

test('an arm while the previous save is pending is blocked as save-pending with the same token and revision', async () => {
  const { hook, requests, first, release } = await pendingSave();
  const before = armedReplies(hook).length;
  arm(hook, { token: 'second-token', revision: 7 });
  await delay(0);
  const replies = armedReplies(hook).slice(before);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].status, 'blocked');
  assert.equal(replies[0].reason, 'save-pending');
  assert.equal(replies[0].token, 'second-token');
  assert.equal(replies[0].revision, 7);
  assert.equal(armedReplies(hook).some(message => message.token === 'second-token' && message.status === 'armed'), false);
  assert.match(JSON.parse(requests[0].init.body).body, /token=first-token\]$/);
  release(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(requests[0].init.body).body }), { url: CREATE_URL }));
  await first;
});

test('a blocked arm during a pending save does not change the token stamped on the in-flight save', async () => {
  const { hook, requests, first, release } = await pendingSave();
  arm(hook, { token: 'second-token', revision: 2 });
  await delay(0);
  release(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(requests[0].init.body).body }), { url: CREATE_URL }));
  await first;
  await delay(0);
  const saves = hook.posted.filter(message => message && message.kind === 'temporary-note-save');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].token, 'first-token');
  assert.equal(requests.length, 1);
});

test('an arm after the previous save ended uncertain is blocked as save-uncertain', async () => {
  const { hook } = await uncertainSave();
  const before = armedReplies(hook).length;
  arm(hook, { token: 'second-token', revision: 3 });
  await delay(0);
  const replies = armedReplies(hook).slice(before);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].status, 'blocked');
  assert.equal(replies[0].reason, 'save-uncertain');
  assert.equal(replies[0].token, 'second-token');
  assert.equal(replies[0].revision, 3);
});

test('uncertain alone blocks: the timed-out save is no longer pending yet the arm is still refused', async () => {
  const { hook, requests } = await uncertainSave();
  assert.equal(requests.length, 1);
  const secondPost = postNote(hook).then(() => null, error => error);
  await delay(0);
  assert.equal(requests.length, 1, 'no second fetch, so nothing is pending');
  assert.ok(await secondPost);
  const before = armedReplies(hook).length;
  arm(hook, { token: 'third-token', revision: 4 });
  await delay(0);
  const replies = armedReplies(hook).slice(before);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].reason, 'save-uncertain');
  assert.notEqual(replies[0].reason, 'save-pending');
});

test('pending alone blocks: a pending save with no uncertain outcome gives save-pending, not save-uncertain', async () => {
  const { hook, requests, first, release } = await pendingSave();
  const saves = () => hook.posted.filter(message => message && message.kind === 'temporary-note-save');
  assert.equal(saves().length, 0, 'no failed or uncertain outcome has been reported');
  const before = armedReplies(hook).length;
  arm(hook, { token: 'second-token', revision: 2 });
  await delay(0);
  const replies = armedReplies(hook).slice(before);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].reason, 'save-pending');
  release(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(requests[0].init.body).body }), { url: CREATE_URL }));
  await first;
});

test('after the pending save completes successfully a new arm is not blocked', async () => {
  const { hook, requests, first, release } = await pendingSave();
  release(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(requests[0].init.body).body }), { url: CREATE_URL }));
  assert.equal(await first, null);
  await delay(0);
  await delay(0);
  const saves = hook.posted.filter(message => message && message.kind === 'temporary-note-save');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].status, 'success');
  const before = armedReplies(hook).length;
  arm(hook, { token: 'second-token', revision: 2 });
  await delay(0);
  const replies = armedReplies(hook).slice(before);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].status, 'armed');
  assert.equal(replies[0].token, 'second-token');
  assert.equal(replies[0].revision, 2);
});

async function contactMessage(requestUrl) {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse(JSON.stringify({ note_ids: [111, 222], users: [null] }), { url: requestUrl }))
  });
  hook.sendReady();
  await hook.window.fetch(requestUrl);
  await delay(0);
  await delay(0);
  return hook.posted.find(item => item && item.kind === 'temporary-note-contact') || null;
}

test('a contact response with numeric note ids and a workspace is relayed', async () => {
  const message = await contactMessage(`${ORIGIN}/ember/users/900fcbb36062854afdf312d1?app_id=${WORKSPACE}`);
  assert.ok(message, 'the control payload posts temporary-note-contact');
  assert.equal(message.workspace, WORKSPACE);
  assert.deepEqual(Array.from(message.noteIds), ['111', '222']);
});
