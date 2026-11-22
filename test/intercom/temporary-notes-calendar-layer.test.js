'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSidebar, controlsOf, enable, choose, openMenu } = require('../support/temporary-notes-harness');

function ready() {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  const calendar = win.ISA_TEMPORARY_NOTES_UI.getPanel().calendar;
  return { win, panel, calendar };
}

function size(element, name, value) {
  Object.defineProperty(element, name, { configurable: true, get: () => value });
}

test('the open calendar is a fixed layer on the document, so the sidebar cannot clip it', () => {
  const { win, panel, calendar } = ready();
  assert.equal(calendar.panel.hidden, true);
  assert.equal(calendar.panel.parentElement, calendar.wrap, 'a closed calendar rests beside its button');
  calendar.trigger.click();
  assert.equal(calendar.panel.parentElement, win.document.body);
  assert.equal(calendar.panel.style.position, 'fixed');
  assert.equal(calendar.panel.hidden, false);
  assert.equal(panel.controls.contains(calendar.panel), false);
  calendar.trigger.click();
  assert.equal(calendar.panel.parentElement, calendar.wrap, 'closing takes the layer off the document again');
  assert.equal(calendar.panel.hidden, true);
});

test('the layer opens under the button at the date field left edge, flips above without room, and stays in the viewport', () => {
  const { win, panel, calendar } = ready();
  let button = { left: 150, right: 176, top: 100, bottom: 126, width: 26, height: 26 };
  let field = { left: 50, right: 146, top: 100, bottom: 126, width: 96, height: 26 };
  calendar.trigger.getBoundingClientRect = () => button;
  panel.date.getBoundingClientRect = () => field;
  size(calendar.panel, 'offsetHeight', 240);
  size(calendar.panel, 'offsetWidth', 220);
  calendar.trigger.click();
  assert.equal(calendar.panel.style.top, '130px');
  assert.equal(calendar.panel.style.left, '50px');

  button = { ...button, top: win.innerHeight - 60, bottom: win.innerHeight - 34 };
  win.dispatchEvent(new win.Event('scroll'));
  assert.equal(calendar.panel.style.top, `${win.innerHeight - 60 - 240 - 4}px`, 'above the button when the space below is too small');

  field = { ...field, left: win.innerWidth - 30 };
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(calendar.panel.style.left, `${win.innerWidth - 220 - 4}px`, 'pulled in from the right edge');
  field = { ...field, left: -40 };
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(calendar.panel.style.left, '4px');
});

test('a press inside the layer keeps it open and never reaches the page; a press elsewhere closes it', () => {
  const { win, calendar } = ready();
  calendar.trigger.click();
  const seen = [];
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart'].forEach((type) => {
    win.document.body.addEventListener(type, () => seen.push(type));
  });
  const next = calendar.panel.querySelector('button[aria-label="Next month"]');
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart'].forEach((type) => {
    next.dispatchEvent(new win.MouseEvent(type, { bubbles: true, composed: true, cancelable: true }));
  });
  next.click();
  assert.deepEqual(seen, []);
  assert.equal(calendar.isOpen(), true);
  win.document.body.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, composed: true }));
  assert.equal(calendar.isOpen(), false);
  assert.equal(calendar.panel.parentElement, calendar.wrap);
});

test('picking a day closes the layer and fills the date', () => {
  const { panel, calendar } = ready();
  calendar.trigger.click();
  const day = calendar.panel.querySelector('button[data-day]');
  const iso = day.dataset.day;
  day.click();
  assert.equal(calendar.isOpen(), false);
  assert.equal(panel.date.value, `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`);
});

test('the layer does not outlive its panel', () => {
  const first = ready();
  first.calendar.trigger.click();
  first.panel.controls.remove();
  first.win.refreshTemporaryNoteControls();
  assert.equal(first.calendar.panel.isConnected, false, 'a calendar whose button was torn out closes on the next pass');
  assert.equal(first.calendar.isOpen(), false);

  const second = ready();
  second.calendar.trigger.click();
  second.panel.controls.remove();
  second.win.dispatchEvent(new second.win.Event('scroll'));
  assert.equal(second.calendar.panel.isConnected, false, 'and on the next scroll');
});

test('the layer takes the theme and the panel font', () => {
  const { win, calendar } = ready();
  const sidebar = win.document.querySelector('aside[data-test-conversation-details-sidebar="true"]');
  sidebar.style.backgroundColor = 'rgb(28, 30, 34)';
  sidebar.style.color = 'rgb(233, 233, 233)';
  win.ISA_TEMPORARY_NOTES_UI.applyTheme(win.ISA_TEMPORARY_NOTES_UI.getPanel());
  calendar.trigger.click();
  assert.equal(calendar.panel.style.backgroundColor, 'rgb(28, 30, 34)');
  assert.equal(calendar.panel.style.colorScheme, 'dark');
});

test('only one popup is open at a time: a dropdown closes the calendar and the calendar closes a dropdown', () => {
  const { win, panel, calendar } = ready();
  calendar.trigger.click();
  assert.equal(calendar.isOpen(), true);
  assert.ok(openMenu(win, panel.choice));
  assert.equal(calendar.isOpen(), false, 'opening the dropdown closes the calendar');
  calendar.trigger.click();
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null, 'opening the calendar closes the dropdown');
  assert.equal(calendar.isOpen(), true);
});
