'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const footerSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'intercom-temporary-notes.js'), 'utf8');
const cleanupSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'intercom-note-cleanup.js'), 'utf8');

function load() {
  const context = vm.createContext({ console, Date, setTimeout, clearTimeout });
  vm.runInContext(footerSource, context, { filename: 'intercom-temporary-notes.js' });
  vm.runInContext(cleanupSource, context, { filename: 'intercom-note-cleanup.js' });
  return context;
}

const WORKSPACE = 'workspace-1';
const CONTACT = 'contact-1';
const CREATED = '2026-09-08T13:00:00.000Z';
const EXPIRED = '2026-10-08T13:00:00.000Z';
const SERVER_NOW = '2026-10-08T13:00:00.000Z';

function note(win, id = 'note-1', overrides = {}) {
  return {
    id,
    body: win.ISA_TEMPORARY_NOTES.appendFooter('temporary note', {
      workspaceId: WORKSPACE,
      contactId: CONTACT,
      expiresAt: EXPIRED,
      token: `token-${id}`
    }),
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides
  };
}

function adapterFor(notes, overrides = {}) {
  const state = { notes: new Map(Object.entries(notes)), deletes: [], leases: [] };
  const adapter = {
    readReferences: async () => ({
      ids: Array.from(state.notes.keys()),
      serverDate: SERVER_NOW
    }),
    readNote: async id => state.notes.get(id) || null,
    deleteNote: async id => {
      state.deletes.push(id);
      state.notes.delete(id);
      return { status: 204 };
    },
    acquireLease: async request => {
      state.leases.push(['acquire', request.noteId]);
      return { ok: true, lease: { ownerToken: `lease-${request.noteId}` } };
    },
    releaseLease: async request => {
      state.leases.push(['release', request.noteId, request.ownerToken]);
      return { ok: true, released: true };
    },
    ...overrides
  };
  return { state, adapter };
}

function controller(win, adapter, overrides = {}) {
  return win.ISA_NOTE_CLEANUP.createController({
    adapter,
    footer: win.ISA_TEMPORARY_NOTES,
    now: () => Date.parse(SERVER_NOW),
    timing: { minGapMs: 0, timeoutMs: 15000 },
    wait: async () => {},
    ...overrides
  });
}

const BASE_NOW = Date.parse(SERVER_NOW);
const kinds = result => Array.from(result.outcomes, value => value.kind);

function removing(response) {
  return state => async id => {
    state.deletes.push(id);
    state.notes.delete(id);
    return typeof response === 'function' ? response() : response;
  };
}

function keeping(response) {
  return state => async id => {
    state.deletes.push(id);
    return typeof response === 'function' ? response() : response;
  };
}

function throwing(value) {
  return state => async id => {
    state.deletes.push(id);
    throw value;
  };
}

async function run({ refs, del, readNote, notes, ctl = {} } = {}) {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win, 'note-1', notes || {}) });
  const counts = { readReferences: 0 };
  const events = { confirmed: [], already: [], status: [] };
  const baseRefs = adapter.readReferences;
  adapter.readReferences = async () => {
    counts.readReferences += 1;
    return refs ? refs(state) : baseRefs();
  };
  if (del) adapter.deleteNote = del(state);
  if (readNote) adapter.readNote = readNote(state);
  const cleanup = controller(win, adapter, {
    onConfirmedDeleted: value => events.confirmed.push(value),
    onAlreadyDeleted: value => events.already.push(value),
    onStatus: value => events.status.push(value),
    ...ctl
  });
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const result = await cleanup.checkNow();
  return { win, state, adapter, cleanup, result, counts, events };
}

const withTime = fields => state => ({ ids: Array.from(state.notes.keys()), ...fields });


for (const [label, fields] of [
  ['serverDate ISO string', { serverDate: EXPIRED }],
  ['serverDate ISO string padded with whitespace', { serverDate: `  \n${EXPIRED}\t ` }],
  ['serverDate numeric ms epoch', { serverDate: Date.parse(EXPIRED) }],
  ['serverDate Date object', { serverDate: new Date(EXPIRED) }],
  ['dateHeader when serverDate is absent', { dateHeader: EXPIRED }],
  ['serverNow when serverDate and dateHeader are absent', { serverNow: EXPIRED }],
  ['headers.date when the three direct fields are absent', { headers: { date: EXPIRED } }],
  ['headers.Date when the three direct fields and headers.date are absent', { headers: { Date: EXPIRED } }],
  ['dateHeader when serverDate is explicitly undefined', { serverDate: undefined, dateHeader: EXPIRED }]
]) {
  test(`server time from ${label} deletes an expired note`, async () => {
    const { result, state } = await run({ refs: withTime(fields) });
    assert.deepEqual(kinds(result), ['deleted']);
    assert.deepEqual(state.deletes, ['note-1']);
  });
}

for (const [label, fields] of [
  ['serverDate wins over dateHeader', { serverDate: CREATED, dateHeader: EXPIRED, serverNow: EXPIRED }],
  ['dateHeader wins over serverNow', { dateHeader: CREATED, serverNow: EXPIRED }],
  ['serverNow wins over headers.date', { serverNow: CREATED, headers: { date: EXPIRED } }],
  ['headers.date wins over headers.Date', { headers: { date: CREATED, Date: EXPIRED } }]
]) {
  test(`server time urgent: ${label}`, async () => {
    const { result, state } = await run({ refs: withTime(fields) });
    assert.deepEqual(kinds(result), []);
    assert.deepEqual(state.deletes, []);
  });
}

test('a server time before the expiry deletes nothing', async () => {
  const { result, state } = await run({ refs: withTime({ serverDate: CREATED }) });
  assert.deepEqual(kinds(result), []);
  assert.deepEqual(state.deletes, []);
});

for (const [label, bad] of [
  ['an empty string', ''],
  ['a whitespace-only string', ' \t\n '],
  ['an unparseable string', 'not a date'],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['an invalid Date', new Date('nope')]
]) {
  test(`${label} as serverDate defers with missing-server-time`, async () => {
    const { result, state } = await run({ refs: withTime({ serverDate: bad }) });
    assert.deepEqual({ state: result.state, reason: result.reason }, { state: 'deferred', reason: 'missing-server-time' });
    assert.deepEqual(state.deletes, []);
  });
}

for (const [label, fields] of [
  ['serverDate', { serverDate: '', dateHeader: EXPIRED, serverNow: EXPIRED, headers: { date: EXPIRED } }],
  ['dateHeader', { dateHeader: NaN, serverNow: EXPIRED, headers: { date: EXPIRED } }],
  ['serverNow', { serverNow: new Date('nope'), headers: { date: EXPIRED, Date: EXPIRED } }]
]) {
  test(`a present but invalid ${label} does not fall through to later fields`, async () => {
    const { result, state } = await run({ refs: withTime(fields) });
    assert.equal(result.state, 'deferred');
    assert.equal(result.reason, 'missing-server-time');
    assert.deepEqual(state.deletes, []);
  });
}

async function limited(headers, how = 'resolve') {
  const response = headers === undefined ? { status: 429 } : { status: 429, headers };
  return run({ del: how === 'resolve' ? keeping(response) : throwing(response) });
}

for (const [label, headers, wait] of [
  ['retry-after number 7', { 'retry-after': 7 }, 7000],
  ['Retry-After number 5', { 'Retry-After': 5 }, 5000],
  ['retry-after numeric string padded with spaces', { 'retry-after': ' 5 ' }, 5000],
  ['Retry-After string 0', { 'Retry-After': '0' }, 0],
  ['retry-after number 0', { 'retry-after': 0 }, 0],
  ['retry-after negative string', { 'retry-after': '-5' }, 60000],
  ['retry-after negative decimal string', { 'retry-after': '-0.5' }, 60000],
  ['Retry-After HTTP date 90 s ahead', { 'Retry-After': new Date(BASE_NOW + 90000).toUTCString() }, 90000],
  ['retry-after HTTP date in the past', { 'retry-after': new Date(BASE_NOW - 90000).toUTCString() }, 0],
  ['retry-after negative number', { 'retry-after': -5 }, 60000],
  ['retry-after empty string', { 'retry-after': '' }, 60000],
  ['retry-after unparseable string', { 'retry-after': 'soon' }, 60000],
  ['empty headers', {}, 60000],
  ['no headers at all', undefined, 60000]
]) {
  test(`429 with ${label} sets cooldownUntil to now + ${wait} ms`, async () => {
    const { result, cleanup, events } = await limited(headers);
    assert.deepEqual(kinds(result), ['rate-limited']);
    assert.equal(cleanup.getState().cooldownUntil, BASE_NOW + wait);
    const status = events.status.find(value => value.state === 'rate-limited');
    assert.ok(status, 'onStatus must receive rate-limited');
    assert.equal(status.cooldownUntil, BASE_NOW + wait);
  });
}

test('a rejected delete carrying a 429 is rate-limited with its retry-after', async () => {
  const { result, cleanup } = await limited({ 'retry-after': 7 }, 'reject');
  assert.deepEqual(kinds(result), ['rate-limited']);
  assert.equal(cleanup.getState().cooldownUntil, BASE_NOW + 7000);
});

test('while the cooldown is active the next check skips readReferences', async () => {
  const { cleanup, counts } = await limited({ 'retry-after': 30 });
  const before = counts.readReferences;
  const second = await cleanup.checkNow();
  assert.equal(second.state, 'rate-limited');
  assert.equal(second.cooldownUntil, BASE_NOW + 30000);
  assert.equal(counts.readReferences, before);
});

test('a zero cooldown equals now and does not block the next check', async () => {
  const { cleanup, counts } = await limited({ 'retry-after': '0' });
  const before = counts.readReferences;
  const second = await cleanup.checkNow();
  assert.ok(counts.readReferences > before);
  assert.deepEqual(kinds(second), ['rate-limited']);
});


for (const status of [401, 403]) {
  test(`${status} stops auth, blocks the workspace and the next check`, async () => {
    const { result, cleanup } = await run({ del: keeping({ status }) });
    assert.deepEqual(kinds(result), ['auth-stopped']);
    assert.ok(Array.from(cleanup.getState().blockedWorkspaceIds).includes(WORKSPACE));
    assert.equal((await cleanup.checkNow()).state, 'auth-stopped');
  });
}

for (const status of [200, 204, 299]) {
  test(`${status} with the note absent on reread is deleted and confirmed`, async () => {
    const { result, events } = await run({ del: removing({ status }) });
    assert.deepEqual(kinds(result), ['deleted']);
    assert.equal(events.confirmed.length, 1);
    assert.equal(events.confirmed[0].noteId, 'note-1');
    assert.equal(events.confirmed[0].workspaceId, WORKSPACE);
    assert.equal(events.confirmed[0].contactId, CONTACT);
  });

  test(`${status} with the note still readable on reread is verification-pending`, async () => {
    const { result, events } = await run({ del: keeping({ status }) });
    assert.deepEqual(kinds(result), ['verification-pending']);
    assert.deepEqual(events.confirmed, []);
  });
}

for (const [label, response] of [
  ['199', { status: 199 }],
  ['300', { status: 300 }],
  ['400', { status: 400 }],
  ['600', { status: 600 }],
  ['no status', {}]
]) {
  test(`delete response ${label} is unexpected-delete-response`, async () => {
    const { result, state, events } = await run({ del: keeping(response) });
    assert.deepEqual(kinds(result), ['unexpected-delete-response']);
    assert.equal(state.deletes.length, 1);
    assert.deepEqual(events.confirmed, []);
  });
}

test('statusCode is read as the delete status', async () => {
  const { result } = await run({ del: removing({ statusCode: 204 }) });
  assert.deepEqual(kinds(result), ['deleted']);
});

test('statusCode 401 stops auth', async () => {
  const { result } = await run({ del: keeping({ statusCode: 401 }) });
  assert.deepEqual(kinds(result), ['auth-stopped']);
});

test('a nested error.status 403 stops auth', async () => {
  const { result } = await run({ del: keeping({ error: { status: 403 } }) });
  assert.deepEqual(kinds(result), ['auth-stopped']);
});

test('a rejected delete carrying a nested error.status 404 with the note absent is already-deleted', async () => {
  const { result } = await run({
    del: state => async id => {
      state.deletes.push(id);
      state.notes.delete(id);
      throw { error: { status: 404 } };
    }
  });
  assert.deepEqual(kinds(result), ['already-deleted']);
});

test('404 with the note still present is verification-pending', async () => {
  const { result, events } = await run({ del: keeping({ status: 404 }) });
  assert.deepEqual(kinds(result), ['verification-pending']);
  assert.deepEqual(events.already, []);
});

const retryTiming = extra => ({ timing: { minGapMs: 0, timeoutMs: 15000, ...extra } });

for (const status of [500, 503, 599]) {
  test(`${status} is retried until maxAttempts 2 is exhausted`, async () => {
    const { result, state } = await run({ del: keeping({ status }), ctl: retryTiming({ maxAttempts: 2 }) });
    assert.deepEqual(kinds(result), ['retry-exhausted']);
    assert.equal(state.deletes.length, 2);
  });
}

test('maxAttempts 1 makes a single delete call before giving up', async () => {
  const { state } = await run({ del: keeping({ status: 503 }), ctl: retryTiming({ maxAttempts: 1 }) });
  assert.equal(state.deletes.length, 1);
});

test('503 then 204 succeeds on the retry', async () => {
  let n = 0;
  const { result, state } = await run({
    del: state => async id => {
      state.deletes.push(id);
      n += 1;
      if (n === 1) return { status: 503 };
      state.notes.delete(id);
      return { status: 204 };
    },
    ctl: retryTiming({ maxAttempts: 2 })
  });
  assert.deepEqual(kinds(result), ['deleted']);
  assert.equal(state.deletes.length, 2);
});

for (const [label, maxAttempts, calls] of [
  ['3', 3, 3],
  ['4 is clamped to 3', 4, 3],
  ['10 is clamped to 3', 10, 3],
  ['0 falls back to 3', 0, 3],
  ['-1 falls back to 3', -1, 3],
  ['2.5 falls back to 3', 2.5, 3]
]) {
  test(`maxAttempts ${label}: ${calls} delete calls then retry-exhausted`, async () => {
    const clock = { t: BASE_NOW };
    const { result, state } = await run({
      del: keeping({ status: 503 }),
      ctl: {
        now: () => clock.t,
        wait: async () => { clock.t -= 1000000; },
        ...retryTiming({ maxAttempts })
      }
    });
    assert.deepEqual(kinds(result), ['retry-exhausted']);
    assert.equal(state.deletes.length, calls);
  });
}

test('a retry whose delay plus timeout stays inside the 60 s lease is attempted', async () => {
  const { result, state } = await run({ del: keeping({ status: 503 }), ctl: retryTiming({ maxAttempts: 2, timeoutMs: 15000 }) });
  assert.deepEqual(kinds(result), ['retry-exhausted']);
  assert.equal(state.deletes.length, 2);
});

test('a retry landing exactly on the lease deadline is still attempted', async () => {
  const { state } = await run({ del: keeping({ status: 503 }), ctl: retryTiming({ maxAttempts: 2, timeoutMs: 30000 }) });
  assert.equal(state.deletes.length, 2);
});

test('a retry whose delay plus timeout passes the lease deadline is retry-deferred after one call', async () => {
  const { result, state } = await run({ del: keeping({ status: 503 }), ctl: retryTiming({ maxAttempts: 2, timeoutMs: 40000 }) });
  assert.deepEqual(kinds(result), ['retry-deferred']);
  assert.equal(state.deletes.length, 1);
});


function rereadAs(first, second) {
  return state => {
    let reads = 0;
    return async id => {
      reads += 1;
      if (!state.notes.has(id)) return null;
      const base = state.notes.get(id);
      return { ...base, ...(reads === 1 ? first : second) };
    };
  };
}

for (const [label, first, second] of [
  ['version 1 to 2', { version: 1 }, { version: 2 }],
  ['version undefined to 1', {}, { version: 1 }],
  ['version 1 to undefined', { version: 1 }, {}],
  ['version 0 to undefined', { version: 0 }, {}],
  ['updatedAt differing by 1 ms', { updatedAt: CREATED }, { updatedAt: '2026-09-08T13:00:00.001Z' }]
]) {
  test(`${label} between scan and reread is stale-version and nothing is deleted`, async () => {
    const { result, state } = await run({ readNote: rereadAs(first, second) });
    assert.deepEqual(kinds(result), ['stale-version']);
    assert.deepEqual(state.deletes, []);
  });
}

for (const [label, first, second] of [
  ['the same version 3', { version: 3 }, { version: 3 }],
  ['neither read having a version', {}, {}],
  ['updatedAt in two spellings of one instant', { updatedAt: '2026-09-08T13:00:00.000Z' }, { updatedAt: '2026-09-08T13:00:00Z' }]
]) {
  test(`${label} lets the delete proceed`, async () => {
    const { result, state } = await run({ readNote: rereadAs(first, second) });
    assert.deepEqual(kinds(result), ['deleted']);
    assert.deepEqual(state.deletes, ['note-1']);
  });
}
