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
const OTHER_CONTACT = 'contact-2';
const CREATED = '2026-09-08T13:00:00.000Z';
const EXPIRED = '2026-10-08T13:00:00.000Z';
const SERVER_NOW = '2026-10-08T13:00:00.000Z';
const EARLIER = '2026-10-08T12:59:00.000Z';
const OTHER_CONTEXT = { workspaceId: WORKSPACE, contactId: OTHER_CONTACT, visible: true };

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

const kinds = result => Array.from(result.outcomes, value => value.kind);

function onCall(adapter, name, call, replace) {
  const base = adapter[name];
  let calls = 0;
  adapter[name] = async (...args) => {
    calls += 1;
    if (calls === call) return replace(base, ...args);
    return base(...args);
  };
}

function failingDelete(state, adapter, status) {
  adapter.deleteNote = async id => {
    state.deletes.push(id);
    return { status };
  };
}

function single() {
  const win = load();
  return { win, ...adapterFor({ 'note-1': note(win) }) };
}

test('K1 a pre-delete re-read with a server time before expiry sends no DELETE and ends not-expired', async () => {
  const { win, state, adapter } = single();
  onCall(adapter, 'readReferences', 2, async base => ({ ...(await base()), serverDate: EARLIER }));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['not-expired']);
  assert.deepEqual(state.deletes, []);
});

test('K2 a context change during the pre-delete re-read sends no DELETE and ends context-changed', async () => {
  const { win, state, adapter } = single();
  const cleanup = ready(win, adapter);
  onCall(adapter, 'readNote', 2, async (base, id) => {
    cleanup.setContext(OTHER_CONTEXT);
    return base(id);
  });
  const result = await cleanup.checkNow();
  assert.deepEqual(kinds(result), ['context-changed']);
  assert.deepEqual(state.deletes, []);
});

test('K3 a 429 on the verification read after a 404 DELETE ends rate-limited and the next check in the same instant reads nothing', async () => {
  const { win, state, adapter } = single();
  failingDelete(state, adapter, 404);
  onCall(adapter, 'readReferences', 3, async () => {
    throw { status: 429, headers: { 'Retry-After': '60' } };
  });
  const cleanup = ready(win, adapter);
  const result = await cleanup.checkNow();
  assert.deepEqual(kinds(result), ['rate-limited']);
  assert.deepEqual(state.deletes, ['note-1']);
  const refs = state.refs;
  const reads = state.reads.length;
  await cleanup.checkNow();
  assert.equal(state.refs, refs);
  assert.equal(state.reads.length, reads);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('K4 after a 503 DELETE an immediate re-read without the note sends no second DELETE and ends already-deleted', async () => {
  const { win, state, adapter } = single();
  failingDelete(state, adapter, 503);
  onCall(adapter, 'readReferences', 3, async () => ({ ids: [], serverDate: SERVER_NOW }));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['already-deleted']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('K5 after a 503 DELETE an immediate re-read with a different updatedAt sends no second DELETE and ends stale-version', async () => {
  const { win, state, adapter } = single();
  failingDelete(state, adapter, 503);
  onCall(adapter, 'readNote', 3, async () => note(win, 'note-1', { updatedAt: EXPIRED }));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['stale-version']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('K6 a context change during the retry delay sends no second DELETE and ends context-changed', async () => {
  const { win, state, adapter } = single();
  failingDelete(state, adapter, 503);
  const waits = [];
  const cleanup = ready(win, adapter, {
    wait: async ms => {
      waits.push(ms);
      cleanup.setContext(OTHER_CONTEXT);
    }
  });
  const result = await cleanup.checkNow();
  assert.deepEqual(waits, [30000]);
  assert.deepEqual(kinds(result), ['context-changed']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('K7 after a 503 DELETE and the retry delay a re-read without the note sends no second DELETE and ends already-deleted', async () => {
  const { win, state, adapter } = single();
  failingDelete(state, adapter, 503);
  onCall(adapter, 'readReferences', 4, async () => ({ ids: [], serverDate: SERVER_NOW }));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['already-deleted']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('K8 after a 503 DELETE and the retry delay a re-read with a different updatedAt sends no second DELETE and ends stale-version', async () => {
  const { win, state, adapter } = single();
  failingDelete(state, adapter, 503);
  onCall(adapter, 'readNote', 4, async () => note(win, 'note-1', { updatedAt: EXPIRED }));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['stale-version']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('K9 after a 503 DELETE and the retry delay references without a server date send no second DELETE and end missing-server-time', async () => {
  const { win, state, adapter } = single();
  failingDelete(state, adapter, 503);
  onCall(adapter, 'readReferences', 4, async () => ({ ids: ['note-1'] }));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['missing-server-time']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('K10 an unusable note object during listing is skipped and the next valid expired note is still deleted', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') });
  const base = adapter.readNote;
  adapter.readNote = async id => {
    if (id === 'note-1') {
      state.reads.push(id);
      return {};
    }
    return base(id);
  };
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(state.deletes, ['note-2']);
  assert.equal(kinds(result).includes('deleted'), true);
  assert.equal(result.outcomes.some(value => value.noteId === 'note-1' && value.kind === 'deleted'), false);
});
