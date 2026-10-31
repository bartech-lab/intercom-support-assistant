'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('fs');
const path = require('path');
const { loadExtension, loadIntercomPageHook, makeIntercomResponse, makeChromeStub } = require('../support/helpers');
const {
  settled,
  ORIGIN,
  WORKSPACE,
  CONTACT,
  CONVERSATION_URL,
  CREATE_URL,
  savedNote,
  temporaryNoteCard,
  loadSidebar,
} = require('../support/temporary-notes-harness');

function armedHook(requests) {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push({ input, body: init && init.body });
      return Promise.resolve(makeIntercomResponse('{}', { url: CREATE_URL }));
    }
  });
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note', lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-2', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));
  return hook;
}

for (const [label, payload] of [
  ['a company note', { model_id: CONTACT, is_company: true, body: 'temporary note' }],
  ['a note for another contact', { model_id: 'c0ffee12', is_company: false, body: 'temporary note' }]
]) {
  test(`${label} never matches the armed submission`, async () => {
    const requests = [];
    const hook = armedHook(requests);
    await assert.rejects(hook.window.fetch(CREATE_URL, { method: 'POST', body: JSON.stringify(payload) }),
      /does not match the armed draft/);
    assert.deepEqual(requests, [], `${label} is never sent while armed`);
  });
}

const LIFETIME_VECTORS = [
  [{ mode: 'relative', delayMs: 60000 }, true],
  [{ mode: 'relative', delayMs: 315360000000 }, true],
  [{ mode: 'relative', delayMs: 59999 }, false],
  [{ mode: 'relative', delayMs: 900113873105 }, false],
  [{ mode: 'relative', delayMs: 1.5 }, false],
  [{ mode: 'relative', delayMs: '86400000' }, false],
  [{ mode: 'relative', expiresAt: '2027-01-01T00:00:00.000Z' }, false],
  [{ mode: 'absolute', expiresAt: '2027-01-01T00:00:00.000Z' }, true],
  [{ mode: 'absolute', expiresAt: '2027-01-01T00:00:00Z' }, false],
  [{ mode: 'absolute', delayMs: 86400000 }, false],
  [{ mode: 'relative', delayMs: 86400000, expiresAt: '2027-01-01T00:00:00.000Z' }, false],
  [{ mode: 'weekly', delayMs: 86400000 }, false],
  [{ delayMs: 86400000 }, false],
  [null, false],
  [[], false]
];

async function armAndSave(lifetime, { draft = 'temporary note', now = null, advanceAfterArmMs = 0 } = {}) {
  const requests = [];
  const posted = [];
  const clock = { now };
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    beforeScripts: now === null ? null : (win) => { win.Date.now = () => clock.now; },
    fetchImpl: (input, init) => {
      requests.push(init && init.body);
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(init.body).body }), { url: CREATE_URL }));
    }
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft, lifetime, token: 'submission-token-9', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));
  if (clock.now !== null) clock.now += advanceAfterArmMs;
  const result = await hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: draft })
  }).catch(error => error);
  await delay(0);
  return { requests, posted, result };
}

function noteBodies(win) {
  return [...win.document.querySelectorAll('[data-testid="note-body"]')];
}

test('enabling auto-delete arms the page hook for this workspace and contact', () => {
  const win = loadSidebar();
  const posted = [];
  const nativePostMessage = win.postMessage.bind(win);
  win.postMessage = (message, targetOrigin) => {
    posted.push(message);
    nativePostMessage(message, targetOrigin);
  };
  win.refreshTemporaryNoteControls();
  const toggle = win.document.querySelector('input[aria-label="Auto-delete"]');
  toggle.checked = true;
  toggle.dispatchEvent(new win.Event('change'));
  const arm = posted.find(message => message && message.__isaTempNote === true && message.kind === 'arm');
  assert.ok(arm, 'the UI arms the hook');
  assert.equal(arm.workspace, WORKSPACE);
  assert.equal(arm.contact, CONTACT);
  assert.equal(arm.lifetime.mode, 'relative');
  assert.equal(arm.lifetime.delayMs, 30 * 86400000);
  assert.equal(arm.lifetime.expiresAt, undefined, 'a preset never sends an instant');
  assert.equal(arm.days, undefined, 'the day field is gone from the wire');
});

test('the bridge routes save results to the composer and observations to cleanup', () => {
  const win = loadSidebar();
  win.refreshTemporaryNoteControls();
  const toggle = win.document.querySelector('input[aria-label="Auto-delete"]');
  toggle.checked = true;
  toggle.dispatchEvent(new win.Event('change'));
  const state = win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`);

  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-save', token: state.token, revision: state.revision, status: 'failed', reason: 'http-422' }
  });
  assert.equal(state.status, 'failed');
  assert.match(state.error, /not saved/);
  const status = win.ISA_TEMPORARY_NOTES_UI.getPanel().status;
  assert.equal(status.hidden, false, 'a failure always shows the status line');
  assert.match(status.textContent, /not saved/);

  let observed = 0;
  win.scheduleTemporaryNoteCleanupFromObservation = () => { observed += 1; };
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-notes', workspace: WORKSPACE, notes: [] }
  });
  assert.equal(observed, 1, 'a note observation schedules a cleanup pass');
});

test('the cleanup pause stays in storage and out of the interface', async () => {
  const popup = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'popup.html'), 'utf8');
  assert.equal(popup.includes('isaPauseAutomaticNoteCleanup'), false, 'the popup exposes no pause control');
  assert.equal(popup.includes('Pause automatic note cleanup'), false);

  const composer = loadSidebar();
  composer.refreshTemporaryNoteControls();
  assert.equal(composer.document.querySelectorAll('.isa-temporary-note-controls input[type="checkbox"]').length, 1,
    'the composer carries only the per-note toggle');

  const win = loadSidebar({ paused: true });
  win.initTemporaryNoteControls();
  await settled();
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.isPaused(), true, 'the stored key still pauses this browser');
  win.ISA_NOTE_RUNTIME.refreshContext();
  win.ISA_NOTE_RUNTIME.check();
  assert.equal(win.ISA_NOTE_RUNTIME.getController().isPaused(), true);
});

test('turning the pause key on pauses a cleanup controller that already exists, before the next check', async () => {
  const win = loadSidebar();
  win.initTemporaryNoteControls();
  await settled();
  win.ISA_NOTE_RUNTIME.refreshContext();
  const controller = win.ISA_NOTE_RUNTIME.getController();
  assert.equal(controller.isPaused(), false);
  win.__chrome.storage.onChanged.__emit({ isaPauseAutomaticNoteCleanup: { newValue: true } });
  assert.equal(controller.isPaused(), true, 'a run in progress stops before its next deletion');
});

test('automatic cleanup runs with no verification gate to pass', () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.refreshContext();
  const state = win.ISA_NOTE_RUNTIME.getController().getState();
  assert.equal(state.paused, false, 'cleanup is live unless the storage key pauses it');
  assert.equal(state.workspaceId, WORKSPACE);
  assert.equal(state.contactId, CONTACT);
});

test('the cleanup adapter uses the verified internal routes and reports the server date', async () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const calls = [];
  win.fetch = (url, init) => {
    calls.push({ url, method: init.method });
    if (url.includes('/ember/users/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: name => (name === 'date' ? 'Tue, 08 Sep 2026 13:00:00 GMT' : null) },
        text: async () => JSON.stringify({ note_ids: [900816031, 900816031, 'bad'] })
      });
    }
    if (url.includes('/ember/inbox/notes')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify([{ id: 900816031, body: 'note', created_at: '2026-09-08T13:00:00.000Z', updated_at: '2026-09-08T13:00:00.000Z' }])
      });
    }
    return Promise.resolve({ ok: true, status: 204, headers: { get: () => null }, text: async () => '' });
  };

  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  const references = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(references.ids), ['900816031'], 'duplicate and malformed ids are dropped');
  assert.equal(references.serverDate, 'Tue, 08 Sep 2026 13:00:00 GMT');

  const note = await win.ISA_NOTE_RUNTIME.adapter.readNote('900816031', context);
  assert.equal(note.body, 'note');

  const deleted = await win.ISA_NOTE_RUNTIME.adapter.deleteNote('900816031', context);
  assert.equal(deleted.status, 204);
  assert.deepEqual(Array.from(calls, call => `${call.method} ${call.url}`), [
    `GET ${ORIGIN}/ember/users/${CONTACT}?app_id=${WORKSPACE}`,
    `GET ${ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}&ids%5B%5D=900816031`,
    `DELETE ${ORIGIN}/ember/notes/900816031?app_id=${WORKSPACE}`
  ]);
});

test('an armed creation request carries a footer the parser accepts', async () => {
  const posted = [];
  const requests = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push({ input, init });
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(init.body).body }), { url: CREATE_URL }));
    }
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();

  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note', lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-1', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));

  await hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' })
  });
  await delay(0);

  const sent = JSON.parse(requests[0].init.body);
  const parsed = loadSidebar().ISA_TEMPORARY_NOTES.parseFooter(sent.body);
  assert.equal(parsed.valid, true, `footer must parse: ${JSON.stringify(parsed)}`);
  assert.equal(parsed.body, 'temporary note');
  assert.equal(parsed.workspaceId, WORKSPACE);
  assert.equal(parsed.contactId, CONTACT);
  assert.equal(parsed.token, 'submission-token-1');
  const save = posted.filter(message => message && message.kind === 'temporary-note-save').pop();
  assert.equal(save && save.status, 'success', 'the echoed footer verifies the save');
});

test('an armed save preserves the rest of the outgoing init object, not just its body', async () => {
  const requests = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push({ input, init });
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(init.body).body }), { url: CREATE_URL }));
    }
  });
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note', lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-init', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));

  await hook.window.fetch(CREATE_URL, {
    method: 'POST',
    headers: { 'x-isa-test': 'kept' },
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' })
  });

  assert.equal(requests[0].init.method, 'POST', 'the method from the original init survives the footer rewrite');
  assert.equal(requests[0].init.headers && requests[0].init.headers['x-isa-test'], 'kept',
    'headers from the original init survive the footer rewrite');
});

test('a non-string body in an otherwise valid echoed response is a response-shape failure, not a footer mismatch', async () => {
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: 12345 }), { url: CREATE_URL }))
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note', lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-shape', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));

  await hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' })
  });
  await delay(0);

  const save = posted.filter(message => message && message.kind === 'temporary-note-save').pop();
  assert.equal(save && save.status, 'uncertain');
  assert.equal(save && save.reason, 'response-shape', 'a non-string echoed body is a shape failure, not a footer mismatch');
});

test('a note saved in another workspace passes through without the armed footer', async () => {
  const requests = [];
  const hook = armedHook(requests);
  const otherWorkspaceUrl = `${ORIGIN}/ember/inbox/notes?app_id=otherws1`;
  const body = JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' });
  await hook.window.fetch(otherWorkspaceUrl, { method: 'POST', body });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body, body, 'another workspace is never rewritten with this workspace footer');
});

test('the same lifetime vectors produce the same verdict in the shared module and the page hook', async () => {
  const shared = loadSidebar().ISA_TEMPORARY_NOTES;
  for (const [lifetime, expected] of LIFETIME_VECTORS) {
    assert.equal(shared.normalizeLifetime(lifetime) !== null, expected,
      `shared module: ${JSON.stringify(lifetime)}`);

    const hook = loadIntercomPageHook({ url: CONVERSATION_URL, fetchImpl: () => Promise.resolve(makeIntercomResponse('{}')) });
    const seen = [];
    hook.window.addEventListener('message', event => seen.push(event.data));
    hook.sendReady();
    hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
      data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'note', lifetime, token: 'vector-token-1', revision: 1 },
      source: hook.window,
      origin: ORIGIN
    }));
    await delay(0);
    const armed = seen.find(message => message && message.kind === 'temporary-note-armed');
    assert.equal(armed.status === 'armed', expected, `page hook: ${JSON.stringify(lifetime)}`);
    if (!expected) assert.equal(armed.reason, 'invalid-arm', JSON.stringify(lifetime));
  }
});

test('an armed absolute date is written to the footer unchanged', async () => {
  const expiresAt = new Date(Date.now() + 5 * 86400000).toISOString();
  const { requests } = await armAndSave({ mode: 'absolute', expiresAt });
  const parsed = loadSidebar().ISA_TEMPORARY_NOTES.parseFooter(JSON.parse(requests[0]).body);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.expiresAtIso, expiresAt, 'the instant the teammate picked is the instant stored');
});

test('an armed relative lifetime expires relative to the submission, not the arm', async () => {
  const armedAt = Date.parse('2026-09-23T12:00:00.000Z');
  const submittedAt = armedAt + 10 * 60000;
  const { requests } = await armAndSave({ mode: 'relative', delayMs: 3600000 },
    { now: armedAt, advanceAfterArmMs: submittedAt - armedAt });
  const parsed = loadSidebar().ISA_TEMPORARY_NOTES.parseFooter(JSON.parse(requests[0]).body);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.expiresAt, submittedAt + 3600000, 'the hour starts at submission, ten minutes after the arm');
});

test('an armed absolute date that has passed blocks the save with expiry-in-past', async () => {
  const passed = new Date(Date.now() - 60000).toISOString();
  const { requests, posted, result } = await armAndSave({ mode: 'absolute', expiresAt: passed });
  assert.deepEqual(requests, [], 'no note is created');
  assert.equal(typeof (result && result.message), 'string', 'the save is refused');
  const save = posted.find(message => message && message.kind === 'temporary-note-save');
  assert.equal(save.status, 'blocked');
  assert.equal(save.reason, 'expiry-in-past');
});

test('an armed absolute date exactly one minute ahead of submission still saves, and a millisecond less does not', async () => {
  const submittedAt = Date.parse('2026-09-23T12:00:00.000Z');
  const exact = await armAndSave({ mode: 'absolute', expiresAt: new Date(submittedAt + 60000).toISOString() }, { now: submittedAt });
  assert.equal(exact.requests.length, 1, 'the save goes through at exactly one minute');

  const short = await armAndSave({ mode: 'absolute', expiresAt: new Date(submittedAt + 59999).toISOString() }, { now: submittedAt });
  assert.deepEqual(short.requests, []);
  const save = short.posted.find(message => message && message.kind === 'temporary-note-save');
  assert.equal(save.reason, 'expiry-in-past');
});

test('a saved auto-delete note shows one short deadline chip and hides the raw footer', () => {
  const win = loadSidebar({ notes: temporaryNoteCard() });
  win.refreshTemporaryNoteFooters();
  const body = noteBodies(win).find(node => node.textContent.includes('ISA-AUTO-DELETE'));
  const paragraphs = [...body.querySelectorAll('p')];
  assert.equal(win.getComputedStyle(paragraphs[0]).display !== 'none', true, 'the note text stays visible');
  assert.equal(paragraphs[0].textContent, 'próba');
  assert.equal(win.getComputedStyle(paragraphs[1]).display, 'none', 'the readable line and marker are hidden');
  const chips = body.querySelectorAll('.isa-temporary-note-chip');
  assert.equal(chips.length, 1, 'exactly one chip is appended');
  assert.equal(chips[0].textContent, 'Expires 2026-09-09 07:55 UTC');
  assert.equal(chips[0].textContent.includes('ISA-AUTO-DELETE'), false, 'the marker never reaches the chip');
  assert.equal(chips[0].textContent.includes('undo'), false);
  assert.match(chips[0].title, /local time$/);
});

test('masking a note footer is idempotent and leaves an ordinary note untouched', () => {
  const win = loadSidebar({ notes: temporaryNoteCard() + savedNote('9', '<p>plain note</p>') });
  win.refreshTemporaryNoteFooters();
  win.refreshTemporaryNoteFooters();
  win.refreshTemporaryNoteFooters();
  const [temporary, ordinary] = noteBodies(win);
  assert.equal(temporary.querySelectorAll('.isa-temporary-note-chip').length, 1,
    'repeated passes never stack chips');
  assert.equal(ordinary.querySelectorAll('.isa-temporary-note-chip').length, 0);
  assert.equal(ordinary.hasAttribute('data-isa-note-footer-owner'), false);
  assert.equal(ordinary.textContent, 'plain note', 'an ordinary note is not rewritten');
  assert.equal(win.getComputedStyle(ordinary.querySelector('p')).display !== 'none', true);
});

test('a settled note footer survives further passes without any DOM mutation', () => {
  const win = loadSidebar({ notes: temporaryNoteCard() });
  win.refreshTemporaryNoteFooters();
  const [temporary] = noteBodies(win);
  const chip = temporary.querySelector('.isa-temporary-note-chip');
  assert.ok(chip);
  const observer = new win.MutationObserver(() => {});
  observer.observe(win.document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  win.refreshTemporaryNoteFooters();
  win.refreshTemporaryNoteFooters();
  const records = observer.takeRecords();
  observer.disconnect();
  assert.deepEqual(records.map(record => `${record.type}:${record.attributeName || ''}`), []);
  assert.equal(temporary.querySelector('.isa-temporary-note-chip'), chip);
});
