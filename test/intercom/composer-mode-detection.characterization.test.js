'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

function load(html = '<!doctype html><html><body></body></html>') {
  return loadExtension(html);
}

function rootWith(win, innerHtml, attrs = '') {
  const holder = win.document.createElement('div');
  holder.innerHTML = `<div ${attrs}>${innerHtml}</div>`;
  win.document.body.appendChild(holder);
  return holder.firstElementChild;
}

function chain(win, depth, markerLevel) {
  const editor = win.document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  let current = editor;
  const ancestors = [];
  for (let level = 1; level <= depth; level += 1) {
    const parent = win.document.createElement('div');
    if (level === markerLevel) parent.className = 'inbox2__note-pane';
    parent.appendChild(current);
    ancestors.push(parent);
    current = parent;
  }
  win.document.body.appendChild(current);
  return { editor, ancestors };
}

test('characterization: composerModeFromRoot returns null for null, undefined and objects without querySelector', () => {
  const win = load();
  assert.equal(win.composerModeFromRoot(null), null);
  assert.equal(win.composerModeFromRoot(undefined), null);
  assert.equal(win.composerModeFromRoot({}), null);
});

test('characterization: composerModeFromRoot prefers the note icon over the email icon', () => {
  const win = load();
  const root = rootWith(win, '<svg class="o__standard__email-filled"></svg><svg class="o__standard__edit"></svg>');
  assert.equal(win.composerModeFromRoot(root), 'note');
});

test('characterization: composerModeFromRoot returns email for the email icon alone', () => {
  const win = load();
  const root = rootWith(win, '<svg class="o__standard__email-filled"></svg>');
  assert.equal(win.composerModeFromRoot(root), 'email');
});

test('characterization: composerModeFromRoot returns note for the inbox2__note-pane class on the root', () => {
  const win = load();
  const root = rootWith(win, '<p>nothing</p>', 'class="inbox2__note-pane"');
  assert.equal(win.composerModeFromRoot(root), 'note');
});

test('characterization: composerModeFromRoot returns note for a note send button descendant', () => {
  const win = load();
  const root = rootWith(win, '<i data-intercom-target="note-send-button"></i>');
  assert.equal(win.composerModeFromRoot(root), 'note');
});

test('characterization: composerModeFromRoot maps the four mode labels', () => {
  const win = load();
  const expected = { Email: 'email', Note: 'note', Chat: 'chat', Reply: 'chat' };
  for (const [label, mode] of Object.entries(expected)) {
    const root = rootWith(win, `<button>${label}</button>`);
    assert.equal(win.composerModeFromRoot(root), mode, label);
  }
});

test('characterization: composerModeFromRoot trims whitespace around a label', () => {
  const win = load();
  const root = rootWith(win, '<button>  Email  </button>');
  assert.equal(win.composerModeFromRoot(root), 'email');
});

test('characterization: composerModeFromRoot skips a non-matching label before a matching one', () => {
  const win = load();
  const root = rootWith(win, '<button>Send now</button><button>Note</button>');
  assert.equal(win.composerModeFromRoot(root), 'note');
});

test('characterization: composerModeFromRoot ignores a label that only contains a mode word', () => {
  const win = load();
  const root = rootWith(win, '<button>Email me</button>');
  assert.equal(win.composerModeFromRoot(root), null);
});

test('characterization: composerModeFromRoot falls back to Add note text', () => {
  const win = load();
  const root = rootWith(win, '<p>Click to Add note here</p>');
  assert.equal(win.composerModeFromRoot(root), 'note');
});

test('characterization: composerModeFromRoot returns null when nothing marks a mode', () => {
  const win = load();
  const root = rootWith(win, '<p>plain text</p><button>Cancel</button>');
  assert.equal(win.composerModeFromRoot(root), null);
});

test('characterization: resolveComposerRootFromEditor returns null for a null editor', () => {
  const win = load();
  assert.equal(win.resolveComposerRootFromEditor(null), null);
});

test('characterization: resolveComposerRootFromEditor never returns the editor itself', () => {
  const win = load();
  const editor = win.document.createElement('div');
  editor.className = 'inbox2__note-pane';
  const parent = win.document.createElement('div');
  parent.appendChild(editor);
  win.document.body.appendChild(parent);
  assert.equal(win.resolveComposerRootFromEditor(editor), null);
});

test('characterization: resolveComposerRootFromEditor finds a marker on the 1st ancestor', () => {
  const win = load();
  const { editor, ancestors } = chain(win, 10, 1);
  assert.equal(win.resolveComposerRootFromEditor(editor), ancestors[0]);
});

test('characterization: resolveComposerRootFromEditor finds a marker on the 8th ancestor', () => {
  const win = load();
  const { editor, ancestors } = chain(win, 10, 8);
  assert.equal(win.resolveComposerRootFromEditor(editor), ancestors[7]);
});

test('characterization: resolveComposerRootFromEditor ignores a marker on the 9th ancestor', () => {
  const win = load();
  const { editor } = chain(win, 10, 9);
  assert.equal(win.resolveComposerRootFromEditor(editor), null);
});

test('characterization: getComposerModeRoots lists editor root, containers, then fallbacks without duplicates', () => {
  const win = load();
  const editorRoot = rootWith(win, '<div id="ed" contenteditable="true"></div>', 'data-testid="composer-orchestrator" class="inbox2__note-pane" id="r0"');
  const second = rootWith(win, '<p></p>', 'data-testid="composer-orchestrator" id="r1"');
  const fallbackOnly = rootWith(win, '<p></p>', 'class="inbox2__composer__container" id="r2"');
  const both = rootWith(win, '<p></p>', 'data-testid="composer-orchestrator" data-conversation-reply-composer id="r3"');
  const fallbackTwo = rootWith(win, '<p></p>', 'data-conversation-reply-composer-root id="r4"');
  const editor = win.document.getElementById('ed');
  const roots = Array.from(win.getComposerModeRoots(editor));
  assert.deepEqual(roots.map(el => el.id), ['r0', 'r1', 'r3', 'r2', 'r4']);
  assert.equal(roots[0], editorRoot);
  assert.equal(roots[1], second);
  assert.equal(roots[2], both);
  assert.equal(roots[3], fallbackOnly);
  assert.equal(roots[4], fallbackTwo);
});

test('characterization: getComposerModeRoots puts a non-container editor root first', () => {
  const win = load();
  const pane = rootWith(win, '<div id="ed"></div>', 'class="inbox2__note-pane" id="pane"');
  rootWith(win, '<p></p>', 'data-testid="composer-orchestrator" id="c1"');
  const roots = Array.from(win.getComposerModeRoots(win.document.getElementById('ed')));
  assert.deepEqual(roots.map(el => el.id), ['pane', 'c1']);
  assert.equal(roots[0], pane);
});
