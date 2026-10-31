'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const THEME_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'theme.js'), 'utf8');
const TOGGLE_HTML = '<!doctype html><html><head></head><body><button data-isa-theme-toggle></button></body></html>';

function makeDom(html, virtualConsole) {
  return new JSDOM(html || '<!doctype html><html><head></head><body></body></html>', {
    url: 'https://example.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole
  });
}

function run(dom) {
  vm.runInContext(THEME_SRC, dom.getInternalVMContext(), { filename: 'theme.js' });
}

function theme(win) {
  return win.document.documentElement.getAttribute('data-theme');
}

function mediaFake(state, mode) {
  return (query) => {
    const mql = {
      get matches() { return state.dark && /dark/.test(query); },
      media: query
    };
    if (mode === 'legacy') {
      mql.addListener = (cb) => { state.cb = cb; };
      mql.removeListener = () => {};
    } else {
      mql.addEventListener = (type, cb) => { if (type === 'change') state.cb = cb; };
      mql.removeEventListener = () => {};
    }
    return mql;
  };
}

test('T1 loading twice keeps the first instance and one click toggles exactly once', () => {
  const dom = makeDom(TOGGLE_HTML);
  const win = dom.window;
  run(dom);
  const first = win.ISA_THEME;
  run(dom);
  assert.strictEqual(win.ISA_THEME, first);
  assert.strictEqual(theme(win), 'light');
  win.document.querySelector('[data-isa-theme-toggle]').click();
  assert.strictEqual(theme(win), 'dark');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), 'dark');
});

test('T2 set(light) stores and applies light even when the system prefers dark', () => {
  const dom = makeDom();
  const win = dom.window;
  win.matchMedia = mediaFake({ dark: true });
  run(dom);
  assert.strictEqual(theme(win), 'dark');
  win.ISA_THEME.set('light');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), 'light');
  assert.strictEqual(theme(win), 'light');
  assert.strictEqual(win.ISA_THEME.getPref(), 'light');
  assert.strictEqual(win.ISA_THEME.getResolved(), 'light');
});

test('T2b set with an invalid value stores system', () => {
  const dom = makeDom();
  const win = dom.window;
  run(dom);
  win.ISA_THEME.set('dark');
  win.ISA_THEME.set('purple');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), 'system');
  assert.strictEqual(win.ISA_THEME.getPref(), 'system');
});

test('T3 system resolves to light when matchMedia is missing', () => {
  const dom = makeDom();
  const win = dom.window;
  assert.strictEqual(win.matchMedia, undefined);
  run(dom);
  assert.strictEqual(win.ISA_THEME.getResolved(), 'light');
  assert.strictEqual(theme(win), 'light');
});

test('T3 system resolves to light when matchMedia throws', () => {
  const dom = makeDom();
  const win = dom.window;
  win.matchMedia = () => { throw new Error('boom'); };
  run(dom);
  assert.strictEqual(win.ISA_THEME.getPref(), 'system');
  assert.strictEqual(win.ISA_THEME.getResolved(), 'light');
  assert.strictEqual(theme(win), 'light');
});

test('T4 a throwing localStorage.getItem yields system and follows the media query', () => {
  const dom = makeDom();
  const win = dom.window;
  win.localStorage.setItem('isaTheme', 'light');
  win.Storage.prototype.getItem = () => { throw new Error('denied'); };
  win.matchMedia = mediaFake({ dark: true });
  run(dom);
  assert.strictEqual(win.ISA_THEME.getPref(), 'system');
  assert.strictEqual(theme(win), 'dark');
});

test('T4 a throwing localStorage.setItem does not stop set from applying the theme', () => {
  const dom = makeDom();
  const win = dom.window;
  win.Storage.prototype.setItem = () => { throw new Error('quota'); };
  run(dom);
  assert.strictEqual(theme(win), 'light');
  assert.doesNotThrow(() => win.ISA_THEME.set('dark'));
  assert.strictEqual(theme(win), 'dark');
});

test('T5 a click on a text node or the document does not toggle or throw', () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  const dom = makeDom('<!doctype html><html><head></head><body><p id="p">hello</p><button data-isa-theme-toggle></button></body></html>', vc);
  const win = dom.window;
  win.addEventListener('error', (e) => errors.push(e.error || e));
  run(dom);
  const text = win.document.getElementById('p').firstChild;
  assert.strictEqual(text.nodeType, 3);
  assert.strictEqual(typeof text.closest, 'undefined');
  assert.doesNotThrow(() => text.dispatchEvent(new win.MouseEvent('click', { bubbles: true })));
  assert.doesNotThrow(() => win.document.dispatchEvent(new win.MouseEvent('click', { bubbles: true })));
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(theme(win), 'light');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), null);
});

test('T5 a click on an svg child of the toggle toggles', () => {
  const dom = makeDom(TOGGLE_HTML);
  const win = dom.window;
  run(dom);
  const button = win.document.querySelector('[data-isa-theme-toggle]');
  const svg = button.querySelector('svg');
  assert.ok(svg);
  svg.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(theme(win), 'dark');
  assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
  const inner = button.querySelector('svg *') || button.querySelector('svg');
  inner.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(theme(win), 'light');
  assert.strictEqual(win.localStorage.getItem('isaTheme'), 'light');
});

test('T6 while loading, a late toggle is updated only after DOMContentLoaded', () => {
  const dom = makeDom();
  const win = dom.window;
  Object.defineProperty(win.document, 'readyState', { value: 'loading', configurable: true });
  win.localStorage.setItem('isaTheme', 'dark');
  run(dom);
  const button = win.document.createElement('button');
  button.setAttribute('data-isa-theme-toggle', '');
  win.document.body.appendChild(button);
  assert.strictEqual(button.getAttribute('aria-pressed'), null);
  assert.strictEqual(button.getAttribute('aria-label'), null);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
  assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(button.title, 'Switch to light theme');
  assert.strictEqual(button.getAttribute('aria-label'), 'Switch to light theme');
  assert.ok(button.querySelector('svg'));
});

test('T6 with readyState complete, a toggle present at load is updated immediately', () => {
  const dom = makeDom(TOGGLE_HTML);
  const win = dom.window;
  win.localStorage.setItem('isaTheme', 'dark');
  Object.defineProperty(win.document, 'readyState', { value: 'complete', configurable: true });
  run(dom);
  const button = win.document.querySelector('[data-isa-theme-toggle]');
  assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(button.title, 'Switch to light theme');
  assert.ok(button.querySelector('svg'));
});

test('T7 a media change re-resolves with pref system and is ignored with pref light', () => {
  const state = { dark: false };
  const dom = makeDom();
  const win = dom.window;
  win.matchMedia = mediaFake(state);
  run(dom);
  assert.strictEqual(theme(win), 'light');
  assert.strictEqual(typeof state.cb, 'function');
  state.dark = true;
  state.cb({ matches: true });
  assert.strictEqual(theme(win), 'dark');

  win.ISA_THEME.set('light');
  state.dark = false;
  state.dark = true;
  state.cb({ matches: true });
  assert.strictEqual(theme(win), 'light');
});

test('T7 a media change with pref dark does not move to light', () => {
  const state = { dark: true };
  const dom = makeDom();
  const win = dom.window;
  win.localStorage.setItem('isaTheme', 'dark');
  win.matchMedia = mediaFake(state);
  run(dom);
  state.dark = false;
  state.cb({ matches: false });
  assert.strictEqual(theme(win), 'dark');
});

test('T7 legacy addListener-only media query still reacts to changes', () => {
  const state = { dark: false };
  const dom = makeDom();
  const win = dom.window;
  win.matchMedia = mediaFake(state, 'legacy');
  run(dom);
  assert.strictEqual(typeof state.cb, 'function');
  assert.strictEqual(theme(win), 'light');
  state.dark = true;
  state.cb({ matches: true });
  assert.strictEqual(theme(win), 'dark');
});

test('T8 a storage event re-applies only for the isaTheme key', () => {
  const dom = makeDom(TOGGLE_HTML);
  const win = dom.window;
  win.localStorage.setItem('isaTheme', 'light');
  run(dom);
  assert.strictEqual(theme(win), 'light');
  win.localStorage.setItem('isaTheme', 'dark');
  win.dispatchEvent(new win.StorageEvent('storage', { key: 'other' }));
  assert.strictEqual(theme(win), 'light');
  win.dispatchEvent(new win.StorageEvent('storage', { key: 'isaTheme' }));
  assert.strictEqual(theme(win), 'dark');
  assert.strictEqual(win.document.querySelector('[data-isa-theme-toggle]').getAttribute('aria-pressed'), 'true');
});
