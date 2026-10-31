'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const ROOT = path.join(__dirname, '..', '..', 'src');
const SOURCE = fs.readFileSync(path.join(ROOT, 'support-tools-ui.js'), 'utf8');

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

const BASE_SIGNATURE_DATA = {
  companies: { 'Marlowe Books': {} }
};

function healthWith(overrides) {
  return Object.assign({
    checkedAt: '2026-09-14T10:05:00.000Z',
    extension: { name: 'Intercom Support Assistant', version: '2.0.1' },
    browser: { chromeVersion: '141.0.0.0', userAgent: 'test' },
    notificationLevel: 'granted',
    tabsError: null,
    tabs: []
  }, overrides);
}

function makeStore(initial) {
  const local = Object.assign({}, initial);
  const session = {};
  const area = data => ({
    get(query, callback) {
      if (query === null || query === undefined) {
        callback(Object.assign({}, data));
        return;
      }
      const keys = Array.isArray(query) ? query : Object.keys(query);
      const picked = {};
      keys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) picked[key] = data[key];
      });
      callback(picked);
    },
    set(values, callback) {
      Object.keys(values).forEach((key) => { data[key] = values[key]; });
      if (callback) callback();
    }
  });
  return {
    local: area(local),
    session: area(session),
    onChanged: { addListener: () => {} },
    data: { local, session }
  };
}

async function loadUi({
  responder = null,
  storage = null,
  signatureData = BASE_SIGNATURE_DATA,
  sendLastError = null,
  localGetLastError = null,
  localGetThrows = null,
  localSetLastError = null
} = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="isa-support-tools" data-isa-expanded="true"></div><div id="isa-settings-backup" data-isa-expanded="true"></div><div id="isa-debug-flags" data-isa-expanded="true"></div></body></html>',
    { url: 'https://example.test/preview-page.html', runScripts: 'outside-only' }
  );
  const win = unrefWindowTimers(dom.window);
  const store = storage || makeStore({});
  const runtime = {
    lastError: null,
    getManifest: () => ({ version: '2.0.1', name: 'Intercom Support Assistant' }),
    sendMessage(message, callback) {
      const reply = responder ? responder(message) : { ok: true, health: healthWith({}) };
      if (sendLastError) {
        runtime.lastError = sendLastError;
        callback(undefined);
        runtime.lastError = null;
        return;
      }
      callback(reply);
    }
  };

  const realLocalGet = store.local.get;
  const realLocalSet = store.local.set;
  if (localGetThrows) {
    store.local.get = () => { throw localGetThrows; };
  } else if (localGetLastError) {
    store.local.get = (query, callback) => {
      runtime.lastError = localGetLastError;
      callback(undefined);
      runtime.lastError = null;
    };
  } else {
    store.local.get = realLocalGet;
  }
  if (localSetLastError) {
    store.local.set = (values, callback) => {
      runtime.lastError = localSetLastError;
      if (callback) callback();
      runtime.lastError = null;
    };
  } else {
    store.local.set = realLocalSet;
  }

  win.chrome = { runtime, storage: store };
  if (signatureData) win.SIGNATURE_DATA = signatureData;

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

  const ctx = dom.getInternalVMContext();
  vm.runInContext(SOURCE, ctx, { filename: 'support-tools-ui.js' });
  await settled();

  const card = id => win.document.getElementById(id);
  return {
    win,
    store,
    saved,
    card,
    pick: (id, hook) => card(id).querySelector(`[data-isa="${hook}"]`),
    click: element => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true })),
    api: () => win.ISA_SUPPORT_TOOLS
  };
}

async function runCheck(options) {
  const ui = await loadUi(options);
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  return { ui, result: ui.pick('isa-support-tools', 'result') };
}

const SCHEMA = 1;

async function chooseFile(ui, text, { fail = false, files = null } = {}) {
  const input = ui.card('isa-settings-backup').querySelector('[data-isa="file"]');
  const pending = [];
  ui.win.FileReader = class FileReader {
    readAsText() {
      this.result = text;
      pending.push(() => {
        if (fail) {
          if (this.onerror) this.onerror();
        } else if (this.onload) {
          this.onload();
        }
      });
    }
  };
  Object.defineProperty(input, 'files', { value: files || [{ name: 'backup.json' }], configurable: true });
  input.dispatchEvent(new ui.win.Event('change', { bubbles: true }));
  pending.forEach(run => run());
  await settled();
  await settled();
}

function spyOnSet(store) {
  const writes = [];
  const real = store.local.set;
  store.local.set = (values, callback) => {
    writes.push(values);
    real(values, callback);
  };
  return writes;
}

async function importAndRead(text, options) {
  const store = makeStore({});
  const writes = spyOnSet(store);
  const ui = await loadUi({ storage: store });
  const countBefore = writes.length;
  await chooseFile(ui, text, options);
  const result = ui.pick('isa-settings-backup', 'result');
  return { ui, store, writes: writes.slice(countBefore), result, summary: ui.pick('isa-settings-backup', 'summary') };
}

const badNotes = result => [...result.querySelectorAll('.isa-st-note--bad')].map(note => note.textContent);
const allNotes = result => [...result.querySelectorAll('.isa-st-note')].map(note => note.textContent);

test('I1: JSON null is rejected as not an Intercom Support Assistant settings export, in error style, without a write', async () => {
  const { result, writes } = await importAndRead('null');

  assert.deepEqual(badNotes(result), ['That file is not an Intercom Support Assistant settings export.']);
  assert.equal(writes.length, 0);
});

test('I3: a string schema "1" is rejected as not an Intercom Support Assistant settings export, without a write', async () => {
  const { result, writes } = await importAndRead(JSON.stringify({ schema: '1', settings: { isaAlertEnabled: true } }));

  assert.deepEqual(badNotes(result), ['That file is not an Intercom Support Assistant settings export.']);
  assert.equal(writes.length, 0);
});

test('I4: a numeric schema without settings reports that the file carries no settings', async () => {
  const { result, writes } = await importAndRead(JSON.stringify({ schema: SCHEMA }));

  assert.deepEqual(badNotes(result), ['That file carries no settings.']);
  assert.equal(writes.length, 0);
});

test('I4: settings that is a string reports that the file carries no settings', async () => {
  const { result, writes } = await importAndRead(JSON.stringify({ schema: SCHEMA, settings: 'x' }));

  assert.deepEqual(badNotes(result), ['That file carries no settings.']);
  assert.equal(writes.length, 0);
});

test('I5: only a wrong-typed known key and an unknown key explains both and writes nothing', async () => {
  const { result, writes, store } = await importAndRead(JSON.stringify({
    schema: SCHEMA,
    settings: { isaAlertEnabled: 'yes', madeUpKey: 1 }
  }));

  assert.deepEqual(badNotes(result).sort(), ['Nothing in that file could be applied.', 'Wrong value type: isaAlertEnabled.'].sort());
  const plain = allNotes(result).filter(text => !badNotes(result).includes(text));
  assert.deepEqual(plain, ['Not a setting this build knows: madeUpKey.']);
  assert.equal(writes.length, 0);
  assert.equal(store.data.local.isaAlertEnabled, undefined);
});

test('I6: a successful import without exportedAt summarises without printing undefined', async () => {
  const { summary, writes } = await importAndRead(JSON.stringify({ schema: SCHEMA, settings: { isaAlertEnabled: true } }));

  assert.equal(writes.length > 0, true);
  assert.equal(summary.textContent, 'Restored 1 settings from an export. Reload open Intercom tabs.');
  assert.equal(/undefined/.test(summary.textContent), false);
});

test('I6: a successful import with exportedAt names that value in the summary', async () => {
  const { summary } = await importAndRead(JSON.stringify({
    schema: SCHEMA,
    exportedAt: '2026-01-02T03:04:05Z',
    settings: { isaAlertEnabled: true, isaDebug: true }
  }));

  assert.match(summary.textContent, /^Restored 2 settings from /);
  assert.ok(summary.textContent.includes('2026-01-02T03:04:05Z'), summary.textContent);
  assert.match(summary.textContent, /Reload open Intercom tabs\.$/);
});

test('I7: a FileReader error shows "Could not read that file." in error style and writes nothing', async () => {
  const { result, writes } = await importAndRead('{}', { fail: true });

  assert.deepEqual(badNotes(result), ['Could not read that file.']);
  assert.equal(writes.length, 0);
});

test('I8: choosing no file does nothing: no note and no write', async () => {
  const store = makeStore({});
  const writes = spyOnSet(store);
  const ui = await loadUi({ storage: store });
  const result = ui.pick('isa-settings-backup', 'result');
  const summary = ui.pick('isa-settings-backup', 'summary');
  const resultBefore = result.innerHTML;
  const summaryBefore = summary.innerHTML;
  await chooseFile(ui, '{}', { files: [] });

  assert.equal(result.innerHTML, resultBefore);
  assert.equal(summary.innerHTML, summaryBefore);
  assert.equal(result.querySelectorAll('.isa-st-note').length, 0);
  assert.equal(writes.length, 0);
});

const TWO_TABS = [
  { tabId: 7, title: 'Inbox', url: 'https://app.intercom.com/a/inbox/x', active: true, injected: true },
  { tabId: 9, active: false, injected: true }
];

test('R1: an ok capture with empty html is a failure in bad style and saves nothing', async () => {
  const ui = await loadUi({
    responder: (message) => {
      if (message.type === 'support-health') return { ok: true, health: healthWith({ tabs: TWO_TABS }) };
      return { ok: true, html: '', filename: 'x.html' };
    }
  });
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const row = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  ui.click(row.querySelector('[data-isa-row="download"]'));
  await settled();
  await settled();

  assert.match(row.textContent, /failed: /);
  assert.ok(row.querySelector('.isa-st-rowstatus--bad'), row.innerHTML);
  assert.equal(/saved/.test(row.textContent), false);
  assert.equal(ui.saved.length, 0);
});

test('R2: a tab without title and url is labelled "tab · (no url)"', async () => {
  const { result } = await runCheck({
    responder: () => ({ ok: true, health: healthWith({ tabs: TWO_TABS }) })
  });
  const rows = [...result.querySelectorAll('.isa-st-row')];

  assert.equal(rows.length, 2);
  assert.ok(rows[1].textContent.includes('tab · (no url)'), rows[1].textContent);
  assert.equal(/undefined/.test(rows[1].textContent), false);
});

test('I9: invalid JSON and a newer schema are both shown in error style', async () => {
  const invalid = await importAndRead('{not json');
  const newer = await importAndRead(JSON.stringify({ schema: SCHEMA + 1, settings: { isaAlertEnabled: true } }));

  assert.deepEqual(badNotes(invalid.result), ['That file is not valid JSON.']);
  assert.equal(badNotes(newer.result).length, 1);
  assert.match(badNotes(newer.result)[0], /Update the extension first\.$/);
  assert.equal(newer.writes.length, 0);
});

test('I10: a valid import with no local storage area reports a failure and no success', async () => {
  const store = makeStore({});
  const ui = await loadUi({ storage: store });
  delete store.local;
  await chooseFile(ui, JSON.stringify({ schema: SCHEMA, settings: { isaAlertEnabled: true } }));
  const result = ui.pick('isa-settings-backup', 'result');

  assert.ok(badNotes(result).length > 0, result.innerHTML);
  assert.equal(allNotes(result).length, badNotes(result).length, result.innerHTML);
});

test('R3: the check button stays disabled until the health reply arrives, then re-enables', async () => {
  const ui = await loadUi();
  let reply;
  ui.win.chrome.runtime.sendMessage = (message, callback) => { reply = callback; };
  const check = ui.pick('isa-support-tools', 'check');
  ui.click(check);
  await settled();

  assert.equal(check.disabled, true);
  reply({ ok: true, health: healthWith({}) });
  await settled();
  await settled();
  assert.equal(check.disabled, false);
});

test('R4: a tab save button stays disabled while its capture is pending', async () => {
  const ui = await loadUi({
    responder: () => ({ ok: true, health: healthWith({ tabs: TWO_TABS }) })
  });
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  let reply;
  ui.win.chrome.runtime.sendMessage = (message, callback) => { reply = callback; };
  const row = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  const button = row.querySelector('[data-isa-row="download"]');
  ui.click(button);
  await settled();

  assert.equal(button.disabled, true);
  assert.equal(typeof reply, 'function');
});
