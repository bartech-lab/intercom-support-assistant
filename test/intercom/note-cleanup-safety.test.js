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
  const state = { notes: new Map(Object.entries(notes)), deletes: [], leases: [], refs: 0, reads: [] };
  const adapter = {
    readReferences: async () => {
      state.refs += 1;
      return { ids: Array.from(state.notes.keys()), serverDate: SERVER_NOW };
    },
    readNote: async id => {
      state.reads.push(id);
      return state.notes.get(id) || null;
    },
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

function ready(win, adapter, overrides) {
  const cleanup = controller(win, adapter, overrides);
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  return cleanup;
}

function gate() {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  return { promise, open };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await new Promise(resolve => setImmediate(resolve));
}

test('pause during the first delete stops the second note from being deleted', async () => {
  const win = load();
  const hold = gate();
  const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
  const base = adapter.deleteNote;
  let calls = 0;
  adapter.deleteNote = async id => {
    calls += 1;
    if (calls === 1) await hold.promise;
    return base(id);
  };
  const cleanup = ready(win, adapter);
  const checking = cleanup.checkNow();
  await settle();
  assert.equal(calls, 1);
  cleanup.pause('setting');
  hold.open();
  await checking;
  assert.equal(cleanup.isPaused(), true);
  assert.ok(state.deletes.length <= 1, `deleted after pause: ${state.deletes}`);
  assert.equal(state.deletes.includes('note-2'), false);
});

test('pause during the first lease acquisition prevents any deletion after the pause', async () => {
  const win = load();
  const hold = gate();
  const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
  const base = adapter.acquireLease;
  let calls = 0;
  adapter.acquireLease = async request => {
    calls += 1;
    if (calls === 1) await hold.promise;
    return base(request);
  };
  const cleanup = ready(win, adapter);
  const checking = cleanup.checkNow();
  await settle();
  assert.equal(calls, 1);
  cleanup.pause('setting');
  hold.open();
  await checking;
  assert.deepEqual(state.deletes, []);
});

for (const [label, rejection] of [
  ['with Retry-After', { status: 429, headers: { 'Retry-After': '60' } }],
  ['without headers', { status: 429 }]
]) {
  test(`a 429 on the first note read ${label} stops the run and sets a cooldown`, async () => {
    const win = load();
    const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
    const base = adapter.readNote;
    adapter.readNote = async id => {
      if (id === 'note-1') {
        state.reads.push(id);
        throw rejection;
      }
      return base(id);
    };
    const cleanup = ready(win, adapter);
    const result = await cleanup.checkNow();
    assert.equal(result.state, 'rate-limited');
    assert.ok(cleanup.getState().cooldownUntil > Date.parse(SERVER_NOW));
    assert.deepEqual(state.deletes, []);
    assert.equal(state.reads.includes('note-2'), false);
  });
}

test('after a 429 on a note read the next check in the same instant skips every read', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
  adapter.readNote = async id => {
    state.reads.push(id);
    throw { status: 429, headers: { 'Retry-After': '60' } };
  };
  const cleanup = ready(win, adapter);
  await cleanup.checkNow();
  const refs = state.refs;
  const reads = state.reads.length;
  const second = await cleanup.checkNow();
  assert.equal(second.state, 'rate-limited');
  assert.equal(state.refs, refs);
  assert.equal(state.reads.length, reads);
  assert.deepEqual(state.deletes, []);
});

for (const [label, failure] of [
  ['a rejection without a status', () => { throw new Error('network down'); }],
  ['a 500 rejection', () => { throw { status: 500 }; }]
]) {
  test(`${label} on the first note read skips only that note`, async () => {
    const win = load();
    const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
    const base = adapter.readNote;
    adapter.readNote = async id => {
      if (id === 'note-1') failure();
      return base(id);
    };
    const cleanup = ready(win, adapter);
    const result = await cleanup.checkNow();
    assert.notEqual(result.state, 'rate-limited');
    assert.deepEqual(state.deletes, ['note-2']);
  });
}

for (const [label, failure] of [
  ['rejects', async () => { throw new Error('lease backend down'); }],
  ['throws synchronously', () => { throw new Error('lease backend down'); }]
]) {
  test(`a lease acquisition that ${label} for one note does not abort the run`, async () => {
    const win = load();
    const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
    const base = adapter.acquireLease;
    adapter.acquireLease = request => (request.noteId === 'note-1' ? failure() : base(request));
    const cleanup = ready(win, adapter);
    const result = await cleanup.checkNow();
    assert.equal(result.state, 'checked');
    const first = Array.from(result.outcomes).find(value => value.noteId === 'note-1');
    assert.ok(first, 'the first note must have an outcome');
    assert.equal(first.kind, 'lease-failed');
    assert.deepEqual(state.deletes, ['note-2']);
  });
}

test('a lease is released with its own owner token when deleteNote throws', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  adapter.deleteNote = async id => {
    state.deletes.push(id);
    throw new Error('delete exploded');
  };
  const cleanup = ready(win, adapter);
  await cleanup.checkNow();
  assert.deepEqual(state.leases, [['acquire', 'note-1'], ['release', 'note-1', 'lease-note-1']]);
});

function rejectSecondReadOf(state, adapter, noteId, failure) {
  const base = adapter.readNote;
  let calls = 0;
  adapter.readNote = async id => {
    if (id === noteId) {
      calls += 1;
      if (calls === 2) {
        state.reads.push(id);
        throw failure;
      }
    }
    return base(id);
  };
}

test('a 429 on the pre-delete re-read ends the pass rate-limited, deletes nothing and releases the lease', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
  rejectSecondReadOf(state, adapter, 'note-1', { status: 429, headers: { 'Retry-After': '60' } });
  const cleanup = ready(win, adapter);
  const result = await cleanup.checkNow();
  assert.deepEqual(Array.from(result.outcomes, value => value.kind), ['rate-limited']);
  assert.equal(cleanup.getState().cooldownUntil, Date.parse(SERVER_NOW) + 60000);
  assert.deepEqual(state.deletes, []);
  assert.deepEqual(state.leases, [['acquire', 'note-1'], ['release', 'note-1', 'lease-note-1']]);
});

test('a non-429 rejection on the pre-delete re-read skips only that note and releases its lease', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
  rejectSecondReadOf(state, adapter, 'note-1', new Error('network down'));
  const cleanup = ready(win, adapter);
  const result = await cleanup.checkNow();
  assert.equal(result.state, 'checked');
  assert.deepEqual(state.deletes, ['note-2']);
  assert.deepEqual(state.leases, [
    ['acquire', 'note-1'], ['release', 'note-1', 'lease-note-1'],
    ['acquire', 'note-2'], ['release', 'note-2', 'lease-note-2']
  ]);
});

test('a lease is released when the post-delete verification read rejects past deleteCandidate', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const base = adapter.readReferences;
  let calls = 0;
  adapter.readReferences = async () => {
    calls += 1;
    if (calls === 3) throw new Error('verification read exploded');
    return base();
  };
  const cleanup = ready(win, adapter);
  await cleanup.checkNow().catch(() => {});
  assert.deepEqual(state.deletes, ['note-1']);
  assert.deepEqual(state.leases, [['acquire', 'note-1'], ['release', 'note-1', 'lease-note-1']]);
});
