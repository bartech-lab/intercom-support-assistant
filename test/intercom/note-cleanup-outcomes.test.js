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
const OTHER_CONTACT = 'contact-2';

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

const plain = value => JSON.parse(JSON.stringify(value));
const kinds = result => Array.from(result.outcomes, value => value.kind);

function timeoutError() {
  return Object.assign(new Error('timed out'), { code: 'timeout' });
}

function failOnCall(adapter, name, call, failure) {
  const base = adapter[name];
  let calls = 0;
  adapter[name] = async (...args) => {
    calls += 1;
    if (calls === call) throw failure;
    return base(...args);
  };
}

function twoNotes() {
  const win = load();
  return { win, ...adapterFor({ 'note-1': note(win), 'note-2': note(win, 'note-2') }) };
}

test('a timeout on the pre-delete references refresh ends that note as timeout and deletes nothing for it', async () => {
  const { win, state, adapter } = twoNotes();
  failOnCall(adapter, 'readReferences', 2, timeoutError());
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(plain(result.outcomes[0]), { noteId: 'note-1', kind: 'timeout' });
  assert.deepEqual(state.deletes, ['note-2']);
});

test('any other error on the pre-delete references refresh ends that note as read-failed', async () => {
  const { win, state, adapter } = twoNotes();
  failOnCall(adapter, 'readReferences', 2, new Error('network down'));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(plain(result.outcomes[0]), { noteId: 'note-1', kind: 'read-failed' });
  assert.deepEqual(state.deletes, ['note-2']);
});

test('a note missing from the refreshed references is already-deleted and no DELETE is sent for it', async () => {
  const { win, state, adapter } = twoNotes();
  const base = adapter.readReferences;
  let calls = 0;
  adapter.readReferences = async () => {
    calls += 1;
    return calls === 2 ? { ids: ['note-2'], serverDate: SERVER_NOW } : base();
  };
  const already = [];
  const result = await ready(win, adapter, { onAlreadyDeleted: value => already.push(value.noteId) }).checkNow();
  assert.deepEqual(plain(result.outcomes[0]), { noteId: 'note-1', kind: 'already-deleted' });
  assert.deepEqual(state.deletes, ['note-2']);
  assert.deepEqual(already, ['note-1']);
});

for (const [label, next] of [
  ['another contact', { workspaceId: WORKSPACE, contactId: OTHER_CONTACT, visible: true }],
  ['the same contact set again as a new generation', { workspaceId: WORKSPACE, contactId: CONTACT, visible: true }]
]) {
  test(`a context change to ${label} during the pre-delete refresh is context-changed and ends the pass`, async () => {
    const { win, state, adapter } = twoNotes();
    const cleanup = ready(win, adapter);
    const base = adapter.readReferences;
    let calls = 0;
    adapter.readReferences = async () => {
      calls += 1;
      if (calls === 2) cleanup.setContext(next);
      return base();
    };
    const result = await cleanup.checkNow();
    assert.deepEqual(plain(Array.from(result.outcomes)), [{ noteId: 'note-1', kind: 'context-changed' }]);
    assert.deepEqual(state.deletes, []);
    assert.deepEqual(state.leases.filter(entry => entry[1] === 'note-2'), []);
  });
}

test('a context change while the lease is requested is context-changed, deletes nothing and releases the lease', async () => {
  const { win, state, adapter } = twoNotes();
  const cleanup = ready(win, adapter);
  const base = adapter.acquireLease;
  adapter.acquireLease = async request => {
    cleanup.setContext({ workspaceId: WORKSPACE, contactId: OTHER_CONTACT, visible: true });
    return base(request);
  };
  const result = await cleanup.checkNow();
  assert.deepEqual(plain(Array.from(result.outcomes)), [{ noteId: 'note-1', kind: 'context-changed' }]);
  assert.deepEqual(state.deletes, []);
  assert.deepEqual(state.leases, [['acquire', 'note-1'], ['release', 'note-1', 'lease-note-1']]);
});

test('the one second gap wait before the second deletion that sees a context change is context-changed and sends no DELETE', async () => {
  const { win, state, adapter } = twoNotes();
  const waits = [];
  const cleanup = ready(win, adapter, {
    timing: { minGapMs: 1000, timeoutMs: 15000 },
    wait: async ms => {
      waits.push(ms);
      cleanup.setContext({ workspaceId: WORKSPACE, contactId: OTHER_CONTACT, visible: true });
    }
  });
  const result = await cleanup.checkNow();
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(kinds(result), ['deleted', 'context-changed']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('a failed note read in the pre-delete refresh ends as read-failed and sends no DELETE for it', async () => {
  const { win, state, adapter } = twoNotes();
  failOnCall(adapter, 'readNote', 3, new Error('network down'));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(plain(result.outcomes[0]), { noteId: 'note-1', kind: 'read-failed' });
  assert.deepEqual(state.deletes, ['note-2']);
});

test('a second checkNow during a running pass returns the same result and reads references only for that one pass', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const base = adapter.readReferences;
  let open;
  const hold = new Promise(resolve => { open = resolve; });
  let first = true;
  adapter.readReferences = async () => {
    if (first) {
      first = false;
      state.refs += 1;
      await hold;
      return { ids: ['note-1'], serverDate: SERVER_NOW };
    }
    return base();
  };
  const cleanup = ready(win, adapter);
  const one = cleanup.checkNow();
  const two = cleanup.checkNow();
  open();
  const [a, b] = await Promise.all([one, two]);
  assert.deepEqual(kinds(a), ['deleted']);
  assert.deepEqual(plain(b), plain(a));
  assert.deepEqual(state.deletes, ['note-1']);
  assert.equal(state.refs, 3);
});

test('no context is inactive, a hidden context is inactive and a paused controller is paused, each reading nothing', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const cleanup = controller(win, adapter);
  assert.equal((await cleanup.checkNow()).state, 'inactive');
  cleanup.setContext({ workspaceId: WORKSPACE, contactId: CONTACT, visible: false });
  assert.equal((await cleanup.checkNow()).state, 'inactive');
  cleanup.setVisible(true);
  cleanup.pause('setting');
  assert.equal((await cleanup.checkNow()).state, 'paused');
  assert.equal(state.refs, 0);
  assert.deepEqual(state.deletes, []);
});

for (const missing of ['readReferences', 'readNote', 'deleteNote']) {
  test(`an adapter without ${missing} is adapter-incomplete and deletes nothing`, async () => {
    const win = load();
    const { state, adapter } = adapterFor({ 'note-1': note(win) });
    delete adapter[missing];
    const result = await ready(win, adapter).checkNow();
    assert.equal(result.state, 'adapter-incomplete');
    assert.deepEqual(state.deletes, []);
  });
}

test('a references read that throws a timeout error ends the pass as timeout', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  failOnCall(adapter, 'readReferences', 1, timeoutError());
  const result = await ready(win, adapter).checkNow();
  assert.equal(result.state, 'timeout');
  assert.deepEqual(state.deletes, []);
});

test('a references read that throws any other error ends the pass as read-failed', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  failOnCall(adapter, 'readReferences', 1, new Error('network down'));
  const result = await ready(win, adapter).checkNow();
  assert.equal(result.state, 'read-failed');
  assert.deepEqual(state.deletes, []);
});

test('an invalid footer is reported with its id and reason, an ordinary note and a valid note are not', async () => {
  const win = load();
  const ordinary = { id: 'ordinary', body: 'plain note', createdAt: CREATED, updatedAt: CREATED };
  const broken = note(win, 'broken', { body: 'x\n[ISA-AUTO-DELETE:v2;workspace=workspace-1]' });
  const { adapter } = adapterFor({ ordinary, broken, 'note-1': note(win) });
  const invalid = [];
  await ready(win, adapter, { onInvalid: value => invalid.push(value) }).checkNow();
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].noteId, 'broken');
  assert.equal(typeof invalid[0].reason, 'string');
  assert.ok(invalid[0].reason.length > 0);
});

test('a missing server time defers the pass without reporting a valid note as invalid', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  adapter.readReferences = async () => ({ ids: ['note-1'] });
  const invalid = [];
  const result = await ready(win, adapter, { onInvalid: value => invalid.push(value) }).checkNow();
  assert.deepEqual({ state: result.state, reason: result.reason }, { state: 'deferred', reason: 'missing-server-time' });
  assert.deepEqual(invalid, []);
  assert.deepEqual(state.deletes, []);
});

test('a context change during the first note leaves the second candidate unprocessed', async () => {
  const { win, state, adapter } = twoNotes();
  const cleanup = ready(win, adapter);
  const base = adapter.deleteNote;
  adapter.deleteNote = async id => {
    const response = await base(id);
    cleanup.setContext({ workspaceId: WORKSPACE, contactId: OTHER_CONTACT, visible: true });
    return response;
  };
  const result = await cleanup.checkNow();
  assert.deepEqual(state.deletes, ['note-1']);
  assert.equal(Array.from(result.outcomes).some(value => value.noteId === 'note-2' && value.kind === 'deleted'), false);
  assert.deepEqual(state.leases.filter(entry => entry[1] === 'note-2'), []);
});

test('a references read that throws during the absence check after a 2xx DELETE ends as verification-pending, not success', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  failOnCall(adapter, 'readReferences', 3, new Error('verify refs down'));
  const confirmed = [];
  const result = await ready(win, adapter, { onConfirmedDeleted: value => confirmed.push(value.noteId) }).checkNow();
  assert.deepEqual(kinds(result), ['verification-pending']);
  assert.deepEqual(state.deletes, ['note-1']);
  assert.deepEqual(confirmed, []);
});

test('a 429 thrown by the absence check after a 2xx DELETE ends as rate-limited and starts the cooldown', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  failOnCall(adapter, 'readReferences', 3, { status: 429, headers: { 'Retry-After': '60' } });
  let refCalls = 0;
  const counted = adapter.readReferences;
  adapter.readReferences = async (...args) => {
    refCalls += 1;
    return counted(...args);
  };
  const confirmed = [];
  const cleanup = ready(win, adapter, { onConfirmedDeleted: value => confirmed.push(value.noteId) });
  const result = await cleanup.checkNow();
  assert.deepEqual(kinds(result), ['rate-limited']);
  assert.deepEqual(state.deletes, ['note-1']);
  assert.deepEqual(confirmed, []);
  const before = refCalls;
  await cleanup.checkNow();
  assert.equal(refCalls, before);
});

test('a references read that throws during the absence check after a 404 DELETE ends as verification-pending and the pass resolves', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  adapter.deleteNote = async id => {
    state.deletes.push(id);
    return { status: 404 };
  };
  failOnCall(adapter, 'readReferences', 3, new Error('verify refs down'));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['verification-pending']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('a references read that throws during the absence check after a 503 DELETE ends as verification-pending and the pass resolves', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  adapter.deleteNote = async id => {
    state.deletes.push(id);
    return { status: 503 };
  };
  failOnCall(adapter, 'readReferences', 3, new Error('verify refs down'));
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['verification-pending']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('a 429 thrown by the absence check after a 503 DELETE ends as rate-limited with no retry DELETE', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  adapter.deleteNote = async id => {
    state.deletes.push(id);
    return { status: 503 };
  };
  failOnCall(adapter, 'readReferences', 3, { status: 429, headers: { 'Retry-After': '60' } });
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['rate-limited']);
  assert.deepEqual(state.deletes, ['note-1']);
});

test('a note read that throws during the absence check after a 2xx DELETE ends as verification-pending, not success', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const baseRefs = adapter.readReferences;
  let refCalls = 0;
  adapter.readReferences = async () => {
    refCalls += 1;
    return refCalls === 3 ? { ids: ['note-1'], serverDate: SERVER_NOW } : baseRefs();
  };
  failOnCall(adapter, 'readNote', 3, new Error('verify read down'));
  const confirmed = [];
  const result = await ready(win, adapter, { onConfirmedDeleted: value => confirmed.push(value.noteId) }).checkNow();
  assert.deepEqual(kinds(result), ['verification-pending']);
  assert.deepEqual(state.deletes, ['note-1']);
  assert.deepEqual(confirmed, []);
});

test('null and undefined references are skipped without a note read and the valid note is still deleted', async () => {
  const win = load();
  const { state, adapter } = adapterFor({ 'note-1': note(win) });
  const base = adapter.readReferences;
  adapter.readReferences = async () => {
    const refs = await base();
    return { ...refs, ids: [null, undefined, ...refs.ids] };
  };
  const result = await ready(win, adapter).checkNow();
  assert.deepEqual(kinds(result), ['deleted']);
  assert.deepEqual(state.deletes, ['note-1']);
  assert.deepEqual(Array.from(new Set(state.reads)), ['note-1']);
});
