'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSidebar, ORIGIN, WORKSPACE, CONTACT } = require('../support/temporary-notes-harness');

const NOTE_UUID = 'aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa';
const EXPIRES = '2026-09-09T07:55:12.120Z';
const READABLE = 'Auto-delete after: 2026-09-09 07:55 UTC';
const MARKER = `[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT};expires=${EXPIRES};token=${NOTE_UUID}]`;
const FOOTER = `${READABLE}\n${MARKER}`;
const NOTE = '900661995';

function withFooter(text) {
  return `${text}\n\n${FOOTER}`;
}

function start() {
  const win = loadSidebar();
  const seen = [];
  const post = win.postMessage.bind(win);
  win.postMessage = (message, origin) => {
    seen.push(message);
    return post(message, origin);
  };
  const section = win.document.querySelector('[data-testid="notes-section"]');
  const inputs = [];
  const open = (value, noteId = NOTE) => {
    let card = win.document.querySelector(`[data-testid="note-${noteId}"]`);
    if (!card) {
      card = win.document.createElement('div');
      card.setAttribute('data-testid', `note-${noteId}`);
      section.appendChild(card);
    }
    const inner = win.document.createElement('div');
    const textarea = win.document.createElement('textarea');
    textarea.setAttribute('aria-label', 'Edit note');
    textarea.value = value;
    inner.appendChild(textarea);
    card.appendChild(inner);
    textarea.addEventListener('input', () => inputs.push(textarea.value));
    return textarea;
  };
  const scan = () => win.refreshTemporaryNoteFooters();
  const edits = () => seen.filter(item => item && ['edit-keep', 'edit-forget'].includes(item.kind)).map(item => ({ ...item }));
  const reply = (status, noteId = NOTE) => win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-edit', noteId, status, token: null, revision: null }
  });
  const chips = () => [...win.document.querySelectorAll('.isa-temporary-note-chip')];
  return { win, seen, open, scan, edits, reply, chips, inputs };
}

const keepMessage = (overrides = {}) => ({
  __isaTempNote: true,
  kind: 'edit-keep',
  workspace: WORKSPACE,
  contact: CONTACT,
  noteId: NOTE,
  token: NOTE_UUID,
  expiresAt: EXPIRES,
  ...overrides
});

test('a scan posts edit-keep with token and expiry from the footer and leaves the textarea alone', () => {
  const ui = start();
  const value = withFooter('hello');
  const textarea = ui.open(value);
  ui.scan();
  assert.deepEqual(ui.edits(), [keepMessage()]);
  assert.equal(textarea.value, value);
  assert.equal(ui.inputs.length, 0);
  assert.equal(ui.chips().length, 0);
});

test('edit-keep is posted once per textarea element across repeated scans', () => {
  const ui = start();
  ui.open(withFooter('hello'));
  ui.scan();
  ui.scan();
  ui.scan();
  assert.equal(ui.edits().length, 1);
});

test('a note without a footer posts edit-forget and its value is never changed', () => {
  const ui = start();
  const textarea = ui.open('just an ordinary note');
  ui.scan();
  ui.scan();
  assert.deepEqual(ui.edits(), [{ __isaTempNote: true, kind: 'edit-forget', noteId: NOTE }]);
  ui.reply('kept');
  ui.scan();
  assert.equal(textarea.value, 'just an ordinary note');
  assert.equal(ui.inputs.length, 0);
  assert.equal(ui.chips().length, 0);
});

test('an invalid footer posts edit-forget and is not changed', () => {
  const variants = {
    readableEdited: `hello\n\nAuto-delete after: 2026-09-10 07:55 UTC\n${MARKER}`,
    readableMissing: `hello\n\n${MARKER}`,
    textAfterBracket: `hello\n\n${FOOTER} trailing`,
    textAfterBracketLine: `hello\n\n${FOOTER}\nmore text`
  };
  for (const [name, value] of Object.entries(variants)) {
    const ui = start();
    const textarea = ui.open(value);
    ui.scan();
    assert.deepEqual(ui.edits(), [{ __isaTempNote: true, kind: 'edit-forget', noteId: NOTE }], name);
    ui.reply('kept');
    assert.equal(textarea.value, value, name);
  }
});

test('a footer for another contact or another workspace posts edit-forget', () => {
  const otherContact = withFooter('hello').replace(CONTACT, '9007c24da170bbadc8e2598e');
  const otherWorkspace = withFooter('hello').replace(`workspace=${WORKSPACE}`, 'workspace=zzzz9999');
  for (const value of [otherContact, otherWorkspace]) {
    const ui = start();
    const textarea = ui.open(value);
    ui.scan();
    assert.deepEqual(ui.edits(), [{ __isaTempNote: true, kind: 'edit-forget', noteId: NOTE }]);
    ui.reply('kept');
    assert.equal(textarea.value, value);
    assert.equal(ui.chips().length, 0);
  }
});

test('a kept reply strips the footer and the blank line, fires one bubbling input event and shows a chip', () => {
  const ui = start();
  const textarea = ui.open(withFooter('hello'));
  ui.scan();
  let bubbled = false;
  ui.win.document.addEventListener('input', () => { bubbled = true; });
  ui.reply('kept');
  assert.equal(textarea.value, 'hello');
  assert.deepEqual(ui.inputs, ['hello']);
  assert.equal(bubbled, true);
  const chips = ui.chips();
  assert.equal(chips.length, 1);
  assert.equal(textarea.nextElementSibling, chips[0]);
  assert.match(chips[0].textContent, /UTC/);
});

test('a multi-line note text keeps its inner line breaks', () => {
  const ui = start();
  const textarea = ui.open(withFooter('line one\n\nline three'));
  ui.scan();
  ui.reply('kept');
  assert.equal(textarea.value, 'line one\n\nline three');
});

test('text typed into the text part before the reply is kept and only the footer is removed', () => {
  const ui = start();
  const textarea = ui.open(withFooter('hello'));
  ui.scan();
  textarea.value = withFooter('hello world, typed');
  ui.reply('kept');
  assert.equal(textarea.value, 'hello world, typed');
});

test('if the value no longer ends with a valid footer at reply time nothing changes', () => {
  const ui = start();
  const textarea = ui.open(withFooter('hello'));
  ui.scan();
  const broken = `hello\n\n${READABLE} edited\n${MARKER}`;
  textarea.value = broken;
  ui.reply('kept');
  assert.equal(textarea.value, broken);
  assert.equal(ui.inputs.length, 0);
  assert.equal(ui.chips().length, 0);
});

test('a second kept reply does nothing more', () => {
  const ui = start();
  const textarea = ui.open(withFooter('hello'));
  ui.scan();
  ui.reply('kept');
  ui.reply('kept');
  assert.equal(textarea.value, 'hello');
  assert.equal(ui.inputs.length, 1);
  assert.equal(ui.chips().length, 1);
});

test('blocked and every other status never change the textarea', () => {
  for (const status of ['blocked', 'failed', 'saved', 'unconfirmed', 'armed', '']) {
    const ui = start();
    const value = withFooter('hello');
    const textarea = ui.open(value);
    ui.scan();
    ui.reply(status);
    assert.equal(textarea.value, value, status);
    assert.equal(ui.inputs.length, 0, status);
    assert.equal(ui.chips().length, 0, status);
  }
});

test('a kept reply for a note with no open editor does nothing and does not throw', () => {
  const ui = start();
  assert.doesNotThrow(() => ui.reply('kept', '777'));
  const textarea = ui.open(withFooter('hello'));
  ui.scan();
  assert.doesNotThrow(() => ui.reply('kept', '777'));
  assert.equal(textarea.value, withFooter('hello'));
});

test('a kept reply for one note does not touch the editor of another note', () => {
  const ui = start();
  const first = ui.open(withFooter('first'), '111');
  const second = ui.open(withFooter('second'), '222');
  ui.scan();
  ui.reply('kept', '222');
  assert.equal(first.value, withFooter('first'));
  assert.equal(second.value, 'second');
  assert.deepEqual(ui.edits().map(item => item.noteId).sort(), ['111', '222']);
});

test('when Intercom swaps the textarea for the same note no edit-forget is posted and nothing new is posted', () => {
  const ui = start();
  const first = ui.open(withFooter('hello'));
  ui.scan();
  ui.reply('kept');
  const before = ui.edits().length;
  first.remove();
  const second = ui.open('hello');
  ui.scan();
  ui.scan();
  assert.equal(ui.edits().length, before);
  assert.equal(ui.edits().some(item => item.kind === 'edit-forget'), false);
  assert.equal(second.value, 'hello');
  assert.equal(ui.chips().length, 1);
  assert.equal(second.nextElementSibling, ui.chips()[0]);
});

test('closing the editor removes the chip, and reopening with a footer posts edit-keep again', () => {
  const ui = start();
  const first = ui.open(withFooter('hello'));
  ui.scan();
  ui.reply('kept');
  assert.equal(ui.chips().length, 1);
  first.remove();
  ui.scan();
  assert.equal(ui.chips().length, 0);
  ui.open(withFooter('hello again'));
  ui.scan();
  assert.deepEqual(ui.edits().map(item => item.kind), ['edit-keep', 'edit-keep']);
});

test('a closed editor followed by an ordinary reopened note posts edit-forget for the new editor', () => {
  const ui = start();
  const first = ui.open(withFooter('hello'));
  ui.scan();
  ui.reply('kept');
  first.remove();
  ui.scan();
  ui.open('hello');
  ui.scan();
  assert.deepEqual(ui.edits().map(item => item.kind), ['edit-keep', 'edit-forget']);
});

test('an ordinary note keeps its value across scans and replies', () => {
  const ui = start();
  const textarea = ui.open('plain text with [brackets] only');
  for (let index = 0; index < 3; index += 1) {
    ui.scan();
    ui.reply('kept');
  }
  assert.equal(textarea.value, 'plain text with [brackets] only');
  assert.equal(ui.inputs.length, 0);
});

test('an edit textarea outside a numbered note card is ignored', () => {
  const ui = start();
  const card = ui.win.document.createElement('div');
  card.setAttribute('data-testid', 'note-abc');
  const textarea = ui.win.document.createElement('textarea');
  textarea.setAttribute('aria-label', 'Edit note');
  textarea.value = withFooter('hello');
  card.appendChild(textarea);
  ui.win.document.querySelector('[data-testid="notes-section"]').appendChild(card);
  ui.scan();
  assert.deepEqual(ui.edits(), []);
});

test('an Add a note composer is never treated as an editor', () => {
  const ui = start();
  const composer = ui.win.document.querySelector('textarea[data-testid="note-input"]');
  composer.value = withFooter('draft');
  ui.scan();
  assert.deepEqual(ui.edits(), []);
});
