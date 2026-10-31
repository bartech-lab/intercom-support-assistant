'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const DRAFT = "temporary note";
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const MAX_MS = 315360000000;

function makeHook(fetchImpl, { frozenNow = null, manualTimers = false } = {}) {
  const timers = new Map();
  let nextTimer = 1;
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl,
    beforeScripts: (win) => {
      if (frozenNow !== null) win.Date.now = () => frozenNow;
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

function arm(hook, { lifetime = { mode: "relative", delayMs: 86400000 }, token = "guard-token-1", revision = 1 } = {}) {
  hook.window.dispatchEvent(new hook.window.MessageEvent("message", {
    data: { __isaTempNote: true, kind: "arm", workspace: WORKSPACE, contact: CONTACT, draft: DRAFT, lifetime, token, revision },
    source: hook.window,
    origin: ORIGIN
  }));
}

function postNote(hook) {
  return hook.window.fetch(CREATE_URL, {
    method: "POST",
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: DRAFT })
  });
}

const savesOf = hook => hook.posted.filter(message => message && message.kind === "temporary-note-save");

function recorder(respond) {
  const requests = [];
  const impl = (input, init) => {
    requests.push({ input, init });
    return respond(JSON.parse(init.body), requests.length);
  };
  return { requests, impl };
}

const ok = async sent => makeIntercomResponse(JSON.stringify({ id: 1, body: sent.body }), { url: CREATE_URL });

async function blockedReason(hook, requests, expectedCalls) {
  const settledPost = postNote(hook).then(() => null, caught => caught);
  await delay(0);
  assert.equal(requests.length, expectedCalls, "the underlying fetch is not called for a blocked save");
  assert.ok(await settledPost, "the blocked save rejects");
  const blocked = savesOf(hook).filter(message => message.status === "blocked");
  return blocked.length ? blocked[blocked.length - 1].reason : undefined;
}

const BOUNDARIES = [
  ["absolute 59999 ms ahead is expiry-in-past", { mode: "absolute", offset: 59999 }, "expiry-in-past"],
  ["absolute 1 ms in the past is expiry-in-past", { mode: "absolute", offset: -1 }, "expiry-in-past"],
  ["absolute 1 ms beyond 3650 days is expiry-out-of-range", { mode: "absolute", offset: MAX_MS + 1 }, "expiry-out-of-range"],
  ["absolute 3651 days ahead is expiry-out-of-range", { mode: "absolute", offset: 3651 * 86400000 }, "expiry-out-of-range"]
];

for (const [name, spec, reason] of BOUNDARIES) {
  test(`${name} and never reaches the network`, async () => {
    const { requests, impl } = recorder(ok);
    const hook = makeHook(impl, { frozenNow: NOW });
    arm(hook, { lifetime: { mode: "absolute", expiresAt: new Date(NOW + spec.offset).toISOString() } });
    assert.equal(await blockedReason(hook, requests, 0), reason);
  });
}

for (const [name, lifetime] of [
  ["relative delayMs of exactly 3650 days", { mode: "relative", delayMs: MAX_MS }],
  ["absolute instant exactly 3650 days ahead", { mode: "absolute", expiresAt: new Date(NOW + MAX_MS).toISOString() }],
  ["absolute instant exactly 60000 ms ahead", { mode: "absolute", expiresAt: new Date(NOW + 60000).toISOString() }]
]) {
  test(`${name} is sent with the footer appended`, async () => {
    const { requests, impl } = recorder(ok);
    const hook = makeHook(impl, { frozenNow: NOW });
    arm(hook, { lifetime });
    await postNote(hook);
    await delay(0);
    assert.equal(requests.length, 1);
    const sent = JSON.parse(requests[0].init.body);
    assert.ok(sent.body.startsWith(`${DRAFT}\n\n`));
    assert.match(sent.body, /\[ISA-AUTO-DELETE:v1;[^\]]*token=guard-token-1\]$/);
    assert.equal(savesOf(hook).filter(message => message.status === "blocked").length, 0);
  });
}

test("a relative lifetime is resolved against the clock at submit time", async () => {
  const { requests, impl } = recorder(ok);
  const hook = makeHook(impl, { frozenNow: NOW });
  arm(hook, { lifetime: { mode: "relative", delayMs: 3600000 } });
  hook.window.Date.now = () => NOW + 120000;
  await postNote(hook);
  const sent = JSON.parse(requests[0].init.body);
  assert.match(sent.body, new RegExp(`expires=${new Date(NOW + 120000 + 3600000).toISOString().replace(/\./g, "\\.")}`),
    "the delay counts from the submit, two minutes after arming");
});

test("a second POST while the first save is in flight is blocked as save-pending and fetch stays at one call", async () => {
  let release;
  const { requests, impl } = recorder(() => new Promise((resolve) => { release = resolve; }));
  const hook = makeHook(impl);
  arm(hook);
  const first = postNote(hook);
  await delay(0);
  assert.equal(requests.length, 1);
  assert.equal(await blockedReason(hook, requests, 1), "save-pending");
  release(await ok(JSON.parse(requests[0].init.body)));
  await first;
  await delay(0);
  assert.equal(requests.length, 1);
});

test("after a 4xx failure a POST without a new arm is blocked as rearm-required, and a fresh arm unblocks it", async () => {
  const { requests, impl } = recorder(async (sent, call) => (call === 1
    ? makeIntercomResponse("{}", { url: CREATE_URL, status: 422 })
    : makeIntercomResponse(JSON.stringify({ id: 2, body: sent.body }), { url: CREATE_URL })));
  const hook = makeHook(impl);
  arm(hook);
  await postNote(hook).catch(() => null);
  await delay(0);
  await delay(0);
  assert.equal(requests.length, 1);
  assert.equal(savesOf(hook)[0].status, "failed");
  assert.equal(await blockedReason(hook, requests, 1), "rearm-required");

  arm(hook, { token: "guard-token-2", revision: 2 });
  await postNote(hook);
  await delay(0);
  assert.equal(requests.length, 2, "the re-armed POST reaches the network");
  assert.match(JSON.parse(requests[1].init.body).body, /token=guard-token-2\]$/);
});

test("after a 15000 ms timeout a later POST is blocked as save-uncertain without a second fetch", async () => {
  const { requests, impl } = recorder(() => new Promise(() => {}));
  const hook = makeHook(impl, { manualTimers: true });
  arm(hook);
  const first = postNote(hook).then(() => null, error => error);
  await delay(0);
  hook.fireTimers();
  assert.ok(await first);
  await delay(0);
  assert.equal(savesOf(hook)[0].reason, "timeout");
  assert.equal(await blockedReason(hook, requests, 1), "save-uncertain");
});

test("a POST after the page moved to another conversation is blocked as contact-changed", async () => {
  const { requests, impl } = recorder(ok);
  const hook = makeHook(impl);
  arm(hook);
  hook.window.history.pushState({}, "", "/a/inbox/demo1234/inbox/team/1/conversation/900401386133186");
  assert.equal(await blockedReason(hook, requests, 0), "contact-changed");
});
