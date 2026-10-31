'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const THEME_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'theme.js'), 'utf8');

function load({ html, stored, systemDark } = {}) {
  const dom = new JSDOM(
    html || '<!doctype html><html><head></head><body></body></html>',
    { url: 'https://example.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const win = dom.window;
  if (stored !== undefined) win.localStorage.setItem('isaTheme', stored);
  if (systemDark !== undefined) {
    win.matchMedia = (query) => ({
      matches: systemDark && /dark/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {}
    });
  }
  const ctx = dom.getInternalVMContext();
  vm.runInContext(THEME_SRC, ctx, { filename: 'theme.js' });
  return win;
}

function theme(win) {
  return win.document.documentElement.getAttribute('data-theme');
}

test('defaults to system (light without a dark preference)', () => {
  const win = load();
  assert.strictEqual(win.ISA_THEME.getPref(), 'system');
  assert.strictEqual(theme(win), 'light');
});

test('system preference follows prefers-color-scheme: dark', () => {
  const win = load({ stored: 'system', systemDark: true });
  assert.strictEqual(win.ISA_THEME.getResolved(), 'dark');
  assert.strictEqual(theme(win), 'dark');
});

test('an explicit stored preference is applied pre-paint', () => {
  const win = load({ stored: 'dark' });
  assert.strictEqual(theme(win), 'dark');
  const light = load({ stored: 'light', systemDark: true });
  assert.strictEqual(theme(light), 'light');
});

test('toggle flips light<->dark and persists', () => {
  const win = load();
  assert.strictEqual(theme(win), 'light');
  win.ISA_THEME.toggle();
  assert.strictEqual(theme(win), 'dark');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), 'dark');
  win.ISA_THEME.toggle();
  assert.strictEqual(theme(win), 'light');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), 'light');
});

test('set commits an explicit preference', () => {
  const win = load();
  win.ISA_THEME.set('dark');
  assert.strictEqual(theme(win), 'dark');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), 'dark');
});

test('a [data-isa-theme-toggle] button wires up and toggles on click', () => {
  const win = load({
    html: '<!doctype html><html><head></head><body>' +
      '<button data-isa-theme-toggle></button></body></html>'
  });
  const button = win.document.querySelector('[data-isa-theme-toggle]');
  assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
  assert.ok(button.querySelector('svg'), 'renders an icon');
  button.click();
  assert.strictEqual(theme(win), 'dark');
  assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
});

test('the toggle button carries a title and aria-label describing the action it performs', () => {
  const win = load({
    html: '<!doctype html><html><head></head><body>' +
      '<button data-isa-theme-toggle></button></body></html>'
  });
  const button = win.document.querySelector('[data-isa-theme-toggle]');
  assert.strictEqual(button.title, 'Switch to dark theme');
  assert.strictEqual(button.getAttribute('aria-label'), 'Switch to dark theme');
  button.click();
  assert.strictEqual(button.title, 'Switch to light theme');
  assert.strictEqual(button.getAttribute('aria-label'), 'Switch to light theme');
});

test('clicking outside the toggle button never flips the theme', () => {
  const win = load({
    html: '<!doctype html><html><head></head><body>' +
      '<button data-isa-theme-toggle></button><p id="elsewhere">text</p></body></html>'
  });
  win.document.getElementById('elsewhere').click();
  assert.strictEqual(theme(win), 'light');
});

test('a toggle button added while the page is still loading gets its icon once DOMContentLoaded fires', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://example.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const win = dom.window;
  Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
  const ctx = dom.getInternalVMContext();
  vm.runInContext(THEME_SRC, ctx, { filename: 'theme.js' });

  const button = win.document.createElement('button');
  button.setAttribute('data-isa-theme-toggle', '');
  win.document.body.appendChild(button);
  assert.strictEqual(button.innerHTML, '', 'no automatic refresh has run yet, since the document is still loading');

  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
  assert.ok(button.querySelector('svg'), 'the deferred refresh renders the icon once the document is ready');
});

test('a storage event only re-applies the theme for the theme key', () => {
  const win = load({ stored: 'light' });
  win.localStorage.setItem('isaTheme', 'dark');
  win.dispatchEvent(new win.StorageEvent('storage', { key: 'someOtherKey' }));
  assert.strictEqual(theme(win), 'light', 'a different storage key must not re-apply the theme');

  win.dispatchEvent(new win.StorageEvent('storage', { key: 'isaTheme' }));
  assert.strictEqual(theme(win), 'dark', 'the theme storage key re-applies the newly stored preference');
});

test('an OS theme change only overrides the resolved theme when the pref is system', () => {
  let onChange;
  let osDark = false;
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://example.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const win = dom.window;
  win.matchMedia = (query) => ({
    get matches() { return osDark && /dark/.test(query); },
    media: query,
    addEventListener(type, cb) { onChange = cb; },
    removeEventListener() {},
    addListener(cb) { onChange = cb; },
    removeListener() {}
  });
  const ctx = dom.getInternalVMContext();
  vm.runInContext(THEME_SRC, ctx, { filename: 'theme.js' });
  assert.strictEqual(theme(win), 'light');

  win.localStorage.setItem('isaTheme', 'light');
  osDark = true;
  onChange();
  assert.strictEqual(theme(win), 'light', 'an explicit light preference is not overridden by the OS going dark');

  win.localStorage.setItem('isaTheme', 'system');
  onChange();
  assert.strictEqual(theme(win), 'dark', 'system mode follows a live OS change');
});
