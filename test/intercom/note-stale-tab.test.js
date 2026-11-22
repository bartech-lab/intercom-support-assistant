'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ORIGIN, WORKSPACE, CONTACT, SAVED_NOTE_ID, loadSidebar, temporaryNoteCard, savedNote } = require('../support/temporary-notes-harness');

const NOTE_UUID = 'aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa';
const OLD = '2026-09-09T07:55:12.120Z';
const NEWER = '2026-12-01T10:00:00.000Z';
const footer = (expires, token = NOTE_UUID) => `\n\nAuto-delete after: ${expires.slice(0, 16).replace('T', ' ')} UTC\n`
  + `[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT};expires=${expires};token=${token}]`;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function page(serverBody, notes = temporaryNoteCard()) {
  const win = loadSidebar({ notes });
  win.fetch = async (url) => {
    if (!String(url).includes('/ember/inbox/notes')) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
    if (serverBody === 'reject') throw new Error('offline');
    const note = { id: Number(SAVED_NOTE_ID), body: serverBody, created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-02T10:00:00.000Z' };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify([note]) };
  };
  win.refreshTemporaryNoteFooters();
  const posted = [];
  const post = win.postMessage.bind(win);
  win.postMessage = (message, origin) => { if (message && message.__isaTempNote) posted.push(message); return post(message, origin); };
  const body = () => win.document.querySelector(`[data-testid="note-${SAVED_NOTE_ID}"] [data-testid="note-body"]`);
  const line = () => body().querySelector('.isa-temporary-note-chip')?.textContent || null;
  const openEditor = () => {
    const textarea = win.document.createElement('textarea');
    textarea.setAttribute('aria-label', 'Edit note');
    win.document.querySelector(`[data-testid="note-${SAVED_NOTE_ID}"]`).append(textarea);
    textarea.value = `próba${footer(OLD)}`;
    win.refreshTemporaryNoteFooters();
    return textarea;
  };
  const kept = () => win.handleIntercomBridgeMessage({
    source: win, origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-edit', noteId: SAVED_NOTE_ID, status: 'kept', token: null, revision: null }
  });
  return { win, posted, line, openEditor, kept, observe: text => win.ISA_TEMPORARY_NOTES_UI.observeServerBody(SAVED_NOTE_ID, text) };
}

test('a date changed in another tab shows here as soon as the server copy is read', () => {
  const t = page('');
  assert.equal(t.line(), 'Expires 2026-09-09 07:55 UTC');
  t.observe(`próba${footer(NEWER)}`);
  assert.equal(t.line(), 'Expires 2026-12-01 10:00 UTC');
  t.observe(`próba${footer(OLD)}`);
  assert.equal(t.line(), 'Expires 2026-09-09 07:55 UTC', 'and back when the server says so');
});

test('auto-delete removed in another tab takes the expiry line away here; a broken server footer changes nothing', () => {
  const t = page('');
  t.observe('próba [ISA-AUTO-DELETE:v1;broken]');
  assert.equal(t.line(), 'Expires 2026-09-09 07:55 UTC');
  t.observe('próba');
  assert.equal(t.line(), null);
});

test('auto-delete added in another tab shows an expiry line on a note this tab still holds as plain', () => {
  const t = page('', savedNote(SAVED_NOTE_ID, '<p>plain</p>'));
  assert.equal(t.line(), null);
  t.observe(`plain${footer(NEWER)}`);
  assert.equal(t.line(), 'Expires 2026-12-01 10:00 UTC');
});

test('an edit box opened in a stale tab keeps the server date, not the old one in its text', async () => {
  const t = page(`próba${footer(NEWER)}`);
  t.openEditor();
  await settle();
  await settle();
  const keeps = t.posted.filter(item => item.kind === 'edit-keep');
  assert.deepEqual(keeps.map(item => item.expiresAt), [OLD, NEWER], 'the hook is first told what the page knows, then corrected');
  assert.equal(keeps[1].token, NOTE_UUID);
  t.kept();
  assert.equal(t.win.document.querySelector(`[data-testid="note-${SAVED_NOTE_ID}"] textarea + .isa-temporary-note-chip`).textContent,
    'Expires 2026-12-01 10:00 UTC');
});

test('an edit box opened after auto-delete was removed elsewhere tells the hook to forget the note', async () => {
  const t = page('próba');
  t.openEditor();
  await settle();
  await settle();
  assert.deepEqual(t.posted.map(item => item.kind), ['edit-keep', 'edit-forget']);
});

test('an unchanged server copy, a different token, or a failed read sends nothing more', async () => {
  for (const serverBody of [`próba${footer(OLD)}`, `próba${footer(NEWER, 'ccccdddd-eeee-4fff-8aaa-bbbbccccdddd')}`, 'reject']) {
    const t = page(serverBody);
    t.openEditor();
    await settle();
    await settle();
    assert.deepEqual(t.posted.map(item => `${item.kind}:${item.expiresAt}`), [`edit-keep:${OLD}`], serverBody.slice(0, 12));
  }
});
