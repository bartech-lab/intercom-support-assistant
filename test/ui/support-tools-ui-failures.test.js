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

async function importFile(ui, text) {
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

const backupPayload = settings => JSON.stringify({ schema: 1, exportedAt: '2026-09-14T10:05:00.000Z', settings });

test('H1: ok without a health object is a failure shown in error style, not a table', async () => {
  const { result } = await runCheck({ responder: () => ({ ok: true }) });

  assert.match(result.textContent, /Health check failed: /);
  assert.ok(result.querySelector('.isa-st-note--bad'));
  assert.equal(result.querySelectorAll('.isa-st-lines').length, 0);
  assert.equal(/undefined/.test(result.textContent), false);
});

test('H2: unreachable without an error prints "unreachable: unknown"', async () => {
  const { result } = await runCheck({ responder: () => ({ ok: false, reason: 'unreachable' }) });

  assert.match(result.textContent, /Health check failed: unreachable: unknown/);
});

test('H2: unreachable with an error prints "unreachable: boom"', async () => {
  const { result } = await runCheck({ responder: () => ({ ok: false, reason: 'unreachable', error: 'boom' }) });

  assert.match(result.textContent, /Health check failed: unreachable: boom/);
});

test('H3: runtime.lastError on sendMessage is reported as the failure message', async () => {
  const { result } = await runCheck({ sendLastError: { message: 'gone' } });

  assert.match(result.textContent, /Health check failed: .*gone/);
  assert.equal(result.querySelectorAll('.isa-st-lines').length, 0);
});

test('H4: a missing extension version and chrome version render as "unknown", never "undefined"', async () => {
  const health = healthWith({
    extension: {},
    browser: {}
  });
  const { result } = await runCheck({ responder: () => ({ ok: true, health }) });
  const lines = [...result.querySelectorAll('.isa-st-lines li')].map(row => row.textContent);

  assert.ok(lines.includes('Buildunknown'), lines.join(' | '));
  assert.ok(lines.includes('Chromeunknown'), lines.join(' | '));
  assert.equal(/undefined/.test(result.textContent), false);
});

function notificationCell(result) {
  const row = [...result.querySelectorAll('.isa-st-lines li')].find(item => /^Notifications/.test(item.textContent));
  return row.children[1];
}

test('H5: denied notifications are marked bad', async () => {
  const { result } = await runCheck({
    responder: () => ({ ok: true, health: healthWith({ notificationLevel: 'denied' }) })
  });
  const cell = notificationCell(result);

  assert.equal(cell.textContent, 'denied');
  assert.equal(cell.classList.contains('isa-st-bad'), true);
});

test('H5: a missing notification level is marked bad', async () => {
  const health = healthWith({});
  delete health.notificationLevel;
  const { result } = await runCheck({ responder: () => ({ ok: true, health }) });

  assert.equal(notificationCell(result).classList.contains('isa-st-bad'), true);
  assert.equal(/undefined/.test(result.textContent), false);
});

test('H6: tabsError shows a "Could not list tabs" note in error style', async () => {
  const { result } = await runCheck({
    responder: () => ({ ok: true, health: healthWith({ tabsError: 'nope' }) })
  });
  const notes = [...result.querySelectorAll('.isa-st-note--bad')].map(note => note.textContent);

  assert.deepEqual(notes, ['Could not list tabs: nope']);
});

test('H6: no tabsError shows no error note', async () => {
  const { result } = await runCheck({ responder: () => ({ ok: true, health: healthWith({}) }) });

  assert.equal(result.querySelectorAll('.isa-st-note--bad').length, 0);
});

test('C1: a local storage lastError is recorded and the local items are empty', async () => {
  const ui = await loadUi({ localGetLastError: { message: 'quota' } });
  const support = await ui.api().collectContext();

  assert.equal(support.storage.localError, 'quota');
  assert.equal(JSON.stringify(support.storage.local), "{}");
});

test('C2: a thrown local storage error keeps its real message', async () => {
  const ui = await loadUi({ localGetThrows: new Error('kaput') });
  const support = await ui.api().collectContext();

  assert.equal(support.storage.localError, 'kaput');
  assert.equal(JSON.stringify(support.storage.local), "{}");
});

test('C1/C2: a healthy local storage reports no local error', async () => {
  const ui = await loadUi({ storage: makeStore({ isaAlertSound: 'tritone' }) });
  const support = await ui.api().collectContext();

  assert.equal(support.storage.localError, null);
  assert.equal(support.storage.local.isaAlertSound, 'tritone');
});

test('C3: coverage without alertRoster and promotionalBanners still builds with empty lists', async () => {
  const ui = await loadUi({ signatureData: BASE_SIGNATURE_DATA });
  const coverage = ui.api().buildCoverage();

  assert.equal(coverage.available, true);
  assert.deepEqual(Array.from(coverage.alertRoster), []);
  assert.deepEqual(Array.from(coverage.promotionalBanners), []);
  assert.equal(coverage.companyCount, 1);
});

test('I1: a string-typed key accepts null and rejects a number', async () => {
  const store = makeStore({ isaAlertSound: 'tritone' });
  const ui = await loadUi({ storage: store });
  await importFile(ui, backupPayload({ isaAlertSound: 5, isaAlertEnabled: true }));
  assert.equal(store.data.local.isaAlertSound, 'tritone');
  assert.match(ui.pick('isa-settings-backup', 'result').textContent, /wrong value type: isaAlertSound/);

  await importFile(ui, backupPayload({ isaAlertSound: null }));
  assert.equal(store.data.local.isaAlertSound, null);
  assert.equal(/wrong value type/.test(ui.pick('isa-settings-backup', 'result').textContent), false);
});

test('I2: a strings-array key rejects a non-string element and accepts all strings', async () => {
  const store = makeStore({});
  const ui = await loadUi({ storage: store });
  await importFile(ui, backupPayload({ isaAlertEnabledInboxes: ['a', 1], isaAlertEnabled: true }));
  assert.equal(Object.prototype.hasOwnProperty.call(store.data.local, 'isaAlertEnabledInboxes'), false);
  assert.match(ui.pick('isa-settings-backup', 'result').textContent, /wrong value type: isaAlertEnabledInboxes/);

  await importFile(ui, backupPayload({ isaAlertEnabledInboxes: ['a', 'b'] }));
  assert.deepEqual(Array.from(store.data.local.isaAlertEnabledInboxes), ['a', 'b']);
});

test('I3: a failing import write reports the failure and never reports success', async () => {
  const ui = await loadUi({ localSetLastError: { message: 'denied' } });
  await importFile(ui, backupPayload({ isaAlertEnabled: true }));

  const text = ui.pick('isa-settings-backup', 'result').textContent + ' ' + ui.pick('isa-settings-backup', 'summary').textContent;
  assert.match(text, /denied/);
  assert.equal(/Restored/.test(text), false);
});
