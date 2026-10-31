'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL } = require('../support/temporary-notes-harness');

const TOKEN = 'arm-test-0001';
const REPLY_KINDS = ['temporary-note-armed', 'temporary-note-save'];

function freshHook() {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}'))
  });
  hook.sendReady();
  return hook;
}

function validArm(overrides = {}) {
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

function validDisarm(overrides = {}) {
  return { __isaTempNote: true, kind: 'disarm', workspace: WORKSPACE, contact: CONTACT, token: TOKEN, revision: 2, ...overrides };
}

async function send(hook, data) {
  const before = hook.posted.length;
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', { data, source: hook.window, origin: ORIGIN }));
  await delay(0);
  return hook.posted.slice(before).filter(message => message && REPLY_KINDS.includes(message.kind));
}

async function onlyReply(hook, data) {
  const replies = await send(hook, data);
  assert.equal(replies.length, 1, `one reply for ${JSON.stringify(data)}`);
  return replies[0];
}

function assertBlocked(reply, { token, revision }) {
  assert.equal(reply.kind, 'temporary-note-armed');
  assert.equal(reply.status, 'blocked');
  assert.equal(reply.reason, 'invalid-arm');
  assert.equal(reply.token, token);
  assert.equal(reply.revision, revision);
}

async function assertStillArms(hook) {
  const reply = await onlyReply(hook, validArm({ token: 'recovery-token-1', revision: 5 }));
  assert.equal(reply.kind, 'temporary-note-armed');
  assert.notEqual(reply.status, 'blocked', 'a valid arm after a rejected one is accepted');
  assert.equal(reply.token, 'recovery-token-1');
  assert.equal(reply.revision, 5);
}

test('a valid arm is echoed back with its token and revision', async () => {
  const reply = await onlyReply(freshHook(), validArm());
  assert.equal(reply.kind, 'temporary-note-armed');
  assert.equal(reply.status, 'armed');
  assert.equal(reply.token, TOKEN);
  assert.equal(reply.revision, 1);
});

test('revision 0 and 1000000000 are accepted', async () => {
  for (const revision of [0, 1000000000]) {
    const reply = await onlyReply(freshHook(), validArm({ revision }));
    assert.equal(reply.status, 'armed', `revision ${revision}`);
    assert.equal(reply.token, TOKEN);
    assert.equal(reply.revision, revision);
  }
});

test('an invalid revision is blocked and echoed as null, while the valid token is echoed', async () => {
  for (const revision of [-1, 1.5, '3', NaN, Infinity, 9009617633]) {
    const reply = await onlyReply(freshHook(), validArm({ revision }));
    assertBlocked(reply, { token: TOKEN, revision: null });
  }
});

test('a missing revision is blocked and echoed as null', async () => {
  const data = validArm();
  delete data.revision;
  assertBlocked(await onlyReply(freshHook(), data), { token: TOKEN, revision: null });
});

test('an invalid token is blocked and echoed as null, while the valid revision is echoed', async () => {
  const tokens = [900498965, 'short', 'a'.repeat(7), 'a'.repeat(129), 'has space 123', 'bad.token.123', '', null, undefined, ['arm-test-0001']];
  for (const token of tokens) {
    const reply = await onlyReply(freshHook(), validArm({ token, revision: 7 }));
    assertBlocked(reply, { token: null, revision: 7 });
  }
});

test('token length 8 and 128 are accepted and 7 and 129 are not', async () => {
  for (const token of ['a'.repeat(8), 'Z_-'.repeat(42) + 'ab']) {
    assert.equal(token.length >= 8 && token.length <= 128, true);
    const reply = await onlyReply(freshHook(), validArm({ token }));
    assert.equal(reply.status, 'armed', `token length ${token.length}`);
    assert.equal(reply.token, token);
  }
  const longest = 'a'.repeat(128);
  assert.equal((await onlyReply(freshHook(), validArm({ token: longest }))).token, longest);
  assertBlocked(await onlyReply(freshHook(), validArm({ token: 'a'.repeat(129) })), { token: null, revision: 1 });
  assertBlocked(await onlyReply(freshHook(), validArm({ token: 'a'.repeat(7) })), { token: null, revision: 1 });
});

test('an invalid workspace or contact is blocked but the token and revision are echoed', async () => {
  const bad = [12345, '', 'a'.repeat(65), 'has space', 'bad.id', 'slash/id', null, undefined, ['demo1234']];
  for (const value of bad) {
    for (const field of ['workspace', 'contact']) {
      const reply = await onlyReply(freshHook(), validArm({ [field]: value }));
      assertBlocked(reply, { token: TOKEN, revision: 1 });
    }
  }
});

test('workspace and contact of 1 and 64 characters pass format validation and 65 does not', async () => {
  for (const id of ['a', 'A_-9'.repeat(16)]) {
    for (const field of ['workspace', 'contact']) {
      const reply = await onlyReply(freshHook(), validArm({ [field]: id }));
      assert.notEqual(reply.reason, 'invalid-arm', );
      assert.equal(reply.token, TOKEN);
      assert.equal(reply.revision, 1);
    }
  }
  for (const field of ['workspace', 'contact']) {
    assertBlocked(await onlyReply(freshHook(), validArm({ [field]: 'a'.repeat(65) })), { token: TOKEN, revision: 1 });
  }
});

test('an invalid token and an invalid revision together are both echoed as null', async () => {
  const reply = await onlyReply(freshHook(), validArm({ token: 900498965, revision: -1 }));
  assertBlocked(reply, { token: null, revision: null });
});

test('relative lifetime with two keys but not mode is blocked', async () => {
  const reply = await onlyReply(freshHook(), validArm({ lifetime: { delayMs: 86400000, other: 1 } }));
  assertBlocked(reply, { token: TOKEN, revision: 1 });
});

test('an absolute expiresAt that is a number is blocked', async () => {
  const reply = await onlyReply(freshHook(), validArm({ lifetime: { mode: 'absolute', expiresAt: Date.parse('2027-01-01T00:00:00.000Z') } }));
  assertBlocked(reply, { token: TOKEN, revision: 1 });
});

test('an absolute date in the right shape that does not exist is blocked and the hook keeps working', async () => {
  for (const expiresAt of ['2026-02-30T00:00:00.000Z', '2026-13-01T00:00:00.000Z']) {
    const hook = freshHook();
    assertBlocked(await onlyReply(hook, validArm({ lifetime: { mode: 'absolute', expiresAt } })), { token: TOKEN, revision: 1 });
    await assertStillArms(hook);
  }
});

test('a relative delayMs of 60000 and 315360000000 is accepted and the token and revision are echoed', async () => {
  for (const delayMs of [60000, 315360000000]) {
    const reply = await onlyReply(freshHook(), validArm({ lifetime: { mode: 'relative', delayMs } }));
    assert.equal(reply.status, 'armed', `delayMs ${delayMs}`);
    assert.equal(reply.token, TOKEN);
    assert.equal(reply.revision, 1);
  }
});

test('a relative delayMs one below or one above the range is blocked with the token and revision echoed', async () => {
  for (const delayMs of [59999, 900113873105]) {
    const reply = await onlyReply(freshHook(), validArm({ lifetime: { mode: 'relative', delayMs } }));
    assertBlocked(reply, { token: TOKEN, revision: 1 });
  }
});

test('a lifetime with three keys is blocked with the token and revision echoed', async () => {
  const reply = await onlyReply(freshHook(), validArm({ lifetime: { mode: 'relative', delayMs: 86400000, extra: 1 } }));
  assertBlocked(reply, { token: TOKEN, revision: 1 });
});

test('a missing lifetime is blocked', async () => {
  const data = validArm();
  delete data.lifetime;
  assertBlocked(await onlyReply(freshHook(), data), { token: TOKEN, revision: 1 });
});

test('an absolute lifetime with a real date is accepted', async () => {
  const reply = await onlyReply(freshHook(), validArm({ lifetime: { mode: 'absolute', expiresAt: '2027-01-01T00:00:00.000Z' } }));
  assert.equal(reply.status, 'armed');
  assert.equal(reply.token, TOKEN);
  assert.equal(reply.revision, 1);
});

test('a draft of 200000 characters is accepted and 900001 is blocked', async () => {
  const ok = await onlyReply(freshHook(), validArm({ draft: 'x'.repeat(200000) }));
  assert.equal(ok.status, 'armed');
  const hook = freshHook();
  assertBlocked(await onlyReply(hook, validArm({ draft: 'x'.repeat(900001) })), { token: TOKEN, revision: 1 });
  await assertStillArms(hook);
});

test('a draft that is not a string is blocked', async () => {
  for (const draft of [12345, null, undefined, ['note'], { text: 'note' }]) {
    assertBlocked(await onlyReply(freshHook(), validArm({ draft })), { token: TOKEN, revision: 1 });
  }
});

test('after any rejected arm a following valid arm is accepted', async () => {
  const rejected = [
    validArm({ revision: -1 }),
    validArm({ token: 900498965 }),
    validArm({ workspace: 12345 }),
    validArm({ lifetime: { mode: 'relative', delayMs: 59999 } }),
    validArm({ lifetime: { delayMs: 86400000, other: 1 } }),
    validArm({ lifetime: { mode: 'absolute', expiresAt: '2026-02-30T00:00:00.000Z' } }),
    validArm({ draft: 12345 })
  ];
  const hook = freshHook();
  for (const data of rejected) {
    assert.equal((await onlyReply(hook, data)).status, 'blocked', JSON.stringify(data));
    await assertStillArms(hook);
  }
});

test('a valid disarm is answered as disarmed with the token and revision echoed', async () => {
  const hook = freshHook();
  await onlyReply(hook, validArm());
  const reply = await onlyReply(hook, validDisarm());
  assert.equal(reply.kind, 'temporary-note-armed');
  assert.equal(reply.status, 'disarmed');
  assert.equal(reply.token, TOKEN);
  assert.equal(reply.revision, 2);
});

test('a disarm with an invalid identity field is a blocked temporary-note-save', async () => {
  const cases = [
    { workspace: 12345 }, { contact: 12345 }, { workspace: '' }, { contact: 'a'.repeat(65) },
    { token: 900498965 }, { token: 'short' }, { revision: -1 }, { revision: 9009617633 }, { revision: '2' }
  ];
  for (const overrides of cases) {
    const hook = freshHook();
    await onlyReply(hook, validArm());
    const reply = await onlyReply(hook, validDisarm(overrides));
    assert.equal(reply.kind, 'temporary-note-save', JSON.stringify(overrides));
    assert.equal(reply.status, 'blocked');
    assert.equal(reply.reason, 'invalid-arm');
  }
});

test('a relative lifetime with the keys in reverse order is accepted', async () => {
  const reply = await onlyReply(freshHook(), validArm({ lifetime: { delayMs: 86400000, mode: 'relative' } }));
  assert.equal(reply.status, 'armed');
  assert.equal(reply.token, TOKEN);
  assert.equal(reply.revision, 1);
});


test('an unknown lifetime mode with a valid expiresAt is rejected', async () => {
  const reply = await onlyReply(freshHook(), validArm({ lifetime: { mode: 'later', expiresAt: '2027-01-01T00:00:00.000Z' } }));
  assertBlocked(reply, { token: TOKEN, revision: 1 });
});
