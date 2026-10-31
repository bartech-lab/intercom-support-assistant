'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'support-tools-ui.js'), 'utf8');
const IDS = ['isa-support-tools', 'isa-settings-backup', 'isa-debug-flags'];
const FLAG_KEYS = ['isaDebug', 'isaAlertDebug', 'isaPauseAutomaticNoteCleanup'];

const SETTINGS = {
  isaAlertEnabled: true,
  isaAlertEnabledInboxes: ['Inbox One', 'Inbox Two'],
  isaAlertSound: 'chime',
  isaAlertYourInbox: true,
  isaAlertDebug: true,
  isaDebug: true,
  isaPauseAutomaticNoteCleanup: true
};

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function makeStore(initial) {
  const local = Object.assign({}, initial);
  return {
    local: {
      get(query, callback) {
        if (query === null || query === undefined) {
          callback(Object.assign({}, local));
          return;
        }
        const keys = Array.isArray(query) ? query : Object.keys(query);
        const picked = {};
        keys.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(local, key)) picked[key] = local[key];
        });
        callback(picked);
      },
      set(values, callback) {
        Object.keys(values).forEach((key) => { local[key] = values[key]; });
        if (callback) callback();
      }
    },
    session: { get(query, callback) { callback({}); }, set(values, callback) { if (callback) callback(); } },
    onChanged: { addListener: () => {} },
    data: { local }
  };
}

function makeDom() {
  const markup = IDS.map(id => `<div id="${id}" data-isa-expanded="true"></div>`).join('');
  return new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: 'https://example.test/preview-page.html',
    runScripts: 'outside-only'
  });
}

function makeChrome(storage) {
  return {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '2.0.1', name: 'Intercom Support Assistant' }),
      sendMessage(message, callback) { callback({ ok: true }); }
    },
    storage
  };
}

function evaluate(dom) {
  vm.runInContext(SOURCE, dom.getInternalVMContext(), { filename: 'support-tools-ui.js' });
}

async function loadUi({ initial = {}, storage = null } = {}) {
  const dom = makeDom();
  const win = unrefWindowTimers(dom.window);
  const store = storage || makeStore(initial);
  win.chrome = makeChrome(store);
  win.SIGNATURE_DATA = { companies: { 'Marlowe Books': {} } };

  const saved = [];
  const blobs = new Map();
  win.URL.createObjectURL = (blob) => {
    const url = `blob:test-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  win.URL.revokeObjectURL = () => {};
  win.Blob = class Blob {
    constructor(parts) {
      this.text = parts.join('');
    }
  };
  win.HTMLAnchorElement.prototype.click = function click() {
    if (this.download) {
      const blob = blobs.get(this.href);
      saved.push({ filename: this.download, content: blob ? blob.text : '' });
    }
  };

  evaluate(dom);
  await settled();

  const card = id => win.document.getElementById(id);
  return {
    dom,
    win,
    store,
    saved,
    card,
    pick: (id, hook) => card(id).querySelector(`[data-isa="${hook}"]`),
    click: element => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true })),
    api: () => win.ISA_SUPPORT_TOOLS
  };
}

async function importText(ui, text) {
  const input = ui.card('isa-settings-backup').querySelector('[data-isa="file"]');
  const listeners = [];
  ui.win.FileReader = class FileReader {
    readAsText() {
      this.result = text;
      listeners.push(() => this.onload && this.onload());
    }
  };
  Object.defineProperty(input, 'files', { value: [{ name: 'backup.json' }], configurable: true });
  input.dispatchEvent(new ui.win.Event('change', { bubbles: true }));
  listeners.forEach(run => run());
  await settled();
  await settled();
}

async function exportPayload(ui) {
  ui.click(ui.pick('isa-settings-backup', 'export'));
  await settled();
  await settled();
  assert.equal(ui.saved.length, 1);
  return ui.saved[0].content;
}

const styles = win => win.document.querySelectorAll('style#isa-support-tools-style');

test('a backup exports all seven user settings with their values', async () => {
  const ui = await loadUi({ initial: SETTINGS });
  const payload = JSON.parse(await exportPayload(ui));

  Object.keys(SETTINGS).forEach((key) => {
    assert.deepEqual(payload.settings[key], SETTINGS[key], `exported settings.${key}`);
  });
});

test('importing an exported backup into empty storage restores all seven user settings', async () => {
  const source = await loadUi({ initial: SETTINGS });
  const text = await exportPayload(source);

  const target = await loadUi({ initial: {} });
  assert.deepEqual(target.store.data.local, {});
  await importText(target, text);

  Object.keys(SETTINGS).forEach((key) => {
    assert.deepEqual(JSON.parse(JSON.stringify(target.store.data.local[key])), SETTINGS[key], `restored ${key}`);
  });
});

test('evaluating the script a second time keeps the API object and adds no card', async () => {
  const ui = await loadUi();
  const first = ui.api();
  const snapshot = IDS.map(id => ui.card(id).innerHTML);
  const childCounts = IDS.map(id => ui.card(id).children.length);

  evaluate(ui.dom);
  await settled();

  assert.equal(ui.api(), first);
  IDS.forEach((id, index) => {
    assert.equal(ui.card(id).children.length, childCounts[index], `${id} child count`);
    assert.equal(ui.card(id).innerHTML, snapshot[index], `${id} markup`);
  });
});

test('mounting injects exactly one non-empty support-tools style element in the head', async () => {
  const ui = await loadUi();
  const found = styles(ui.win);

  assert.equal(found.length, 1);
  assert.equal(found[0].parentNode, ui.win.document.head);
  assert.ok(found[0].textContent.trim().length > 0);
});

test('mounting again, including on a new container, keeps a single style element', async () => {
  const ui = await loadUi();
  const doc = ui.win.document;
  const mounts = Object.keys(ui.api()).filter(name => /^mount/.test(name) && typeof ui.api()[name] === 'function');
  assert.ok(mounts.length > 0);

  evaluate(ui.dom);
  await settled();
  assert.equal(styles(ui.win).length, 1);

  mounts.forEach((name) => {
    const fresh = doc.createElement('div');
    doc.body.appendChild(fresh);
    try { ui.api()[name](fresh); } catch (error) { assert.fail(`${name} threw: ${error.message}`); }
    assert.equal(styles(ui.win).length, 1, `after ${name} on a new container`);
  });
});

test('missing local storage area disables all debug flags and says so', async () => {
  const ui = await loadUi({ storage: { onChanged: { addListener() {} } } });
  const container = ui.card('isa-debug-flags');

  assert.equal(container.querySelector('[data-isa="summary"]').textContent, 'Could not read the flags: local storage unavailable');
  FLAG_KEYS.forEach((key) => {
    const input = container.querySelector(`input[data-isa-flag="${key}"]`);
    assert.ok(input, `${key} checkbox exists`);
    assert.equal(input.disabled, true, `${key} is disabled`);
  });
});
