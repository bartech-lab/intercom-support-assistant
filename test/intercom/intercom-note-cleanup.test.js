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

test('cleanup is on with no gate to enable, and no build flag can switch it off', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const plain = win.ISA_NOTE_CLEANUP.createController({
    adapter,
    footer: win.ISA_TEMPORARY_NOTES,
    now: () => Date.parse(SERVER_NOW),
    timing: { minGapMs: 0, timeoutMs: 15000 },
    wait: async () => {}
  });
  plain.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const result = await plain.checkNow();
  assert.notEqual(result.state, 'production-disabled');
  assert.deepEqual(Array.from(result.outcomes, value => value.kind), ['deleted']);
  assert.deepEqual(state.deletes, ['note-1']);
  assert.equal('productionEnabled' in plain.getState(), false);
  assert.equal(win.ISA_TEMPORARY_NOTES.cleanupVerified, undefined);
});

test('an unknown internal option cannot disable cleanup', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const cleanup = controller(win, adapter, { internal: { enableProductionCleanup: false } });
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const result = await cleanup.checkNow();
  assert.deepEqual(Array.from(result.outcomes, value => value.kind), ['deleted']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('a paused controller deletes nothing until it is resumed', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const cleanup = controller(win, adapter);
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  cleanup.pause('setting');
  assert.equal((await cleanup.checkNow()).state, 'paused');
  assert.deepEqual(state.deletes, []);
  cleanup.resume();
  assert.deepEqual(Array.from((await cleanup.checkNow()).outcomes, value => value.kind), ['deleted']);
});

test('expired owned notes delete one at a time and report only after absence verification', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
  const confirmed = [];
  const cleanup = controller(win, adapter, { onConfirmedDeleted: value => confirmed.push(value.noteId) });
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const result = await cleanup.checkNow();
  assert.deepEqual(Array.from(result.outcomes, value => value.kind), ['deleted', 'deleted']);
  assert.deepEqual(state.deletes, ['note-1', 'note-2']);
  assert.deepEqual(confirmed, ['note-1', 'note-2']);
  assert.deepEqual(Array.from(state.leases, value => value[0]), ['acquire', 'release', 'acquire', 'release']);
});

for (const [label, change] of [
  ['body', original => ({ body: original.body.replace('temporary note', 'edited note') })],
  ['update timestamp', () => ({ updatedAt: EXPIRED })]
]) {
  test(`fresh refresh skips a note whose ${label} alone changed`, async () => {
    const win = load();
    const original = note(win);
    let readCount = 0;
    const changed = { ...original, ...change(original) };
    const { state, adapter } = adapterFor({ 'note-1': original }, {
      readNote: async () => {
        readCount += 1;
        return readCount === 1 ? original : changed;
      }
    });
    const cleanup = controller(win, adapter);
    cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
    const result = await cleanup.checkNow();
    assert.equal(result.outcomes[0].kind, 'stale-version');
    assert.deepEqual(state.deletes, []);
  });
}

test('a failed note read never reports a live note as already deleted', async () => {
  const win = load();
  const existing = note(win);
  let readCount = 0;
  const { state, adapter } = adapterFor({ 'note-1': existing }, {
    readNote: async () => {
      readCount += 1;
      return readCount === 1 ? existing : null;
    }
  });
  const already = [];
  const cleanup = controller(win, adapter, { onAlreadyDeleted: value => already.push(value.noteId) });
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const result = await cleanup.checkNow();
  assert.equal(result.outcomes[0].kind, 'note-unreadable');
  assert.deepEqual(already, [], 'an unreadable note is not a deleted note');
  assert.deepEqual(state.deletes, []);
});

test('ordinary and malformed notes remain untouched and invalid notes are reported', async () => {
  const win = load();
  const ordinary = { id: 'ordinary', body: 'ordinary', createdAt: CREATED, updatedAt: CREATED };
  const malformed = note(win, 'malformed', { body: 'temporary\n[ISA-AUTO-DELETE:v2;workspace=workspace-1;contact=contact-1;expires=2026-10-08T13:00:00.000Z;token=x]' });
  const { state, adapter } = adapterFor({ ordinary, malformed });
  const invalid = [];
  const cleanup = controller(win, adapter, { onInvalid: value => invalid.push(value) });
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const result = await cleanup.checkNow();
  assert.deepEqual(Array.from(result.outcomes), []);
  assert.deepEqual(state.deletes, []);
  assert.equal(invalid[0].reason, 'invalid-marker');
});

for (const [label, failure] of [
  ['server failure', async () => ({ status: 500 })],
  ['timeout', async () => { throw Object.assign(new Error('timed out'), { code: 'timeout' }); }]
]) {
  test(`a ${label} rereads before and after the retry wait, and defers a retry that would outlive the lease`, async () => {
    const win = load();
    const waits = [];
    let deleteCount = 0;
    const { state, adapter } = adapterFor({ 'note-1': note(win) }, {
      deleteNote: async () => {
        deleteCount += 1;
        return failure();
      }
    });
    const reads = [];
    const readNote = adapter.readNote;
    adapter.readNote = async id => {
      reads.push(deleteCount);
      return readNote(id);
    };
    const cleanup = controller(win, adapter, { wait: async ms => waits.push(ms) });
    cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
    const result = await cleanup.checkNow();
    assert.equal(result.outcomes[0].kind, 'retry-deferred');
    assert.equal(deleteCount, 2, 'the 120 s retry would outlive the 60 s lease, so it waits for the next pass');
    assert.deepEqual(waits, [30000]);
    assert.deepEqual(reads, [0, 0, 1, 1, 2], 'candidate read, pre-delete refresh, a reread before and after the wait, then one after the second failure');
    assert.deepEqual(state.deletes, []);
  });
}

test('auth errors stop the workspace session and rate limits set a cooldown', async () => {
  const win = load();
  let response = { status: 403 };
  const { adapter } = adapterFor({ 'note-1': note(win) }, { deleteNote: async () => response });
  const statuses = [];
  const cleanup = controller(win, adapter, { onStatus: value => statuses.push(value) });
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  let result = await cleanup.checkNow();
  assert.equal(result.outcomes[0].kind, 'auth-stopped');
  assert.equal(cleanup.getState().blockedWorkspaceIds[0], WORKSPACE);

  response = { status: 429, headers: { 'Retry-After': '60' } };
  const second = controller(win, adapter);
  second.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  result = await second.checkNow();
  assert.equal(result.outcomes[0].kind, 'rate-limited');
  assert.equal(second.getState().cooldownUntil, Date.parse(SERVER_NOW) + 60000);
  assert.equal(statuses[0].state, 'auth-stopped');
});

test('hidden navigation cancels unsent deletion work', async () => {
  const win = load();
  let releaseRead;
  const pending = new Promise(resolve => { releaseRead = resolve; });
  const { state, adapter } = adapterFor({ 'note-1': note(win) }, {
    readReferences: async () => pending
  });
  const cleanup = controller(win, adapter);
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const checking = cleanup.checkNow();
  cleanup.setVisible(false);
  releaseRead({ ids: ['note-1'], serverDate: SERVER_NOW });
  const result = await checking;
  assert.equal(result.state, 'context-changed');
  assert.deepEqual(state.deletes, []);
});

test('already deleted notes are distinct from deletion confirmed by this browser', async () => {
  const win = load();
  const existing = note(win);
  let first = true;
  const { state, adapter } = adapterFor({ 'note-1': existing }, {
    deleteNote: async id => {
      state.deletes.push(id);
      state.notes.delete('note-1');
      return { status: 404 };
    },
    readNote: async id => {
      if (first) {
        first = false;
        return existing;
      }
      return state.notes.get(id) || null;
    }
  });
  const already = [];
  const confirmed = [];
  const cleanup = controller(win, adapter, {
    onAlreadyDeleted: value => already.push(value.noteId),
    onConfirmedDeleted: value => confirmed.push(value.noteId)
  });
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: true });
  const result = await cleanup.checkNow();
  assert.equal(result.outcomes[0].kind, 'already-deleted');
  assert.deepEqual(state.deletes, ['note-1']);
  assert.deepEqual(already, ['note-1']);
  assert.deepEqual(confirmed, []);
});
