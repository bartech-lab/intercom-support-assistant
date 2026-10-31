'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const LIMIT = 200000;

async function run({ draft, requestExtra = {}, tolerateReject = false }) {
  const requests = [];
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push(init);
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(init.body).body }), { url: CREATE_URL }));
    }
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft,
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'size-token', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));
  await delay(0);
  try {
    await hook.window.fetch(CREATE_URL, {
      method: 'POST',
      body: JSON.stringify({ model_id: CONTACT, is_company: false, body: draft, ...requestExtra })
    });
  } catch (error) {
    if (!tolerateReject) throw error;
  }
  await delay(0);
  const arm = posted.find(m => m && m.kind === 'temporary-note-armed');
  const save = posted.filter(m => m && m.kind === 'temporary-note-save').pop();
  return { requests, arm, save };
}

function assertSavedWithFooter(result, draft) {
  assert.equal(result.requests.length, 1);
  const body = JSON.parse(result.requests[0].body).body;
  assert.ok(body.startsWith(`${draft}\n\n`));
  assert.match(body, /ISA-AUTO-DELETE/);
  assert.ok(result.save, 'a temporary-note-save message is reported');
  assert.equal(result.save.status, 'success');
}

test('control: a 100-character draft is saved with the footer and reported success', async () => {
  const draft = 'a'.repeat(100);
  assertSavedWithFooter(await run({ draft }), draft);
});

test('a draft of 200,000 characters is armed, forwarded once with the footer and reported success', async () => {
  const draft = 'a'.repeat(LIMIT);
  const result = await run({ draft });
  assert.equal(result.arm.status, 'armed');
  assertSavedWithFooter(result, draft);
});

test('a 200,000-character draft of JSON-escaped characters is forwarded with the footer and reported success', async () => {
  const draft = '"\n'.repeat(LIMIT / 2);
  assert.equal(draft.length, LIMIT);
  assertSavedWithFooter(await run({ draft }), draft);
});

test('a draft of 200,001 characters is refused at arming', async () => {
  const result = await run({ draft: 'a'.repeat(LIMIT + 1), tolerateReject: true });
  assert.equal(result.arm.status, 'blocked');
  assert.equal(result.requests.filter(init => /ISA-AUTO-DELETE/.test(init.body)).length, 0);
});

test('a 2,000,000-character request JSON around a short armed draft is never forwarded with the footer', async () => {
  const result = await run({ draft: 'short draft', requestExtra: { junk: 'j'.repeat(2000000) }, tolerateReject: true });
  assert.equal(result.requests.filter(init => /ISA-AUTO-DELETE/.test(init.body)).length, 0);
  assert.notEqual(result.save && result.save.status, 'success');
});
