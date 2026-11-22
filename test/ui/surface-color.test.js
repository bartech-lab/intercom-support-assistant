'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');
const { loadSidebar, controlsOf } = require('../support/temporary-notes-harness');

const read = name => fs.readFileSync(path.join(__dirname, '..', '..', 'src', name), 'utf8');
const PAGE_URL = 'https://app.intercom.com/a/inbox';

function page(body, extra = []) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, { url: PAGE_URL, runScripts: 'outside-only', pretendToBeVisual: true });
  unrefWindowTimers(dom.window);
  const context = dom.getInternalVMContext();
  ['shared-runtime.js', ...extra].forEach(name => vm.runInContext(read(name), context, { filename: name }));
  return { win: dom.window, run: code => vm.runInContext(code, context) };
}

function surface(outer, inner) {
  const { win, run } = page(`<div id="outer" style="background-color:${outer}"><div id="inner" style="background-color:${inner}"></div></div>`);
  win.start = win.document.getElementById('inner');
  const found = run('isaSurfaceColor(start)');
  return found && { r: found.r, g: found.g, b: found.b, dark: found.dark };
}

test('the surface is the first background at least 90% opaque, walking up from the start node', () => {
  assert.deepEqual(surface('rgb(10, 10, 10)', 'rgb(250, 250, 250)'), { r: 250, g: 250, b: 250, dark: false });
  assert.deepEqual(surface('rgb(10, 10, 10)', 'rgba(0, 0, 0, 0)'), { r: 10, g: 10, b: 10, dark: true });
  assert.deepEqual(surface('rgb(10, 10, 10)', 'rgba(250, 250, 250, 0.89)'), { r: 10, g: 10, b: 10, dark: true });
  assert.deepEqual(surface('rgb(10, 10, 10)', 'rgba(250, 250, 250, 0.9)'), { r: 250, g: 250, b: 250, dark: false });
  assert.deepEqual(surface('rgb(10, 10, 10)', 'rgba(250, 250, 250, 0.05)'), { r: 10, g: 10, b: 10, dark: true },
    'a faint tint never decides the theme');
  assert.equal(surface('rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.5)'), null);
});

test('dark means luminance under one half, weighted towards green', () => {
  assert.equal(surface('rgb(0, 0, 0)', 'rgb(127, 127, 127)').dark, true);
  assert.equal(surface('rgb(0, 0, 0)', 'rgb(128, 128, 128)').dark, false);
  assert.equal(surface('rgb(0, 0, 0)', 'rgb(255, 0, 0)').dark, true);
  assert.equal(surface('rgb(0, 0, 0)', 'rgb(0, 200, 0)').dark, false);
  assert.equal(surface('rgb(255, 255, 255)', 'rgb(0, 0, 255)').dark, true);
});

test('the walk crosses a shadow root to its host', () => {
  const { win, run } = page('<div id="host" style="background-color: rgb(20, 20, 20)"></div>');
  const inner = win.document.createElement('div');
  win.document.getElementById('host').attachShadow({ mode: 'open' }).append(inner);
  win.start = inner;
  assert.equal(run('isaSurfaceColor(start)').dark, true);
  assert.equal(run('isaSurfaceColor(null)'), null);
});

function pageIsLight(body, cornerColor) {
  const { win, run } = page(`<div id="corner" style="background-color:${cornerColor}"></div>`);
  win.document.body.style.backgroundColor = body;
  win.document.elementFromPoint = () => win.document.getElementById('corner');
  return run('pageBackgroundIsLight()');
}

test('the page background follows the same rule from the bottom-left corner', () => {
  assert.equal(pageIsLight('rgb(241, 242, 247)', 'rgba(0, 0, 0, 0)'), true);
  assert.equal(pageIsLight('rgb(20, 22, 28)', 'rgba(0, 0, 0, 0)'), false);
  assert.equal(pageIsLight('rgb(241, 242, 247)', 'rgba(0, 0, 0, 0.5)'), true,
    'a half-transparent overlay in the corner no longer decides; the page behind it does');
  assert.equal(pageIsLight('rgb(0, 0, 0)', 'rgb(130, 130, 130)'), true,
    'a mid grey of 130 is light under the shared rule; the old brightness cut-off of 140 called it dark');
  assert.equal(pageIsLight('rgb(0, 0, 0)', 'rgb(120, 120, 120)'), false);
  assert.equal(pageIsLight('rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'), false, 'with no surface at all the page counts as dark');
});

test('the Intercom note panel treats a background exactly 90% opaque as its surface', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const sidebar = win.document.querySelector('aside[data-test-conversation-details-sidebar="true"]');
  win.document.body.style.backgroundColor = 'rgb(255, 255, 255)';
  sidebar.style.backgroundColor = 'rgba(20, 20, 20, 0.9)';
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.applyTheme(win.ISA_TEMPORARY_NOTES_UI.getPanel()), true);
  assert.equal(panel.choice.style.background, 'rgb(20, 20, 20)');
  assert.equal(panel.date.style.colorScheme, 'dark');
  sidebar.style.backgroundColor = 'rgba(20, 20, 20, 0.89)';
  win.ISA_TEMPORARY_NOTES_UI.applyTheme(win.ISA_TEMPORARY_NOTES_UI.getPanel());
  assert.equal(panel.choice.style.background, 'rgb(255, 255, 255)');
});

test('the Intercom note panel keeps its theme when no surface is found', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const before = panel.choice.style.background;
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.applyTheme(win.ISA_TEMPORARY_NOTES_UI.getPanel()), false);
  assert.equal(panel.choice.style.background, before);
});

test('the Intercom note panel re-themes itself when Intercom switches between dark and light', () => {
  const win = loadSidebar();
  const sidebar = win.document.querySelector('aside[data-test-conversation-details-sidebar="true"]');
  win.document.documentElement.classList.add('dark');
  sidebar.style.backgroundColor = 'rgb(28, 32, 38)';
  sidebar.style.color = 'rgb(233, 233, 233)';
  const panel = controlsOf(win);
  assert.equal(panel.choice.style.background, 'rgb(28, 32, 38)');
  assert.equal(panel.date.style.colorScheme, 'dark');
  win.document.documentElement.classList.remove('dark');
  sidebar.style.backgroundColor = 'rgb(255, 255, 255)';
  sidebar.style.color = 'rgb(20, 20, 20)';
  win.refreshTemporaryNoteControls();
  assert.equal(panel.choice.style.background, 'rgb(255, 255, 255)');
  assert.equal(panel.choice.style.color, 'rgb(20, 20, 20)');
  assert.equal(panel.date.style.colorScheme, 'light');
  assert.equal(panel.date.style.backgroundColor, 'rgb(255, 255, 255)');
});
