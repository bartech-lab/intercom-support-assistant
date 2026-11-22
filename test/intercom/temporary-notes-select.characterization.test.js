'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

const KEY = `${WORKSPACE}:${CONTACT}`;

function ready() {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  return { win, panel, ui: win.ISA_TEMPORARY_NOTES_UI };
}

function key(win, element, name, init = {}) {
  const event = new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
}

function activeValue(ui) {
  const layer = ui.openMenuLayer();
  const rows = optionRows(layer).filter(row => row.getAttribute('aria-selected') === 'true');
  assert.equal(rows.length, 1, 'exactly one row is active');
  return rows[0].dataset.value;
}

function size(element, name, value) {
  Object.defineProperty(element, name, { configurable: true, get: () => value });
}

test('characterization: each closed-state key opens the list and is consumed, any other key is left alone', () => {
  for (const name of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
    const { win, panel, ui } = ready();
    const event = key(win, panel.choice, name);
    assert.ok(ui.openMenuLayer(), `${JSON.stringify(name)} opens the list`);
    assert.equal(event.defaultPrevented, true);
  }
  const { win, panel, ui } = ready();
  for (const name of ['Home', 'End', 'Escape', 'Tab', 'a']) {
    const event = key(win, panel.choice, name);
    assert.equal(ui.openMenuLayer(), null, `${name} does not open the list`);
    assert.equal(event.defaultPrevented, false);
  }
});

test('characterization: the list opens on the current value and the arrows clamp at both ends', () => {
  const { win, panel, ui } = ready();
  const layer = openMenu(win, panel.choice);
  const values = optionRows(layer).map(row => row.dataset.value);
  assert.equal(activeValue(ui), ui.getDraft(KEY).choice, 'the current value is the active row');
  key(win, panel.choice, 'Home');
  assert.equal(activeValue(ui), values[0]);
  key(win, panel.choice, 'ArrowUp');
  assert.equal(activeValue(ui), values[0], 'ArrowUp stops on the first row');
  key(win, panel.choice, 'ArrowDown');
  assert.equal(activeValue(ui), values[1]);
  const end = key(win, panel.choice, 'End');
  assert.equal(end.defaultPrevented, true);
  assert.equal(activeValue(ui), values[values.length - 1]);
  key(win, panel.choice, 'ArrowDown');
  assert.equal(activeValue(ui), values[values.length - 1], 'ArrowDown stops on the last row');
  const active = optionRows(layer).find(row => row.getAttribute('aria-selected') === 'true');
  assert.equal(panel.choice.getAttribute('aria-activedescendant'), active.id);
  assert.equal(active.id, `${layer.id}-option-${values.length - 1}`);
  assert.match(layer.id, /^isa-temporary-note-list-\d+$/);
  assert.equal(layer.className, 'isa-temporary-note-menu');
  assert.equal(layer.getAttribute('aria-label'), 'Auto-delete lifetime');
});

test('characterization: typeahead matches a label prefix, extends inside 500 ms and restarts after it', () => {
  const { win, panel, ui } = ready();
  openMenu(win, panel.choice);
  const realNow = win.Date.now;
  let now = 1000000;
  win.Date.now = () => now;
  try {
    const first = key(win, panel.choice, '1');
    assert.equal(first.defaultPrevented, true);
    assert.equal(activeValue(ui), '3600000', 'the first label starting with 1 is "1 hour"');
    now += 500;
    key(win, panel.choice, '2');
    assert.equal(activeValue(ui), '43200000', 'a key inside 500 ms extends the search to "12"');
    now += 100;
    key(win, panel.choice, 'z');
    assert.equal(activeValue(ui), '43200000', 'a search with no match leaves the active row alone');
    now += 501;
    key(win, panel.choice, 'C');
    assert.equal(activeValue(ui), 'custom-delay', 'after the pause the search restarts, ignoring case');
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
      const chord = key(win, panel.choice, '3', { [modifier]: true });
      assert.equal(chord.defaultPrevented, false, 'a modified key is not a search');
    }
    assert.equal(activeValue(ui), 'custom-delay');
  } finally {
    win.Date.now = realNow;
  }
});

test('characterization: Enter and Space commit the active row, return focus and fire one change', () => {
  for (const name of ['Enter', ' ']) {
    const { win, panel, ui } = ready();
    openMenu(win, panel.choice);
    key(win, panel.choice, 'End');
    let focused = 0;
    const focus = panel.choice.focus.bind(panel.choice);
    panel.choice.focus = () => { focused += 1; focus(); };
    const before = ui.getDraft(KEY).revision;
    key(win, panel.choice, name);
    assert.equal(focused, 1, 'the commit focuses the trigger');
    assert.equal(ui.openMenuLayer(), null);
    assert.equal(ui.getDraft(KEY).choice, 'custom-date');
    assert.equal(panel.choice.firstChild.textContent, 'Custom date');
    assert.equal(win.document.activeElement, panel.choice, 'focus returns to the trigger');
    assert.equal(ui.getDraft(KEY).revision, before + 1, 'one change is reported');
    assert.equal(panel.choice.hasAttribute('aria-activedescendant'), false);
  }
});

test('characterization: committing the value already chosen reports no change', () => {
  const { win, panel, ui } = ready();
  const before = ui.getDraft(KEY).revision;
  openMenu(win, panel.choice);
  key(win, panel.choice, 'Enter');
  assert.equal(ui.openMenuLayer(), null);
  assert.equal(ui.getDraft(KEY).revision, before);
});

test('characterization: Escape is consumed, Tab is not, blur closes, and none of them change the value', () => {
  const { win, panel, ui } = ready();
  const start = ui.getDraft(KEY).choice;
  openMenu(win, panel.choice);
  key(win, panel.choice, 'End');
  const escape = key(win, panel.choice, 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(ui.openMenuLayer(), null);

  openMenu(win, panel.choice);
  key(win, panel.choice, 'End');
  const tab = key(win, panel.choice, 'Tab');
  assert.equal(tab.defaultPrevented, false, 'Tab keeps moving focus');
  assert.equal(ui.openMenuLayer(), null);

  openMenu(win, panel.choice);
  panel.choice.dispatchEvent(new win.FocusEvent('blur'));
  assert.equal(ui.openMenuLayer(), null);
  assert.equal(ui.getDraft(KEY).choice, start);
});

test('characterization: a click toggles the list and focuses the trigger; opening one list closes the other', () => {
  const { win, panel, ui } = ready();
  choose(win, panel, 'custom-delay');
  const first = openMenu(win, panel.choice);
  assert.equal(win.document.activeElement, panel.choice);
  press(win, panel.choice, 'click');
  assert.equal(ui.openMenuLayer(), null, 'a second click closes it');
  assert.equal(first.isConnected, false);

  const lifetime = openMenu(win, panel.choice);
  const unit = openMenu(win, panel.unit);
  assert.notEqual(unit, lifetime);
  assert.equal(lifetime.isConnected, false, 'only one list is open at a time');
  assert.equal(panel.choice.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.unit.getAttribute('aria-expanded'), 'true');
  assert.equal(win.document.querySelectorAll('.isa-temporary-note-menu').length, 1);
});

test('characterization: a press inside the list or on the trigger keeps it open, a press elsewhere closes it', () => {
  const { win, panel, ui } = ready();
  const layer = openMenu(win, panel.choice);
  layer.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));
  assert.equal(ui.openMenuLayer(), layer);
  panel.choice.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));
  assert.equal(ui.openMenuLayer(), layer);
  panel.preview.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));
  assert.equal(ui.openMenuLayer(), null);
});

test('characterization: hovering a row makes it active and a row click commits it without reaching the page', () => {
  const { win, panel, ui } = ready();
  const layer = openMenu(win, panel.choice);
  const rows = optionRows(layer);
  const target = rows.find(row => row.dataset.value === 'custom-delay');
  target.dispatchEvent(new win.Event('pointerenter'));
  assert.equal(activeValue(ui), 'custom-delay');
  const seen = [];
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'click'].forEach((type) => {
    win.document.body.addEventListener(type, () => seen.push(type));
  });
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart'].forEach((type) => {
    const event = new win.Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (type === 'pointerdown') assert.equal(event.defaultPrevented, true, 'a row press does not move focus');
  });
  press(win, target, 'click');
  assert.deepEqual(seen, [], 'the page sees none of the press');
  assert.equal(ui.getDraft(KEY).choice, 'custom-delay');
  assert.equal(ui.openMenuLayer(), null);
});

test('characterization: a press on the trigger is prevented and stopped', () => {
  const { win, panel } = ready();
  const seen = [];
  win.document.body.addEventListener('pointerdown', () => seen.push('pointerdown'));
  const event = new win.Event('pointerdown', { bubbles: true, cancelable: true });
  panel.choice.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(seen, []);
});

test('characterization: the list flips above when there is no room below, with a 2 px gap and a 4 px edge clamp', () => {
  const { win, panel, ui } = ready();
  choose(win, panel, 'custom-delay');
  const below = { left: 240, right: 300, top: 100, bottom: 118, width: 60, height: 18 };
  panel.unit.getBoundingClientRect = () => below;
  const layer = openMenu(win, panel.unit);
  size(layer, 'offsetHeight', 200);
  size(layer, 'offsetWidth', 120);
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(layer.style.top, '120px');
  assert.equal(layer.style.left, '240px');
  assert.equal(layer.style.minWidth, '60px');

  const low = { left: 240, right: 300, top: win.innerHeight - 60, bottom: win.innerHeight - 42, width: 60, height: 18 };
  panel.unit.getBoundingClientRect = () => low;
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(layer.style.top, `${low.top - 200 - 2}px`, 'above the trigger, 2 px clear of it');

  const high = { left: 240, right: 300, top: 150, bottom: win.innerHeight - 10, width: 60, height: 18 };
  panel.unit.getBoundingClientRect = () => high;
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(layer.style.top, '4px', 'never above the top edge');

  const right = { left: win.innerWidth - 20, right: win.innerWidth, top: 100, bottom: 118, width: 20, height: 18 };
  panel.unit.getBoundingClientRect = () => right;
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(layer.style.left, `${win.innerWidth - 120 - 4}px`, 'kept 4 px inside the right edge');

  const left = { left: -50, right: 10, top: 100, bottom: 118, width: 60, height: 18 };
  panel.unit.getBoundingClientRect = () => left;
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(layer.style.left, '4px', 'kept 4 px inside the left edge');
  assert.equal(ui.openMenuLayer(), layer);
});

test('characterization: closing removes the scroll, resize and outside-press listeners', () => {
  const { win, panel, ui } = ready();
  const layer = openMenu(win, panel.choice);
  ui.closeMenu();
  layer.style.top = 'unset';
  panel.choice.getBoundingClientRect = () => ({ left: 1, right: 2, top: 3, bottom: 4, width: 1, height: 1 });
  win.dispatchEvent(new win.Event('scroll'));
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(layer.style.top, 'unset', 'a closed list is no longer repositioned');
  ui.closeMenu();
  assert.equal(ui.openMenuLayer(), null, 'closing twice is harmless');
});

test('characterization: a panel inside a shadow root still opens on the document and closes on an outside press', () => {
  const { win, panel, ui } = ready();
  const host = win.document.createElement('div');
  win.document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.append(panel.controls);
  const layer = openMenu(win, panel.choice);
  assert.equal(layer.parentElement, win.document.body);
  panel.choice.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));
  assert.equal(ui.openMenuLayer(), layer, 'a press on the trigger inside the shadow root is not outside');
  key(win, panel.choice, 'End');
  key(win, panel.choice, 'Enter');
  assert.equal(ui.getDraft(KEY).choice, 'custom-date');
  openMenu(win, panel.choice);
  win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));
  assert.equal(ui.openMenuLayer(), null);
});

test('characterization: a busy panel disables both dropdowns, closes an open list and ignores clicks and keys', () => {
  const { win, panel, ui } = ready();
  choose(win, panel, 'custom-delay');
  assert.equal(panel.choice.getAttribute('aria-disabled'), 'false');
  assert.equal(panel.choice.tabIndex, 0);
  assert.equal(panel.choice.style.opacity, '1');
  openMenu(win, panel.unit);
  const state = ui.getDraft(KEY);
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-save', token: state.token,
      revision: state.revision, status: 'pending' }
  });
  assert.equal(ui.openMenuLayer(), null, 'disabling closes the open list');
  const current = ui.getPanel();
  for (const trigger of [current.choice.trigger, current.delayUnit.trigger]) {
    assert.equal(trigger.getAttribute('aria-disabled'), 'true');
    assert.equal(trigger.tabIndex, -1);
    assert.equal(trigger.style.opacity, '0.5');
    press(win, trigger, 'click');
    assert.equal(ui.openMenuLayer(), null);
    const event = key(win, trigger, 'Enter');
    assert.equal(event.defaultPrevented, false);
    assert.equal(ui.openMenuLayer(), null);
  }
});

test('characterization: without a host surface the list uses the built-in light colours', () => {
  const { win, panel, ui } = ready();
  const layer = openMenu(win, panel.choice);
  const probe = win.document.createElement('div');
  const colour = (value) => { probe.style.background = value; return probe.style.background; };
  assert.equal(layer.style.background, colour('#ffffff'));
  assert.equal(layer.style.border, '1px solid rgb(200, 200, 200)');
  const rows = optionRows(layer);
  const active = rows.find(row => row.getAttribute('aria-selected') === 'true');
  const idle = rows.find(row => row.getAttribute('aria-selected') === 'false');
  assert.equal(active.style.background, colour('#1a73e8'));
  assert.equal(active.style.color, 'rgb(255, 255, 255)');
  assert.equal(idle.style.background, colour('transparent'));
  assert.equal(idle.style.color, 'rgb(17, 17, 17)');
  assert.equal(ui.openMenuLayer(), layer);
});

test('characterization: a theme change restyles the triggers and rebuilds an open list in the new colours', () => {
  const { win, panel, ui } = ready();
  const before = openMenu(win, panel.choice);
  key(win, panel.choice, 'End');
  const sidebar = win.document.querySelector('aside[data-test-conversation-details-sidebar="true"]');
  sidebar.style.backgroundColor = 'rgb(28, 30, 34)';
  sidebar.style.color = 'rgb(233, 233, 233)';
  assert.equal(ui.applyTheme(ui.getPanel()), true);
  const after = ui.openMenuLayer();
  assert.ok(after, 'the list stays open across a theme change');
  assert.notEqual(after, before, 'it is rebuilt');
  assert.equal(before.isConnected, false);
  assert.equal(after.style.background, 'rgb(28, 30, 34)');
  assert.equal(after.style.border, '1px solid rgb(54, 56, 60)');
  assert.equal(activeValue(ui), ui.getDraft(KEY).choice, 'the rebuilt list starts again from the current value');
  const active = optionRows(after).find(row => row.getAttribute('aria-selected') === 'true');
  assert.equal(active.style.background, 'rgb(68, 70, 74)');
  assert.equal(active.style.color, 'rgb(233, 233, 233)');
  assert.equal(panel.choice.style.border, '1px solid rgb(54, 56, 60)');
  assert.equal(panel.unit.style.background, 'rgb(28, 30, 34)');
});

test('characterization: the trigger shows the chosen label beside a hidden caret', () => {
  const { panel } = ready();
  assert.equal(panel.choice.getAttribute('aria-label'), 'Auto-delete lifetime');
  assert.equal(panel.unit.getAttribute('aria-label'), 'Auto-delete custom unit');
  assert.equal(panel.choice.className, '');
  assert.equal(panel.choice.children.length, 2);
  assert.equal(panel.choice.lastChild.getAttribute('aria-hidden'), 'true');
  assert.equal(panel.choice.lastChild.textContent, '▾');
  assert.equal(panel.unit.firstChild.textContent, 'hours');
  assert.equal(panel.choice.style.minWidth, '96px');
  assert.equal(panel.choice.style.display, 'inline-flex');
});
