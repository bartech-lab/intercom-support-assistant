'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadExtension, loadIntercomPageHook, makeIntercomResponse, makeChromeStub } = require('../support/helpers');
const {
  settled,
  ORIGIN,
  WORKSPACE,
  CONTACT,
  CONVERSATION_URL,
  CREATE_URL,
  SAVED_NOTE_ID,
  savedNote,
  temporaryNoteCard,
  loadSidebar,
  controlsOf,
  enable,
} = require('../support/temporary-notes-harness');

function captureTempNotePosts(win) {
  const posted = [];
  const nativePostMessage = win.postMessage.bind(win);
  win.postMessage = (message, targetOrigin) => {
    posted.push(message);
    nativePostMessage(message, targetOrigin);
  };
  return posted;
}

function sendToHook(hook, data) {
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', { data, source: hook.window, origin: ORIGIN }));
}

test('the contact payload is read the way Intercom nests it, with a sidebar fallback', async () => {
  const win = loadSidebar({ notes: temporaryNoteCard() });
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  const respond = payload => () => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: name => (name === 'date' ? 'Tue, 08 Sep 2026 13:00:00 GMT' : null) },
    text: async () => JSON.stringify(payload)
  });

  win.fetch = respond({ users: [{ note_ids: [900661996, 'bad', 900661996] }] });
  const nested = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(nested.ids), ['900661996'], 'note_ids under users[0] are found');
  assert.equal(nested.serverDate, 'Tue, 08 Sep 2026 13:00:00 GMT');

  win.fetch = respond({ users: [{ notes: [{ id: 900661997 }] }] });
  const objects = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(objects.ids), ['900661997'], 'note objects are accepted');

  win.fetch = respond({ users: [{}] });
  const fallback = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(fallback.ids), ['900661995'],
    'a payload with no references falls back to the rendered note ids');
  assert.equal(fallback.serverDate, 'Tue, 08 Sep 2026 13:00:00 GMT');
});

test('the note read accepts both the bare array and a notes envelope', async () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  const note = { id: 900661995, body: 'note', created_at: '2026-09-08T13:00:00.000Z', updated_at: '2026-09-08T13:00:00.000Z' };
  const respond = payload => () => Promise.resolve({
    ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload)
  });

  win.fetch = respond([note]);
  assert.equal((await win.ISA_NOTE_RUNTIME.adapter.readNote('900661995', context)).body, 'note');
  win.fetch = respond({ notes: [note] });
  assert.equal((await win.ISA_NOTE_RUNTIME.adapter.readNote('900661995', context)).body, 'note');
});

test('a note that is already gone from the server stops being rendered', async () => {
  const win = loadSidebar({ notes: temporaryNoteCard() + savedNote('9', '<p>plain note</p>') });
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  win.fetch = () => Promise.resolve({
    ok: false,
    status: 404,
    headers: { get: () => null },
    text: async () => JSON.stringify({ errors: [{ message: 'Couldn\'t find Note', status: 'not_found' }] })
  });

  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote(SAVED_NOTE_ID, context), null);
  const card = win.document.querySelector(`[data-testid="note-${SAVED_NOTE_ID}"]`);
  assert.equal(win.getComputedStyle(card).display, 'none', 'the stale card is hidden once the note 404s');
  assert.equal(card.getAttribute('data-isa-note-footer-owner'), win.chrome.runtime.id);

  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote('9', context), null);
  const ordinary = win.document.querySelector('[data-testid="note-9"]');
  assert.equal(ordinary.hidden, false, 'an ordinary note is never hidden by a 404');
});

test('a confirmed deletion hides the card it deleted', () => {
  const win = loadSidebar({ notes: temporaryNoteCard() });
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.hideDeletedCard(SAVED_NOTE_ID), true);
  assert.equal(win.document.querySelector(`[data-testid="note-${SAVED_NOTE_ID}"]`).hidden, true);
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.hideDeletedCard('not-an-id'), false);
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.hideDeletedCard('4242'), false, 'an absent card is a no-op');
});

test('switching auto-delete off disarms the page hook, so the next note carries no footer', async () => {
  const win = loadSidebar();
  const posted = captureTempNotePosts(win);
  const panel = controlsOf(win);
  panel.toggle.checked = true;
  panel.toggle.dispatchEvent(new win.Event('change'));
  panel.toggle.checked = false;
  panel.toggle.dispatchEvent(new win.Event('change'));
  const arm = posted.find(message => message && message.__isaTempNote === true && message.kind === 'arm');
  const disarm = posted.find(message => message && message.__isaTempNote === true && message.kind === 'disarm');
  assert.ok(arm && disarm, 'the UI arms and then disarms');
  assert.equal(disarm.workspace, WORKSPACE);
  assert.equal(disarm.contact, CONTACT);

  const requests = [];
  const hookPosted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push(JSON.parse(init.body));
      return Promise.resolve(makeIntercomResponse('{}', { url: CREATE_URL }));
    }
  });
  hook.window.addEventListener('message', event => hookPosted.push(event.data));
  hook.sendReady();
  sendToHook(hook, { ...arm, draft: 'keep this note' });
  sendToHook(hook, disarm);
  await delay(0);
  assert.ok(hookPosted.some(message => message && message.kind === 'temporary-note-armed' && message.status === 'disarmed'),
    'the hook accepts the disarm');

  await hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'keep this note' })
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body, 'keep this note', 'a disarmed save goes out unchanged, with no auto-delete footer');
});

test('a rejected save stops its timeout, so a later arm is not refused as uncertain', async () => {
  const timers = new Map();
  let nextTimer = 1;
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{"errors":[]}', { url: CREATE_URL, status: 422 })),
    beforeScripts: (win) => {
      win.setTimeout = (callback) => { const id = nextTimer++; timers.set(id, callback); return id; };
      win.clearTimeout = (id) => { timers.delete(id); };
    }
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  const arm = { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note',
    lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-7', revision: 1 };
  sendToHook(hook, arm);
  await hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' })
  });
  await delay(0);
  assert.ok(posted.some(message => message && message.kind === 'temporary-note-save' && message.status === 'failed'));
  [...timers.values()].forEach(callback => callback());
  await delay(0);
  assert.equal(posted.some(message => message && message.status === 'uncertain'), false,
    'a known 4xx failure never turns into an uncertain save');

  sendToHook(hook, { ...arm, revision: 2 });
  await delay(0);
  const rearmed = posted.filter(message => message && message.kind === 'temporary-note-armed').pop();
  assert.equal(rearmed.status, 'armed', 'the draft can be armed again at once');
});

test('a failed save re-arms the composer, so the next Enter is not blocked', () => {
  const win = loadSidebar();
  const posted = captureTempNotePosts(win);
  const panel = controlsOf(win);
  enable(win, panel);
  const state = win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`);
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-armed', token: state.token, revision: state.revision, status: 'armed' }
  });
  const armsBefore = posted.filter(message => message && message.kind === 'arm').length;

  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-save', token: state.token, revision: state.revision, status: 'failed', reason: 'http-422' }
  });
  const arms = posted.filter(message => message && message.kind === 'arm');
  assert.equal(arms.length, armsBefore + 1, 'the failure posts a fresh arm');
  assert.equal(arms[arms.length - 1].revision, state.revision);
  assert.match(state.error, /not saved/, 'the failure notice survives the re-arm');
});

test('an armed note creation still saves when fetch is called with an object carrying the body, not a separate init', async () => {
  const requests = [];
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push({ input, init });
      const bodyText = (init && init.body) || input.body;
      return Promise.resolve(makeIntercomResponse(JSON.stringify({ id: 1, body: JSON.parse(bodyText).body }), { url: CREATE_URL }));
    }
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  sendToHook(hook, {
    __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note',
    lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-obj', revision: 1
  });

  await hook.window.fetch({
    url: CREATE_URL,
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' })
  });
  await delay(0);

  const save = posted.filter(message => message && message.kind === 'temporary-note-save').pop();
  assert.equal(save && save.status, 'success', 'the object-shaped fetch call still saves and reports success');
  assert.match(requests[0].init.body, /ISA-AUTO-DELETE/, 'the outgoing body carries the footer');
});

test('a note-read GET response relays only requested notes with valid timestamps', async () => {
  const requestUrl = `${ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}&ids%5B%5D=100&ids%5B%5D=200`;
  const payload = JSON.stringify([
    { id: 100, body: 'kept', created_at: '2026-09-08T13:00:00.000Z', updated_at: '2026-09-08T13:00:00.000Z' },
    { id: 999, body: 'not requested', created_at: '2026-09-08T13:00:00.000Z', updated_at: '2026-09-08T13:00:00.000Z' },
    { id: 200, body: 'bad timestamp', created_at: 'not-a-date', updated_at: '2026-09-08T13:00:00.000Z' }
  ]);
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse(payload, { url: requestUrl }))
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  await hook.window.fetch(requestUrl);
  await delay(0);
  await delay(0);

  const notesMessage = posted.find(message => message && message.kind === 'temporary-note-notes');
  assert.ok(notesMessage, 'the note-read relay fires');
  assert.deepEqual(Array.from(notesMessage.notes, note => note.id), ['100'],
    'only the requested note with valid timestamps is relayed');
});

test('a contact payload relays note references whether entries are bare ids or note objects', async () => {
  const userId = '900fcbb36062854afdf312d1';
  const userUrl = `${ORIGIN}/ember/users/${userId}?app_id=${WORKSPACE}`;
  const payload = JSON.stringify({ users: [{ notes: [{ id: 555 }] }] });
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse(payload, { url: userUrl }))
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  await hook.window.fetch(userUrl);
  await delay(0);
  await delay(0);

  const contactMessage = posted.find(message => message && message.kind === 'temporary-note-contact');
  assert.ok(contactMessage, 'the contact note-reference relay fires');
  assert.deepEqual(Array.from(contactMessage.noteIds), ['555'], 'an object-shaped note entry still yields its id');
});

test('an arm message without the temp-note marker is never treated as a real arm request', async () => {
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}'))
  });
  const posted = [];
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: {
      kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'sneaky note',
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-unmarked', revision: 1
    },
    source: hook.window,
    origin: ORIGIN
  }));
  await delay(0);
  assert.equal(posted.some(message => message && message.kind === 'temporary-note-armed'), false,
    'a message without __isaTempNote is never treated as an arm request');
});

test('a disarm is blocked while a save is pending, so it cannot silently clear the current arm', async () => {
  let resolveFetch;
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; })
  });
  const posted = [];
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  const arm = {
    __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note',
    lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-pending', revision: 1
  };
  sendToHook(hook, arm);
  await delay(0);

  hook.window.fetch(CREATE_URL, {
    method: 'POST',
    body: JSON.stringify({ model_id: CONTACT, is_company: false, body: 'temporary note' })
  });
  await delay(0);

  sendToHook(hook, { __isaTempNote: true, kind: 'disarm', workspace: WORKSPACE, contact: CONTACT, token: arm.token, revision: arm.revision });
  await delay(0);
  const blocked = posted.filter(message => message && message.kind === 'temporary-note-save').pop();
  assert.equal(blocked && blocked.status, 'blocked');
  assert.equal(blocked && blocked.reason, 'save-pending', 'a disarm mid-save is refused, not silently accepted');

  resolveFetch(makeIntercomResponse(JSON.stringify({ id: 1, body: 'temporary note' }), { url: CREATE_URL }));
  await delay(0);
});

test('the cleanup context tracks page visibility the right way round', () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(win.ISA_NOTE_RUNTIME.getController().getState().visible, true,
    'an ordinary visible tab is visible context');

  Object.defineProperty(win.document, 'visibilityState', { configurable: true, value: 'hidden' });
  win.ISA_NOTE_RUNTIME.refreshContext();
  assert.equal(win.ISA_NOTE_RUNTIME.getController().getState().visible, false,
    'a hidden tab must not be reported as a visible cleanup context');
});

test('a lease request settles even when the extension context is gone', async () => {
  const win = loadSidebar();
  win.chrome.runtime.id = null;

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('never settled')), 200));
  const result = await Promise.race([
    win.ISA_NOTE_RUNTIME.adapter.acquireLease({ workspaceId: WORKSPACE, contactId: CONTACT, noteId: '1' }),
    timeout
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-unavailable');
});

test('a lease request settles even when the background sends back no response', async () => {
  const win = loadSidebar();
  win.chrome.runtime.sendMessage = (message, callback) => callback(undefined);

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('never settled')), 200));
  const result = await Promise.race([
    win.ISA_NOTE_RUNTIME.adapter.acquireLease({ workspaceId: WORKSPACE, contactId: CONTACT, noteId: '1' }),
    timeout
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-unavailable');
});

test('a rapid sidebar swap still refreshes the note-cleanup context from the trailing pass', async () => {
  const win = loadSidebar();
  assert.equal(win.ISA_NOTE_RUNTIME.getController().getState().contactId, CONTACT);

  const base = win.Date.now();
  win.Date.now = () => base;
  win.document.body.appendChild(win.document.createElement('div'));
  await settled();

  const CONTACT2 = '900d7891985ad69715f6958c';
  win.document.querySelector('a[data-test-user-profile-link="true"]').outerHTML =
    `<a data-test-user-profile-link="true" href="/a/apps/${WORKSPACE}/users/${CONTACT2}">Customer</a>`;

  await delay(200);

  assert.equal(win.ISA_NOTE_RUNTIME.getController().getState().contactId, CONTACT2,
    'a swap landing inside the throttle window must still reach the cleanup context on the trailing pass');
});

test('the nested users[0] container is read even with no sidebar note to fall back on', async () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  win.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ users: [{ note_ids: [900999] }] })
  });

  const references = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(references.ids), ['900999'],
    'note_ids nested under users[0] must be read directly, not only through the sidebar fallback');
});

test('a single-digit note id in the sidebar is still found by the fallback', async () => {
  const win = loadSidebar({ notes: savedNote('5', '<p>x</p>') });
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  win.fetch = () => Promise.resolve({
    ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ users: [{}] })
  });

  const references = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(references.ids), ['5'],
    'a one-digit note id rendered in the sidebar must still be picked up by the fallback');
});

test('a malformed note entry is rejected, and a null sibling entry never crashes the read', async () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  const respond = payload => () => Promise.resolve({
    ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload)
  });

  win.fetch = respond([null, { id: '900661995', body: 'note',
    created_at: '2026-09-08T13:00:00.000Z', updated_at: '2026-09-08T13:00:00.000Z' }]);
  const found = await win.ISA_NOTE_RUNTIME.adapter.readNote('900661995', context);
  assert.equal(found.body, 'note', 'a null entry ahead of the real one must not stop the search or throw');

  win.fetch = respond([{ id: '900661995', created_at: '2026-09-08T13:00:00.000Z', updated_at: '2026-09-08T13:00:00.000Z' }]);
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote('900661995', context), null,
    'a matching id with no string body is not a usable note');

  win.fetch = respond([{ id: '900661995', body: 'note', updated_at: '2026-09-08T13:00:00.000Z' }]);
  assert.equal(await win.ISA_NOTE_RUNTIME.adapter.readNote('900661995', context), null,
    'a missing created_at is not a usable note, even with a valid updated_at');
});

test('a contact payload without any note reference keys reports the status, not an empty id list', async () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  const respond = payload => () => Promise.resolve({
    ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload)
  });

  win.fetch = respond({ users: [{}] });
  const unknown = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.equal('ids' in unknown, false, 'a payload with no note reference array means references are unknown');
  assert.equal(unknown.status, 200);

  win.fetch = respond({ users: [{ note_ids: [] }] });
  const empty = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(empty.ids), [], 'an explicit empty note_ids array means the contact has no notes');
  assert.equal('status' in empty, false);
});

test('an explicit empty note_ids array wins over the rendered note cards', async () => {
  const win = loadSidebar({ notes: temporaryNoteCard() });
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  win.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ users: [{ note_ids: [] }] })
  });

  const empty = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(empty.ids), [], 'the server says the contact has no notes, so the sidebar card ids are not used');
});

test('an oversized contact payload is ignored as if unreadable', async () => {
  const win = loadSidebar();
  win.ISA_NOTE_RUNTIME.getController().pause('test');
  await settled();
  const context = { workspaceId: WORKSPACE, contactId: CONTACT };
  const respondText = text => () => Promise.resolve({
    ok: true, status: 200, headers: { get: () => null }, text: async () => text
  });

  win.fetch = respondText(JSON.stringify({ users: [{ note_ids: [900661995] }], pad: 'x'.repeat(900001) }));
  const oversized = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.equal('ids' in oversized, false, 'a body over the size cap must not be parsed');
  assert.equal(oversized.status, 200);

  win.fetch = respondText(JSON.stringify({ users: [{ note_ids: [900661995] }], pad: 'x'.repeat(1000) }));
  const small = await win.ISA_NOTE_RUNTIME.adapter.readReferences(context);
  assert.deepEqual(Array.from(small.ids), ['900661995'], 'the same payload under the cap is read');
});
