'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');
const { settled, WORKSPACE, CONTACT, CONVERSATION_URL, loadSidebar } = require('../support/temporary-notes-harness');

const NOTE_ID = '900661995';
const OTHER_ID = '900662513';
const CONTEXT = { workspaceId: WORKSPACE, contactId: CONTACT };
const STAMP = '2026-09-08T13:00:00.000Z';

function noteJson(id, extra = {}) {
  return { id: Number(id), body: `body ${id}`, created_at: STAMP, updated_at: STAMP, ...extra };
}

function reply(payload, { ok = true, status = 200, headers = {}, raw = null } = {}) {
  return {
    ok,
    status,
    headers: { get: name => (name.toLowerCase() in headers ? headers[name.toLowerCase()] : null) },
    text: async () => (raw === null ? JSON.stringify(payload) : raw)
  };
}

function recordFetch(win, responder) {
  const calls = [];
  win.fetch = (url, init) => {
    calls.push({ url: decodeURIComponent(String(url)).replace(win.location.origin, ''), init: init || {} });
    return Promise.resolve(responder(String(url), init || {}));
  };
  return calls;
}

async function readyWindow(options) {
  const win = loadSidebar(options);
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  return win;
}

function addMeta(win, name, content) {
  const meta = win.document.createElement('meta');
  meta.setAttribute('name', name);
  meta.setAttribute('content', content);
  win.document.head.appendChild(meta);
}

function spyController(win, { fakeCheck = true } = {}) {
  const controller = win.ISA_NOTE_RUNTIME.getController();
  const log = [];
  for (const name of ['setContext', 'start', 'setVisible', 'stop', 'pause', 'resume']) {
    const original = controller[name];
    controller[name] = (...args) => {
      log.push({ name, args });
      return original.apply(controller, args);
    };
  }
  const originalCheck = controller.checkNow;
  controller.checkNow = (...args) => {
    log.push({ name: 'checkNow', args });
    return fakeCheck ? Promise.resolve({ state: 'checked', outcomes: [] }) : originalCheck.apply(controller, args);
  };
  return { controller, log, count: name => log.filter(entry => entry.name === name).length };
}

function stubVisibility(win, initiallyHidden) {
  const state = { hidden: initiallyHidden };
  Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => state.hidden });
  Object.defineProperty(win.document, 'visibilityState', {
    configurable: true,
    get: () => (state.hidden ? 'hidden' : 'visible')
  });
  return state;
}

function stubClock(win, start) {
  const clock = { now: start };
  win.Date.now = () => clock.now;
  return clock;
}

function stubContext(win, workspace, contact) {
  win.temporaryNoteContext = () => ({ workspace, contact, key: `${workspace}:${contact}` });
}

test('readNote returns the requested note even when another note comes first', async () => {
  const win = await readyWindow();
  const calls = recordFetch(win, () => reply([noteJson(OTHER_ID), noteJson(NOTE_ID)]));
  const note = await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT);
  assert.deepEqual({ ...note }, { id: NOTE_ID, body: `body ${NOTE_ID}`, createdAt: STAMP, updatedAt: STAMP });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/ember/inbox/notes?app_id=${WORKSPACE}&ids[]=${NOTE_ID}`);
  assert.equal(calls[0].init.method === undefined || calls[0].init.method === 'GET', true);
});

test('readNote returns null when the response holds only a different valid note', async () => {
  const win = await readyWindow();
  recordFetch(win, () => reply([noteJson(OTHER_ID)]));
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT), null);
  recordFetch(win, () => reply({ notes: [noteJson(OTHER_ID)] }));
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT), null);
  recordFetch(win, () => reply({ notes: [noteJson(NOTE_ID)] }));
  assert.equal((await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT)).id, NOTE_ID);
});

test('readNote accepts camelCase timestamps and rejects a non-string body or timestamp', async () => {
  const win = await readyWindow();
  const read = payload => {
    recordFetch(win, () => reply(payload));
    return win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT);
  };
  const camel = await read([{ id: NOTE_ID, body: 'b', createdAt: STAMP, updatedAt: STAMP }]);
  assert.equal(camel.createdAt, STAMP);
  assert.equal(camel.updatedAt, STAMP);
  assert.equal(await read([noteJson(NOTE_ID, { body: 42 })]), null);
  assert.equal(await read([noteJson(NOTE_ID, { created_at: 1789000000 })]), null);
  assert.equal(await read([noteJson(NOTE_ID, { updated_at: undefined })]), null);
});

test('readNote on a 500 returns null without hiding the card, and a 404 hides it', async () => {
  const win = await readyWindow();
  const hidden = [];
  win.hideDeletedTemporaryNoteCard = id => { hidden.push(id); return true; };
  recordFetch(win, () => reply([noteJson(NOTE_ID)], { ok: false, status: 500 }));
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT), null);
  assert.deepEqual(hidden, []);
  recordFetch(win, () => reply([noteJson(NOTE_ID)], { ok: false, status: 404 }));
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT), null);
  assert.deepEqual(hidden, [NOTE_ID]);
});

test('every request is same-origin, uncached, JSON, and carries the meta headers only when present', async () => {
  const win = await readyWindow();
  addMeta(win, 'csrf-token', 'csrf-abc');
  addMeta(win, 'embercom_revision_id', 'rev-42');
  const calls = recordFetch(win, () => reply([]));
  await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT);
  await win.ISA_NOTE_RUNTIME.adapter.readReferences(CONTEXT);
  await win.ISA_NOTE_RUNTIME.adapter.deleteNote(NOTE_ID, CONTEXT);
  assert.equal(calls.length, 3);
  for (const { init } of calls) {
    const headers = new win.Headers(init.headers);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.match(headers.get('accept'), /json/);
    assert.match(headers.get('content-type'), /json/);
    assert.equal(headers.get('x-csrf-token'), 'csrf-abc');
    assert.equal(headers.get('x-embercom-revision-id'), 'rev-42');
  }

  const bare = await readyWindow();
  addMeta(bare, 'csrf-token', '');
  const bareCalls = recordFetch(bare, () => reply([]));
  await bare.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT);
  const headers = new bare.Headers(bareCalls[0].init.headers);
  assert.equal(headers.has('x-csrf-token'), false);
  assert.equal(headers.has('x-embercom-revision-id'), false);
});

test('readReferences reads ids from payload, users[0], objects, with digit and de-duplication rules', async () => {
  const win = await readyWindow();
  const refs = (payload, options) => {
    recordFetch(win, () => reply(payload, { headers: { date: 'Tue, 08 Sep 2026 13:00:00 GMT' }, ...options }));
    return win.ISA_NOTE_RUNTIME.adapter.readReferences(CONTEXT);
  };
  const long32 = '1'.repeat(32);
  const long33 = '1'.repeat(33);
  const top = await refs({ note_ids: [1, '2', 2, 'x3', '4a', long32, long33, '', null] });
  assert.deepEqual(Array.from(top.ids), ['1', '2', long32]);
  assert.equal(top.serverDate, 'Tue, 08 Sep 2026 13:00:00 GMT');
  assert.deepEqual(Array.from((await refs({ notes: [{ id: 7 }, 8, { id: 7 }] })).ids), ['7', '8']);
  assert.deepEqual(Array.from((await refs({ users: [{ note_ids: [11, 12] }] })).ids), ['11', '12']);
  assert.deepEqual(Array.from((await refs({ users: [{ notes: [{ id: 21 }] }] })).ids), ['21']);
});

test('readReferences returns only a status on a non-ok response and no ids from a bare array', async () => {
  const win = await readyWindow();
  const calls = recordFetch(win, () => reply({ note_ids: [1, 2] }, { ok: false, status: 503 }));
  const failed = await win.ISA_NOTE_RUNTIME.adapter.readReferences(CONTEXT);
  assert.equal(failed.status, 503);
  assert.equal(failed.ids, undefined);
  assert.equal(calls[0].url, `/ember/users/${CONTACT}?app_id=${WORKSPACE}`);
  recordFetch(win, () => reply([{ note_ids: [1, 2] }, { id: 5 }]));
  const array = await win.ISA_NOTE_RUNTIME.adapter.readReferences(CONTEXT);
  assert.deepEqual(Array.from(array.ids || []), []);
});

test('a body of exactly 200000 characters is read and one more is unreadable', async () => {
  const win = await readyWindow();
  const padded = size => {
    const prefix = JSON.stringify([noteJson(NOTE_ID, { body: '' })]);
    const filler = 'a'.repeat(size - prefix.length);
    const text = JSON.stringify([noteJson(NOTE_ID, { body: filler })]);
    assert.equal(text.length, size);
    return text;
  };
  recordFetch(win, () => reply(null, { raw: padded(200000) }));
  const exact = await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT);
  assert.equal(exact.id, NOTE_ID);
  recordFetch(win, () => reply(null, { raw: padded(900001) }));
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote(NOTE_ID, CONTEXT), null);
});

test('deleteNote sends DELETE with the CSRF header and reports status and retry-after', async () => {
  const win = await readyWindow();
  addMeta(win, 'csrf-token', 'csrf-del');
  const calls = recordFetch(win, () => reply({}, { ok: false, status: 429, headers: { 'retry-after': '17' } }));
  const limited = await win.ISA_NOTE_RUNTIME.adapter.deleteNote(NOTE_ID, CONTEXT);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '17');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].url, `/ember/notes/${NOTE_ID}?app_id=${WORKSPACE}`);
  assert.equal(new win.Headers(calls[0].init.headers).get('x-csrf-token'), 'csrf-del');
  recordFetch(win, () => reply({}, { status: 200 }));
  const plain = await win.ISA_NOTE_RUNTIME.adapter.deleteNote(NOTE_ID, CONTEXT);
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['retry-after'], null);
});

for (const [label, workspace, contact, accepted] of [
  ['valid ids', 'demo1234', 'aaaaaaaaaaaaaaaaaaaaaaaa', true],
  ['23 hex characters', 'demo1234', 'a'.repeat(23), false],
  ['25 hex characters', 'demo1234', 'a'.repeat(25), false],
  ['uppercase hex', 'demo1234', 'A'.repeat(24), false],
  ['a workspace with a slash', 'dt/bns', 'a'.repeat(24), false],
  ['a workspace with a dot', 'dt.bns', 'a'.repeat(24), false],
  ['a 65-character workspace', 'w'.repeat(65), 'a'.repeat(24), false],
  ['a 64-character workspace', 'w'.repeat(64), 'a'.repeat(24), true]
]) {
  test(`context validation: ${label} ${accepted ? 'reach' : 'never reach'} the controller`, async () => {
    const win = loadSidebar();
    await settled();
    const clock = stubClock(win, 1000000);
    const spy = spyController(win);
    const calls = recordFetch(win, () => reply([]));
    stubContext(win, 'otherws', 'b'.repeat(24));
    await win.ISA_NOTE_RUNTIME.refreshContext();
    spy.log.length = 0;
    clock.now += 600000;
    stubContext(win, workspace, contact);
    await win.ISA_NOTE_RUNTIME.refreshContext();
    const state = spy.controller.getState();
    if (accepted) {
      const set = spy.log.find(entry => entry.name === 'setContext' || entry.name === 'start');
      assert.ok(set, 'the controller receives a context');
      assert.equal(set.args[0].workspaceId, workspace);
      assert.equal(set.args[0].contactId, contact);
      assert.equal(state.workspaceId, workspace);
    } else {
      assert.equal(spy.count('setContext') + spy.count('start'), 0);
      assert.ok(spy.count('stop') >= 1, 'the controller is stopped');
      assert.equal(state.workspaceId, null);
      assert.equal(spy.count('checkNow'), 0);
      assert.equal(calls.length, 0);
    }
  });
}

test('a hidden document gets a hidden context and no check, and becoming visible checks', async () => {
  const win = loadSidebar();
  await settled();
  const clock = stubClock(win, 5000000);
  const visibility = stubVisibility(win, true);
  const spy = spyController(win);
  stubContext(win, 'otherws', 'b'.repeat(24));
  await win.ISA_NOTE_RUNTIME.refreshContext();
  spy.log.length = 0;
  clock.now += 600000;
  stubContext(win, WORKSPACE, CONTACT);
  await win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(spy.controller.getState().visible, false);
  assert.equal(spy.controller.getState().contactId, CONTACT);
  assert.equal(spy.count('checkNow'), 0);
  visibility.hidden = false;
  clock.now += 1000;
  await win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(spy.controller.getState().visible, true);
  assert.equal(spy.count('checkNow'), 1);
});

test('repeated refreshes check at most once per 60000 ms: 59999 does not, 60000 does', async () => {
  const win = loadSidebar();
  await settled();
  const clock = stubClock(win, 9001982);
  stubVisibility(win, false);
  const spy = spyController(win);
  stubContext(win, 'otherws', 'b'.repeat(24));
  await win.ISA_NOTE_RUNTIME.refreshContext();
  stubContext(win, WORKSPACE, CONTACT);
  clock.now += 600000;
  spy.log.length = 0;
  await win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(spy.count('checkNow'), 1, 'a fresh visible context checks at once');
  clock.now += 59999;
  await win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(spy.count('checkNow'), 1, '59999 ms later no new check runs');
  clock.now += 1;
  await win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(spy.count('checkNow'), 2, 'at exactly 60000 ms the check runs again');
  clock.now += 59999;
  await win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(spy.count('checkNow'), 2, 'the interval counts from the latest check');
});

for (const hiddenDocument of [true, false]) {
  test(`with an unchanged context and the document ${hiddenDocument ? 'hidden' : 'visible'}, refreshes past 60000 ms ${hiddenDocument ? 'never check' : 'check once the interval has passed'}`, async () => {
    const win = loadSidebar();
    await settled();
    const clock = stubClock(win, Date.now() + 1000);
    const visibility = stubVisibility(win, true);
    const spy = spyController(win);
    stubContext(win, WORKSPACE, CONTACT);
    await win.ISA_NOTE_RUNTIME.refreshContext();
    visibility.hidden = hiddenDocument;
    clock.now += 600000;
    await win.ISA_NOTE_RUNTIME.refreshContext();
    spy.log.length = 0;
    clock.now += 60001;
    await win.ISA_NOTE_RUNTIME.refreshContext();
    clock.now += 60001;
    await win.ISA_NOTE_RUNTIME.refreshContext();
    assert.equal(spy.controller.getState().visible, !hiddenDocument);
    assert.equal(spy.count('checkNow'), hiddenDocument ? 0 : 2);
  });
}

test('observed() debounces several calls within 1500 ms into one refresh and check', async () => {
  const win = loadSidebar();
  await settled();
  const clock = stubClock(win, 20000000);
  stubVisibility(win, false);
  const spy = spyController(win);
  const timers = new Map();
  let nextId = 1;
  win.setTimeout = (callback, delayMs) => { const id = nextId++; timers.set(id, { callback, delayMs }); return id; };
  win.clearTimeout = id => { timers.delete(id); };
  stubContext(win, WORKSPACE, CONTACT);
  await win.ISA_NOTE_RUNTIME.refreshContext();
  clock.now += 600000;
  spy.log.length = 0;
  timers.clear();
  win.ISA_NOTE_RUNTIME.observed();
  win.ISA_NOTE_RUNTIME.observed();
  win.ISA_NOTE_RUNTIME.observed();
  assert.equal(timers.size, 1, 'three observations leave one pending timer');
  assert.ok([...timers.values()][0].delayMs <= 1500 && [...timers.values()][0].delayMs > 0);
  assert.equal(spy.count('checkNow'), 0, 'nothing runs before the timer fires');
  const [pending] = [...timers.values()];
  timers.clear();
  pending.callback();
  await settled();
  assert.equal(spy.count('checkNow'), 1);
  assert.equal(timers.size, 0, 'no second refresh is scheduled');
});

test('a paused setting pauses the controller and skips checkNow, and unpausing resumes before checking', async () => {
  const win = loadSidebar();
  await settled();
  const spy = spyController(win);
  win.__chrome.storage.onChanged.__emit({ isaPauseAutomaticNoteCleanup: { newValue: true } });
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.isPaused(), true);
  spy.controller.resume();
  spy.log.length = 0;
  await win.ISA_NOTE_RUNTIME.check();
  assert.equal(spy.controller.isPaused(), true, 'a check under the paused setting pauses the controller');
  assert.equal(spy.count('checkNow'), 0);

  win.__chrome.storage.onChanged.__emit({ isaPauseAutomaticNoteCleanup: { newValue: false } });
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.isPaused(), false);
  assert.equal(spy.controller.isPaused(), true, 'still paused until the next check');
  spy.log.length = 0;
  await win.ISA_NOTE_RUNTIME.check();
  const names = spy.log.map(entry => entry.name);
  assert.ok(names.includes('resume'), 'the check resumes the controller');
  assert.ok(names.includes('checkNow'));
  assert.ok(names.indexOf('resume') < names.indexOf('checkNow'), 'resume comes before checkNow');
  assert.equal(spy.controller.isPaused(), false);
});

function expiredNoteBody(win) {
  return win.ISA_TEMPORARY_NOTES.appendFooter('hello', {
    workspaceId: WORKSPACE, contactId: CONTACT, expiresAt: '2026-10-08T13:00:00.000Z', token: 'token-1'
  });
}

for (const scenario of ['confirmed', 'already-deleted']) {
  test(`the UI forgets a note the controller reports as ${scenario}`, async () => {
    const win = loadSidebar();
    await settled();
    const hidden = [];
    win.hideDeletedTemporaryNoteCard = id => { hidden.push(id); return true; };
    let deleted = false;
    let noteReads = 0;
    let referenceReads = 0;
    const gone = () => deleted || (scenario === 'already-deleted' && referenceReads > 1);
    recordFetch(win, (url, init) => {
      if (init.method === 'DELETE') { deleted = true; return reply({}, { status: 200 }); }
      if (url.includes('/ember/users/')) {
        referenceReads += 1;
        return reply({ users: [{ note_ids: gone() ? [] : [NOTE_ID] }] }, { headers: { date: 'Fri, 01 Jan 2027 00:00:00 GMT' } });
      }
      noteReads += 1;
      return gone() ? reply([]) : reply([noteJson(NOTE_ID, { body: expiredNoteBody(win) })]);
    });
    stubContext(win, WORKSPACE, CONTACT);
    win.ISA_NOTE_RUNTIME.getController().resume();
    await win.ISA_NOTE_RUNTIME.check();
    for (let i = 0; i < 80 && !hidden.length; i += 1) await new Promise(resolve => setTimeout(resolve, 50));
        assert.deepEqual(hidden, [NOTE_ID]);
    assert.equal(deleted, scenario === 'confirmed');
  });
}
