'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const {
  ORIGIN,
  WORKSPACE,
  CONTACT,
  loadSidebar,
  controlsOf,
  enable,
  press,
  openMenu,
  optionRows,
  choose,
} = require('../support/temporary-notes-harness');

function serializedMaxHeight(win, value) {
  const probe = win.document.createElement('div');
  probe.style.maxHeight = value;
  return probe.style.maxHeight;
}

test('a focused dropdown survives an observer pass on the same contact', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-delay');
  const before = win.ISA_TEMPORARY_NOTES_UI.getPanel();
  panel.unit.focus();

  const input = win.document.querySelector('textarea[data-testid="note-input"]');
  input.replaceWith(input.cloneNode());
  win.refreshTemporaryNoteControls();

  assert.equal(win.ISA_TEMPORARY_NOTES_UI.getPanel(), before,
    'the panel is not rebuilt while a control holds focus, even though the host swapped the input');
  assert.equal(panel.unit.isConnected, true, 'the open dropdown keeps its anchor node');
  assert.equal(win.document.querySelectorAll('.isa-temporary-note-controls').length, 1);
});

test('the listbox is a self-owned layer on the document, not a native popup', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  assert.equal(panel.choice.tagName, 'DIV', 'a native select cannot be positioned by us');
  assert.equal(panel.choice.getAttribute('role'), 'combobox');
  assert.equal(panel.choice.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(panel.choice.getAttribute('aria-expanded'), 'false');
  const layer = openMenu(win, panel.choice);
  assert.ok(layer, 'opening yields a layer we own');
  assert.equal(layer.parentElement, win.document.body,
    'the layer sits on the document, clear of any transformed or clipping ancestor');
  assert.equal(layer.style.position, 'fixed');
  assert.equal(layer.getAttribute('role'), 'listbox');
  assert.equal(panel.choice.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.choice.getAttribute('aria-controls'), layer.id);
  assert.ok(panel.choice.getAttribute('aria-activedescendant'), 'the active option is announced');
  assert.equal(layer.querySelectorAll('[role="option"]').length >= 10, true,
    'every preset plus both custom rows is listed');
  assert.equal(layer.style.maxHeight, serializedMaxHeight(win, 'min(calc(100vh - 24px),420px)'),
    'the list is tall enough to show every option without an inner scrollbar');

  win.ISA_TEMPORARY_NOTES_UI.closeMenu();
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null);
  assert.equal(win.document.querySelectorAll('.isa-temporary-note-menu').length, 0,
    'closing leaves no layer behind');
  assert.equal(panel.choice.getAttribute('aria-expanded'), 'false');
});

test('the layer is placed from the trigger viewport rect, so an ancestor transform cannot displace it', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-delay');
  const rect = { left: 240, right: 300, top: 400, bottom: 418, width: 60, height: 18 };
  panel.unit.getBoundingClientRect = () => rect;
  const layer = openMenu(win, panel.unit);
  assert.equal(layer.style.top, `${rect.bottom + 2}px`, 'the list opens directly below the field');
  assert.equal(layer.style.left, `${rect.left}px`, 'and aligned to its left edge');
  assert.equal(layer.style.minWidth, `${rect.width}px`);

  const moved = { ...rect, top: 700, bottom: 718 };
  panel.unit.getBoundingClientRect = () => moved;
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(layer.style.top, `${moved.bottom + 2}px`,
    'the layer follows the field when the page moves under it');
});

test('an open listbox survives the host replacing the note input', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  const layer = openMenu(win, panel.choice);
  const rows = optionRows(layer).length;

  const before = win.ISA_TEMPORARY_NOTES_UI.getPanel();
  const input = win.document.querySelector('[data-testid="notes-section"] textarea[data-testid="note-input"]');
  input.replaceWith(input.cloneNode());
  win.refreshTemporaryNoteControls();
  win.refreshTemporaryNoteControls();

  assert.equal(win.ISA_TEMPORARY_NOTES_UI.getPanel(), before, 'the panel is not rebuilt while its listbox is open');
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), layer, 'the same layer is still open');
  assert.equal(layer.isConnected, true);
  assert.equal(optionRows(layer).length, rows);
});

test('a listbox whose trigger is torn out closes instead of parking in the page corner', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  const layer = openMenu(win, panel.choice);

  panel.controls.remove();
  win.dispatchEvent(new win.Event('scroll'));

  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null, 'the orphaned layer is closed');
  assert.equal(layer.isConnected, false);
  assert.equal(win.document.querySelectorAll('.isa-temporary-note-menu').length, 0);
});

test('the listbox is driven by the keyboard per the select-only combobox pattern', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  const key = (name, init = {}) => panel.choice.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));

  key('ArrowDown');
  const layer = win.ISA_TEMPORARY_NOTES_UI.openMenuLayer();
  assert.ok(layer, 'ArrowDown opens the list');
  const active = () => optionRows(layer).findIndex(row => row.getAttribute('aria-selected') === 'true');
  assert.equal(optionRows(layer)[active()].dataset.value, String(30 * 86400000));

  key('Home');
  assert.equal(active(), 0, 'Home moves to the first option');
  key('End');
  assert.equal(active(), optionRows(layer).length - 1, 'End moves to the last');
  key('ArrowUp');
  assert.equal(active(), optionRows(layer).length - 2);
  key('c');
  assert.equal(optionRows(layer)[active()].textContent, 'Custom delay', 'typeahead jumps by label');
  key('Enter');
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null, 'Enter selects and closes');
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`).choice, 'custom-delay');
  assert.equal(win.getComputedStyle(panel.amount.parentElement).display, 'flex',
    'the keyboard selection drives the same state as a click');

  key('ArrowDown');
  assert.ok(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer());
  key('Escape');
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null, 'Escape closes without selecting');
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`).choice, 'custom-delay');
});

test('a click outside closes the listbox, and a busy panel refuses to open it', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  openMenu(win, panel.choice);
  win.document.body.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, composed: true }));
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null, 'an outside press closes the list');

  const state = win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`);
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-save', token: state.token,
      revision: state.revision, status: 'pending' }
  });
  const current = win.ISA_TEMPORARY_NOTES_UI.getPanel();
  assert.equal(current.choice.disabled, true, 'a submission in flight disables the picker');
  assert.equal(current.choice.trigger.getAttribute('aria-disabled'), 'true');
  press(win, current.choice.trigger, 'click');
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null, 'a disabled picker never opens');
});

test('a press on an injected control never reaches a host drag or click handler', () => {
  const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
  for (const enabled of [false, true]) {
    const win = loadSidebar();
    const panel = controlsOf(win);
    if (enabled) enable(win, panel);
    const seen = [];
    const sidebar = win.document.querySelector('aside[data-test-conversation-details-sidebar="true"]');
    types.forEach((type) => {
      sidebar.addEventListener(type, () => seen.push(`sidebar ${type}`));
      win.document.addEventListener(type, () => seen.push(`document ${type}`));
    });
    types.forEach((type) => {
      panel.choice.dispatchEvent(new win.Event(type, { bubbles: true, composed: true }));
    });
    assert.deepEqual(seen, [], `the host sees no part of the press with auto-delete ${enabled ? 'on' : 'off'}`);
  }
});

test('both dropdowns follow a dark host surface so the native popup is not white', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const sidebar = win.document.querySelector('aside[data-test-conversation-details-sidebar="true"]');
  sidebar.style.backgroundColor = 'rgb(28, 30, 34)';
  sidebar.style.color = 'rgb(233, 233, 233)';
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.applyTheme(win.ISA_TEMPORARY_NOTES_UI.getPanel()), true);
  [panel.choice, panel.unit].forEach((trigger) => {
    assert.equal(trigger.style.background, 'rgb(28, 30, 34)');
    assert.equal(trigger.style.color, 'rgb(233, 233, 233)');
  });
  const layer = openMenu(win, panel.unit);
  assert.equal(layer.style.background, 'rgb(28, 30, 34)', 'our own layer carries the surface colour');
  assert.equal(layer.style.color, 'rgb(233, 233, 233)');
  assert.equal(panel.date.style.colorScheme, 'dark');
  assert.equal(panel.amount.style.colorScheme, 'dark');
});

test('the surface walk crosses a shadow boundary, because the sidebar is in a shadow root', () => {
  const win = loadSidebar();
  const host = win.document.createElement('div');
  host.style.backgroundColor = 'rgb(20, 20, 20)';
  win.document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const inner = win.document.createElement('div');
  root.append(inner);
  const panel = controlsOf(win);
  inner.append(panel.controls);
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.applyTheme(win.ISA_TEMPORARY_NOTES_UI.getPanel()), true,
    'a panel inside a shadow root still resolves a surface colour');
  assert.equal(panel.choice.style.background, 'rgb(20, 20, 20)');
});

test('a light host surface keeps the dropdowns light', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const sidebar = win.document.querySelector('aside[data-test-conversation-details-sidebar="true"]');
  sidebar.style.backgroundColor = 'rgb(255, 255, 255)';
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.applyTheme(win.ISA_TEMPORARY_NOTES_UI.getPanel()), true);
  assert.equal(panel.choice.style.background, 'rgb(255, 255, 255)');
  assert.equal(panel.date.style.colorScheme, 'light');
});

test('a save failure notice does not outlive auto-delete being switched off', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  const state = win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`);
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-save', token: state.token,
      revision: state.revision, status: 'failed', reason: 'http-422' }
  });
  assert.match(panel.status.textContent, /not saved/, 'the failure shows while auto-delete is on');
  panel.toggle.checked = false;
  panel.toggle.dispatchEvent(new win.Event('change'));
  assert.equal(panel.status.textContent, '', 'switching auto-delete off clears the stale failure');
  assert.equal(panel.status.hidden, true);
  assert.equal(win.getComputedStyle(panel.status).display, 'none');
});
