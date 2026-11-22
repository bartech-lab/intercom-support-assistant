'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ORIGIN, loadSidebar, controlsOf, temporaryNoteCard, SAVED_NOTE_ID } = require('../support/temporary-notes-harness');

function mousedown(win, element) {
  const event = new win.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

test('a press on the Auto-delete label or on empty panel space does not take focus from the note box', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const label = panel.toggle.parentElement;
  assert.equal(mousedown(win, label), true, 'the label text keeps focus where it is; its click still ticks the box');
  assert.equal(mousedown(win, panel.controls), true);
  assert.equal(mousedown(win, panel.preview), true);
});

test('a press on a real field still moves focus to it', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  assert.equal(mousedown(win, panel.toggle), false);
  assert.equal(mousedown(win, panel.amount), false);
  assert.equal(mousedown(win, panel.date), false);
  assert.equal(mousedown(win, panel.time), false);
  assert.equal(mousedown(win, panel.controls.querySelector('button[aria-label="Open calendar"]')), false);
});

function editor(win, value) {
  const card = win.document.querySelector(`[data-testid="note-${SAVED_NOTE_ID}"]`);
  const textarea = win.document.createElement('textarea');
  textarea.setAttribute('aria-label', 'Edit note');
  card.append(textarea);
  textarea.value = value;
  win.refreshTemporaryNoteFooters();
  return textarea;
}

function reply(win, status) {
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-edit', noteId: SAVED_NOTE_ID, status, token: null, revision: null }
  });
}

const FOOTER = '\n\nAuto-delete after: 2026-09-09 07:55 UTC\n[ISA-AUTO-DELETE:v1;workspace=demo1234;contact=9007c24da170bbadc8e2598d'
  + ';expires=2026-09-09T07:55:12.120Z;token=aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa]';

test('the edit box text stays hidden by a style rule until the technical lines are removed', () => {
  const win = loadSidebar({ notes: temporaryNoteCard() });
  const style = () => win.document.getElementById('isa-temporary-note-edit-style');
  const textarea = editor(win, `note text${FOOTER}`);
  assert.ok(style(), 'the rule is installed');
  assert.match(style().textContent, /textarea\[aria-label="Edit note"\]:not\(\[data-isa-note-edit\]\)/);
  assert.match(style().textContent, /500ms forwards/, 'the text shows again on its own after half a second if nothing marks it');
  assert.equal(textarea.hasAttribute('data-isa-note-edit'), false, 'still waiting for the page hook');
  reply(win, 'kept');
  assert.equal(textarea.value, 'note text');
  assert.equal(textarea.hasAttribute('data-isa-note-edit'), true);
});

test('an edit box with nothing to hide, or one the hook refused, is shown at once', () => {
  const plain = loadSidebar({ notes: temporaryNoteCard() });
  assert.equal(editor(plain, 'an ordinary note').hasAttribute('data-isa-note-edit'), true);
  const refused = loadSidebar({ notes: temporaryNoteCard() });
  const textarea = editor(refused, `note text${FOOTER}`);
  reply(refused, 'blocked');
  assert.equal(textarea.hasAttribute('data-isa-note-edit'), true);
  assert.equal(textarea.value, `note text${FOOTER}`, 'a refused edit keeps the lines visible');
});

function armedPanel() {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const input = win.document.querySelector('[data-testid="notes-section"] textarea[data-testid="note-input"]');
  const events = [];
  input.addEventListener('blur', () => events.push('blur'));
  const reached = [];
  win.document.querySelector('aside').addEventListener('focusout', () => reached.push('focusout'));
  return { win, panel, input, events, reached, save: panel.controls.querySelector('.isa-temporary-note-save') };
}

function enter(win, element, init = {}) {
  const event = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

test('Save note shows only while auto-delete is on and is disabled until the lifetime is usable', () => {
  const { win, panel, save } = armedPanel();
  assert.equal(save.textContent, 'Save note');
  assert.equal(save.hidden, true);
  panel.toggle.checked = true;
  panel.toggle.dispatchEvent(new win.Event('change'));
  assert.equal(save.hidden, false);
  assert.equal(save.disabled, false);
  win.ISA_TEMPORARY_NOTES_UI.getDraft('demo1234:9007c24da170bbadc8e2598d').choice = 'custom-date';
  panel.toggle.dispatchEvent(new win.Event('change'));
  assert.equal(save.disabled, true, 'a custom date with no date picked cannot be saved');
});

test('Save note and Enter in a field hand the note box a focus and a blur, which is how Intercom saves it', () => {
  for (const act of [
    t => t.save.click(),
    t => assert.equal(enter(t.win, t.panel.time), true),
    t => assert.equal(enter(t.win, t.panel.amount), true),
    t => assert.equal(enter(t.win, t.panel.toggle), true)
  ]) {
    const t = armedPanel();
    t.input.value = 'call back on Friday';
    t.input.dispatchEvent(new t.win.Event('input', { bubbles: true }));
    t.panel.time.focus();
    act(t);
    assert.deepEqual(t.events, ['blur']);
    assert.equal(t.reached.length, 1, 'that one focus loss reaches Intercom');
  }
});

test('with an empty note box, Save note and Enter only move focus to the note box', () => {
  const t = armedPanel();
  t.panel.time.focus();
  assert.equal(enter(t.win, t.panel.time), true);
  assert.equal(t.win.document.activeElement, t.input);
  assert.deepEqual(t.events, []);
  t.save.click();
  assert.deepEqual(t.events, []);
});

test('Shift+Enter in a field, and Enter on a dropdown, are left to their own handling', () => {
  const t = armedPanel();
  t.panel.toggle.checked = true;
  t.panel.toggle.dispatchEvent(new t.win.Event('change'));
  t.input.value = 'text';
  assert.equal(enter(t.win, t.panel.time, { shiftKey: true }), false);
  enter(t.win, t.panel.choice);
  assert.ok(t.win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), 'Enter on the dropdown opens its list');
  assert.deepEqual(t.events, []);
});

test('moving from the note box into the auto-delete controls is not a save, clicking away is left to Intercom', () => {
  const t = armedPanel();
  t.input.value = 'half written';
  t.input.dispatchEvent(new t.win.Event('input', { bubbles: true }));
  t.input.focus();
  t.panel.time.focus();
  assert.deepEqual(t.reached, [], 'going to the time field does not reach Intercom');
  t.input.focus();
  t.input.blur();
  assert.equal(t.reached.length, 1, 'a plain focus loss is the save Intercom does by itself and is not blocked');
});

test('Enter in a field of the expiry change panel saves it; Enter with Shift does not', async () => {
  const win = loadSidebar({ notes: temporaryNoteCard() });
  win.refreshTemporaryNoteFooters();
  const calls = [];
  win.fetch = async (url, init = {}) => {
    if (!String(url).includes('/ember/inbox/notes')) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
    calls.push(init.method || 'GET');
    return { ok: false, status: 500, headers: { get: () => null }, text: async () => '' };
  };
  win.document.querySelector('.isa-temporary-note-chip').click();
  const layer = win.document.querySelector('.isa-temporary-note-expiry-editor');
  const time = layer.querySelector('input[aria-label="Auto-delete time, 24-hour clock"]');
  assert.equal(enter(win, time, { shiftKey: true }), false);
  assert.deepEqual(calls, []);
  assert.equal(enter(win, time), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['GET'], 'the save started');
});
