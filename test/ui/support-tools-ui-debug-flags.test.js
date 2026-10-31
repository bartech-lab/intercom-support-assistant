'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'support-tools-ui.js'), 'utf8');
const KEYS = ['isaDebug', 'isaAlertDebug', 'isaPauseAutomaticNoteCleanup'];
const HINT = 'Logs selector, language, and routing decisions to the page console.';

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function makeChrome(storage) {
  return {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '2.0.16.0', name: 'Intercom Support Assistant' }),
      sendMessage(message, callback) { callback({ ok: true }); }
    },
    storage
  };
}

function makeDom() {
  return new JSDOM(
    '<!doctype html><html><head></head><body><div id="isa-support-tools"></div><div id="isa-settings-backup"></div><div id="isa-debug-flags" data-isa-expanded="true"></div></body></html>',
    { url: 'https://example.test/preview-page.html', runScripts: 'outside-only' }
  );
}

function evaluate(dom, chrome) {
  const win = unrefWindowTimers(dom.window);
  win.chrome = chrome;
  win.SIGNATURE_DATA = { companies: {}, alertRoster: [], promotionalBanners: {} };
  win.eval(SOURCE);
  return win;
}

function controlledStorage(initial, { holdGet = false, holdSet = false } = {}) {
  const data = Object.assign({}, initial);
  const listeners = [];
  const pending = { get: [], set: [] };
  const state = { chrome: null };
  const storage = {
    local: {
      get(query, callback) {
        const keys = Array.isArray(query) ? query : Object.keys(query || data);
        const picked = {};
        keys.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(data, key)) picked[key] = data[key];
        });
        const run = (error) => {
          state.chrome.runtime.lastError = error || null;
          try { callback(error ? undefined : picked); } finally { state.chrome.runtime.lastError = null; }
        };
        if (holdGet) pending.get.push(run);
        else run(null);
      },
      set(values, callback) {
        const run = (error) => {
          if (!error) Object.assign(data, values);
          state.chrome.runtime.lastError = error || null;
          try { if (callback) callback(); } finally { state.chrome.runtime.lastError = null; }
        };
        if (holdSet) pending.set.push(run);
        else run(null);
      }
    },
    onChanged: { addListener: listener => listeners.push(listener) }
  };
  return { storage, data, listeners, pending, state };
}

async function mount(options = {}) {
  const { initial = {}, ...flags } = options;
  const ctl = controlledStorage(initial, flags);
  const dom = makeDom();
  const chrome = makeChrome(ctl.storage);
  ctl.state.chrome = chrome;
  const win = evaluate(dom, chrome);
  await settled();
  const container = win.document.getElementById('isa-debug-flags');
  const box = key => container.querySelector(`input[data-isa-flag="${key}"]`);
  return {
    ctl,
    win,
    container,
    box,
    boxes: () => KEYS.map(box),
    summary: () => container.querySelector('[data-isa="summary"]'),
    toggle(key, checked) {
      const input = box(key);
      input.checked = checked;
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    emit(changes, area) { ctl.listeners.forEach(listener => listener(changes, area)); }
  };
}

test('checkboxes stay disabled until the stored values are read, then take those values', async () => {
  const ui = await mount({ initial: { isaDebug: true, isaAlertDebug: false, isaPauseAutomaticNoteCleanup: true }, holdGet: true });

  assert.equal(ui.boxes().length, 3);
  assert.ok(ui.boxes().every(input => input.disabled), 'all checkboxes are disabled while the read is pending');
  assert.equal(ui.ctl.pending.get.length, 1);

  ui.ctl.pending.get[0](null);
  await settled();

  assert.ok(ui.boxes().every(input => !input.disabled));
  assert.deepEqual(ui.boxes().map(input => input.checked), [true, false, true]);
});

test('flags are listed in order with their labels', async () => {
  const ui = await mount();

  assert.deepEqual(
    ui.boxes().map(input => input.getAttribute('data-isa-flag')),
    KEYS
  );
  assert.match(ui.box('isaDebug').closest('.isa-st-check').textContent, /Verbose logging/);
  assert.match(ui.box('isaAlertDebug').closest('.isa-st-check').textContent, /Alert logging/);
});

test('each flag row shows its hint text', async () => {
  const ui = await mount();
  const row = ui.box('isaDebug').closest('.isa-st-check');

  assert.ok(row.textContent.includes(HINT));
  assert.ok(!ui.box('isaAlertDebug').closest('.isa-st-check').textContent.includes(HINT));
  KEYS.forEach((key) => {
    assert.ok(ui.box(key).closest('.isa-st-check').querySelector('.isa-st-hint').textContent.trim().length > 0, `${key} has a hint`);
  });
});

test('the toggled checkbox is disabled while the write is pending and enabled after it succeeds', async () => {
  const ui = await mount({ holdSet: true });

  ui.toggle('isaDebug', true);
  await settled();

  assert.equal(ui.ctl.pending.set.length, 1);
  assert.equal(ui.box('isaDebug').disabled, true);

  ui.ctl.pending.set[0](null);
  await settled();

  assert.equal(ui.box('isaDebug').disabled, false);
  assert.equal(ui.box('isaDebug').checked, true);
  assert.equal(ui.ctl.data.isaDebug, true);
});

test('a failed write reverts a checkbox that was turned on', async () => {
  const ui = await mount({ initial: { isaAlertDebug: false }, holdSet: true });

  ui.toggle('isaAlertDebug', true);
  await settled();
  ui.ctl.pending.set[0]({ message: 'quota' });
  await settled();

  assert.equal(ui.box('isaAlertDebug').checked, false);
  assert.equal(ui.box('isaAlertDebug').disabled, false);
  assert.equal(ui.summary().textContent, 'Could not save Alert logging: quota');
  assert.equal(ui.ctl.data.isaAlertDebug, false);
});

test('a failed write reverts a checkbox that was turned off', async () => {
  const ui = await mount({ initial: { isaAlertDebug: true }, holdSet: true });
  assert.equal(ui.box('isaAlertDebug').checked, true);

  ui.toggle('isaAlertDebug', false);
  await settled();
  ui.ctl.pending.set[0]({ message: 'quota' });
  await settled();

  assert.equal(ui.box('isaAlertDebug').checked, true);
  assert.equal(ui.box('isaAlertDebug').disabled, false);
  assert.equal(ui.summary().textContent, 'Could not save Alert logging: quota');
});

test('a failed read reports the error and leaves every checkbox disabled', async () => {
  const ctl = controlledStorage({ isaDebug: true });
  const dom = makeDom();
  const chrome = makeChrome(ctl.storage);
  ctl.state.chrome = chrome;
  ctl.storage.local.get = (query, callback) => {
    chrome.runtime.lastError = { message: 'read boom' };
    try { callback(undefined); } finally { chrome.runtime.lastError = null; }
  };
  const win = evaluate(dom, chrome);
  await settled();
  const container = win.document.getElementById('isa-debug-flags');
  const inputs = container.querySelectorAll('input[data-isa-flag]');

  assert.equal(inputs.length, 3);
  assert.equal(container.querySelector('[data-isa="summary"]').textContent, 'Could not read the flags: read boom');
  assert.ok([...inputs].every(input => input.disabled));
});

test('a sync-area storage change does not touch the checkbox, a local-area change does', async () => {
  const ui = await mount();

  ui.emit({ isaDebug: { newValue: true } }, 'sync');
  assert.equal(ui.box('isaDebug').checked, false);

  ui.emit({ isaDebug: { newValue: true } }, 'local');
  assert.equal(ui.box('isaDebug').checked, true);
});

test('a local change carrying only one flag updates that checkbox and leaves the others', async () => {
  const ui = await mount({ initial: { isaDebug: false } });

  ui.emit({ isaAlertDebug: { newValue: true } }, 'local');

  assert.equal(ui.box('isaAlertDebug').checked, true);
  assert.equal(ui.box('isaDebug').checked, false);
  assert.equal(ui.box('isaPauseAutomaticNoteCleanup').checked, false);
});

test('a document that is already complete mounts the cards without any event', async () => {
  const ctl = controlledStorage({});
  const dom = makeDom();
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', resolve);
  });
  assert.equal(dom.window.document.readyState, 'complete');
  const chrome = makeChrome(ctl.storage);
  ctl.state.chrome = chrome;

  const win = evaluate(dom, chrome);

  const container = win.document.getElementById('isa-debug-flags');
  assert.equal(container.querySelectorAll('input[data-isa-flag]').length, 3);
  assert.ok(win.document.getElementById('isa-support-tools').children.length > 0);
  assert.ok(win.document.getElementById('isa-settings-backup').children.length > 0);
});

test('a document that is still loading mounts the cards after DOMContentLoaded', async () => {
  const ctl = controlledStorage({});
  const dom = makeDom();
  assert.equal(dom.window.document.readyState, 'loading');
  const chrome = makeChrome(ctl.storage);
  ctl.state.chrome = chrome;

  const win = evaluate(dom, chrome);
  const container = win.document.getElementById('isa-debug-flags');
  assert.equal(container.querySelectorAll('input[data-isa-flag]').length, 0);

  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));

  assert.equal(container.querySelectorAll('input[data-isa-flag]').length, 3);
});
