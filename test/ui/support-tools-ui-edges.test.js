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

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

const BASE_SIGNATURE_DATA = { companies: { 'Marlowe Books': {} } };
const ONE_TAB = [{ tabId: 7, title: 'Inbox', url: 'https://app.intercom.com/a/inbox/x', active: true, injected: true }];

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

function makeStore(initial, { onChanged = true } = {}) {
  const local = Object.assign({}, initial);
  const listeners = [];
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
  const store = { local: area(local), session: area({}), data: { local }, listeners };
  if (onChanged) store.onChanged = { addListener: listener => listeners.push(listener) };
  return store;
}

async function loadUi({
  responder = null,
  storage = undefined,
  signatureData = BASE_SIGNATURE_DATA,
  localSetLastError = null,
  fakeTimers = false,
  throwOnLoad = false
} = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>${IDS.map(id => `<div id="${id}" data-isa-expanded="true"></div>`).join('')}</body></html>`,
    { url: 'https://example.test/preview-page.html', runScripts: 'outside-only' }
  );
  const win = unrefWindowTimers(dom.window);
  const store = storage === undefined ? makeStore({}) : storage;
  const runtime = {
    lastError: null,
    getManifest: () => ({ version: '2.0.1', name: 'Intercom Support Assistant' }),
    sendMessage(message, callback) {
      callback(responder ? responder(message) : { ok: true, health: healthWith({}) });
    }
  };
  if (store && store.local && localSetLastError) {
    const realSet = store.local.set;
    store.local.set = (values, callback) => {
      runtime.lastError = localSetLastError;
      if (callback) callback();
      runtime.lastError = null;
      void realSet;
    };
  }
  win.chrome = store === null ? { runtime } : { runtime, storage: store };
  if (signatureData) win.SIGNATURE_DATA = signatureData;

  const saved = [];
  const blobs = new Map();
  const revoked = [];
  const timers = [];
  if (fakeTimers) {
    const realSetTimeout = win.setTimeout;
    win.setTimeout = (fn, ms, ...rest) => {
      if (ms >= 5000) {
        timers.push({ fn, ms });
        return timers.length;
      }
      return realSetTimeout.call(win, fn, ms, ...rest);
    };
  }
  win.URL.createObjectURL = (blob) => {
    const url = `blob:test-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  win.URL.revokeObjectURL = (url) => { revoked.push(url); };
  win.Blob = class Blob {
    constructor(parts, options) {
      this.text = parts.join('');
      this.type = options && options.type;
    }
  };
  win.HTMLAnchorElement.prototype.click = function click() {
    if (this.download) {
      const blob = blobs.get(this.href);
      saved.push({
        filename: this.download,
        content: blob ? blob.text : '',
        type: blob ? blob.type : undefined,
        url: this.href,
        attachedToBody: this.parentNode === win.document.body
      });
    }
  };

  const ctx = dom.getInternalVMContext();
  if (throwOnLoad) {
    assert.doesNotThrow(() => vm.runInContext(SOURCE, ctx, { filename: 'support-tools-ui.js' }));
  } else {
    vm.runInContext(SOURCE, ctx, { filename: 'support-tools-ui.js' });
  }
  await settled();

  const card = id => win.document.getElementById(id);
  return {
    win,
    store,
    saved,
    revoked,
    timers,
    card,
    pick: (id, hook) => card(id).querySelector(`[data-isa="${hook}"]`),
    click: element => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true })),
    api: () => win.ISA_SUPPORT_TOOLS
  };
}

async function chooseFile(ui, text) {
  const input = ui.card('isa-settings-backup').querySelector('[data-isa="file"]');
  const pending = [];
  ui.win.FileReader = class FileReader {
    readAsText() {
      this.result = text;
      pending.push(() => this.onload && this.onload());
    }
  };
  Object.defineProperty(input, 'files', { value: [{ name: 'backup.json' }], configurable: true });
  input.dispatchEvent(new ui.win.Event('change', { bubbles: true }));
  pending.forEach(run => run());
  await settled();
  await settled();
}

const payload = settings => JSON.stringify({ schema: 1, exportedAt: '2026-09-14T10:05:00.000Z', settings });

async function importNotes(settings, options) {
  const ui = await loadUi(options);
  await chooseFile(ui, payload(settings));
  const result = ui.pick('isa-settings-backup', 'result');
  const notes = [...result.querySelectorAll('p.isa-st-note')].map(note => ({
    text: note.textContent,
    bad: note.classList.contains('isa-st-note--bad')
  }));
  return { ui, notes };
}

const noteStarting = (notes, prefix) => notes.find(note => note.text.startsWith(prefix));

async function healthResult(responder) {
  const ui = await loadUi({ responder });
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  return { ui, result: ui.pick('isa-support-tools', 'result') };
}

const lineCell = (result, label) => {
  const row = [...result.querySelectorAll('.isa-st-lines li')].find(item => item.textContent.startsWith(label));
  return row && row.children[1];
};

async function runCapture({ capture, tabs = ONE_TAB, signatureData }) {
  const ui = await loadUi({
    signatureData,
    responder: (message) => {
      if (message.type === 'support-health') return { ok: true, health: healthWith({ tabs }) };
      return typeof capture === 'function' ? capture(message) : capture;
    }
  });
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const row = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  ui.click(row.querySelector('[data-isa-row="download"]'));
  await settled();
  await settled();
  return { ui, row };
}

const okCapture = (extra) => Object.assign({
  ok: true,
  html: '<html><head><title>t</title></head><body>B</body></html>',
  filename: 'cap.html',
  meta: { m: 1 }
}, extra);

const embeddedContext = (html) => {
  const match = html.match(/<script type="application\/json" id="isa-capture-context">([\s\S]*?)<\/script>/);
  assert.ok(match, html);
  return JSON.parse(match[1]);
};

test('import with only unknown keys shows no wrong-type note', async () => {
  const { notes } = await importNotes({ madeUpKey: 1 });

  assert.ok(noteStarting(notes, 'Nothing in that file could be applied.'));
  assert.ok(noteStarting(notes, 'Not a setting this build knows: '));
  assert.equal(noteStarting(notes, 'Wrong value type'), undefined);
});

test('import with only wrong-type keys shows no unknown-key note', async () => {
  const { notes } = await importNotes({ isaAlertEnabled: 'yes' });

  assert.ok(noteStarting(notes, 'Nothing in that file could be applied.'));
  assert.ok(noteStarting(notes, 'Wrong value type: '));
  assert.equal(noteStarting(notes, 'Not a setting this build knows'), undefined);
});

test('partial import: Applied is neutral, Skipped wrong-type is an error, Skipped unknown is neutral', async () => {
  const { notes } = await importNotes({ isaAlertEnabled: true, isaAlertSound: 5, madeUpKey: 1 });

  assert.equal(noteStarting(notes, 'Applied: ').bad, false);
  assert.equal(noteStarting(notes, 'Skipped, wrong value type: ').bad, true);
  assert.equal(noteStarting(notes, 'Skipped, not a setting this build knows: ').bad, false);
});

test('partial import with nothing rejected has no Skipped wrong-type note', async () => {
  const { notes } = await importNotes({ isaAlertEnabled: true, madeUpKey: 1 });

  assert.ok(noteStarting(notes, 'Applied: '));
  assert.ok(noteStarting(notes, 'Skipped, not a setting this build knows: '));
  assert.equal(noteStarting(notes, 'Skipped, wrong value type'), undefined);
});

test('partial import with nothing unknown has no Skipped unknown-key note', async () => {
  const { notes } = await importNotes({ isaAlertEnabled: true, isaAlertSound: 5 });

  assert.ok(noteStarting(notes, 'Applied: '));
  assert.ok(noteStarting(notes, 'Skipped, wrong value type: '));
  assert.equal(noteStarting(notes, 'Skipped, not a setting'), undefined);
});

test('a storage write failure during import is an error note with the message', async () => {
  const { notes } = await importNotes({ isaAlertEnabled: true }, { localSetLastError: { message: 'disk full' } });
  const note = noteStarting(notes, 'Could not write settings: ');

  assert.equal(note.text, 'Could not write settings: disk full');
  assert.equal(note.bad, true);
});

for (const [name, storage] of [['chrome.storage', null], ['chrome.storage.local', {}]]) {
  test(`export without ${name} shows an error note, saves nothing and re-enables the button`, async () => {
    const ui = await loadUi({ storage });
    const button = ui.pick('isa-settings-backup', 'export');
    ui.click(button);
    await settled();
    await settled();
    const note = ui.pick('isa-settings-backup', 'result').querySelector('p.isa-st-note');

    assert.equal(note.textContent, 'Could not read settings: local storage unavailable');
    assert.equal(note.classList.contains('isa-st-note--bad'), true);
    assert.equal(ui.saved.length, 0);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Export settings');
  });
}

test('export saves a JSON blob through a link attached to the body and revokes the URL after 10 seconds', async () => {
  const ui = await loadUi({ fakeTimers: true });
  ui.click(ui.pick('isa-settings-backup', 'export'));
  await settled();
  await settled();

  assert.equal(ui.saved.length, 1);
  assert.equal(ui.saved[0].type, 'application/json');
  assert.equal(ui.saved[0].attachedToBody, true);
  assert.deepEqual(ui.revoked, []);
  const timer = ui.timers.find(entry => entry.ms === 10000);
  assert.ok(timer, JSON.stringify(ui.timers.map(entry => entry.ms)));
  timer.fn();
  assert.deepEqual(ui.revoked, [ui.saved[0].url]);
});

test('health check: a synchronous sendMessage throw becomes "Health check failed: boom"', async () => {
  const { result } = await healthResult(() => { throw new Error('boom'); });
  const note = result.querySelector('p.isa-st-note');

  assert.equal(note.textContent, 'Health check failed: boom');
  assert.equal(note.classList.contains('isa-st-note--bad'), true);
});

test('health check: a null response becomes "Health check failed: no response"', async () => {
  const { result } = await healthResult(() => null);
  const note = result.querySelector('p.isa-st-note');

  assert.equal(note.textContent, 'Health check failed: no response');
  assert.equal(note.classList.contains('isa-st-note--bad'), true);
});

test('health without browser shows Chrome as unknown', async () => {
  const health = healthWith({});
  delete health.browser;
  const { result } = await healthResult(() => ({ ok: true, health }));

  assert.equal(lineCell(result, 'Chrome').textContent, 'unknown');
});

test('health without tabs shows zero supported tabs and a neutral no-tab note', async () => {
  const health = healthWith({});
  delete health.tabs;
  const { result } = await healthResult(() => ({ ok: true, health }));
  const note = [...result.querySelectorAll('p.isa-st-note')].find(item => item.textContent === 'No Intercom tab is open.');

  assert.equal(lineCell(result, 'Supported tabs open').textContent, '0');
  assert.ok(note);
  assert.equal(note.classList.contains('isa-st-note--bad'), false);
});

test('Notifications is ok only for granted', async () => {
  for (const level of ['granted', 'default']) {
    const health = healthWith({ notificationLevel: level });
    const { result } = await healthResult(() => ({ ok: true, health }));
    const cell = lineCell(result, 'Notifications');

    assert.equal(cell.classList.contains('isa-st-ok'), level === 'granted', String(level));
  }
});

test('capture timeout shows "failed: timed out"', async () => {
  const { row, ui } = await runCapture({ capture: { ok: false, reason: 'timeout' } });

  assert.match(row.textContent, /failed: timed out/);
  assert.equal(ui.saved.length, 0);
});

test('capture failure with an unrecognised reason still fails cleanly', async () => {
  await runCapture({ capture: { ok: false, reason: 'unreachable', error: 'x' } });

});

test('capture with a null response fails cleanly, shows "failed: no response"', async () => {
  const { row, ui } = await runCapture({ capture: () => null });

  assert.match(row.textContent, /failed: no response/);
  assert.equal(ui.saved.length, 0);
});

test('capture success saves text/html and keeps the page after the injected context script', async () => {
  const { ui } = await runCapture({ capture: okCapture() });

  assert.equal(ui.saved.length, 1);
  assert.equal(ui.saved[0].type, 'text/html');
  const html = ui.saved[0].content;
  assert.ok(html.includes('<title>t</title></head><body>B</body></html>'), JSON.stringify(html.slice(-120)));
  assert.ok(html.indexOf('id="isa-capture-context"') < html.indexOf('<title>t</title>'));
  assert.match(html, /^<html><head>\s*<script type="application\/json" id="isa-capture-context">/);
  const context = embeddedContext(html);
  assert.deepEqual(context.capture, { filename: 'cap.html', meta: { m: 1 } });
});

async function coverageOf(signatureData) {
  const { ui } = await runCapture({ capture: okCapture(), signatureData });
  return embeddedContext(ui.saved[0].content).coverage;
}

test('coverage companies is the sorted key list', async () => {
  const coverage = await coverageOf({ companies: { zeta: {}, alpha: {}, mid: {} } });

  assert.deepEqual(coverage.companies, ['alpha', 'mid', 'zeta']);
});

test('coverage alertRoster keeps only teamId and label', async () => {
  const coverage = await coverageOf({
    companies: {},
    alertRoster: [{ teamId: '1', label: 'One', secret: 'x', extra: 2 }, { teamId: '2', label: 'Two', other: true }]
  });

  assert.deepEqual(coverage.alertRoster, [{ teamId: '1', label: 'One' }, { teamId: '2', label: 'Two' }]);
});

test('coverage promotionalBanners lists keys, or is empty when absent', async () => {
  const withBanners = await coverageOf({ companies: {}, promotionalBanners: { b2: {}, b1: {} } });
  const without = await coverageOf({ companies: {} });

  assert.deepEqual([...withBanners.promotionalBanners].sort(), ['b1', 'b2']);
  assert.equal(withBanners.promotionalBanners.length, 2);
  assert.deepEqual(without.promotionalBanners, []);
});

test('coverage teamSignatureInboxes copies an array and falls back to empty for a non-array', async () => {
  const inboxes = ['Billing', 'Returns'];
  const copied = await coverageOf({ companies: {}, teamSignatureInboxes: inboxes });
  const fallback = await coverageOf({ companies: {}, teamSignatureInboxes: { name: 'Billing' } });

  assert.deepEqual(copied.teamSignatureInboxes, inboxes);
  assert.deepEqual(fallback.teamSignatureInboxes, []);
});

test('mounting a container twice does not rebuild it and mounted containers carry isa-st-card', async () => {
  const ui = await loadUi();
  const api = ui.api();
  const mounts = Object.keys(api).filter(name => /^mount/.test(name) && typeof api[name] === 'function');

  assert.ok(mounts.length >= 3, mounts.join(','));
  mounts.forEach((name) => {
    const container = ui.win.document.createElement('div');
    ui.win.document.body.appendChild(container);
    api[name](container);
    assert.equal(container.classList.contains('isa-st-card'), true, name);
    const marker = ui.win.document.createElement('i');
    marker.setAttribute('data-test-marker', name);
    container.appendChild(marker);
    api[name](container);
    assert.equal(container.contains(marker), true, name);
  });
});

async function flagsUi(options) {
  const ui = await loadUi(options);
  const box = ui.card('isa-debug-flags').querySelector('input[data-isa-flag="isaDebug"]');
  const emit = (changes, area) => ui.store.listeners.forEach(listener => listener(changes, area));
  return { ui, box, emit };
}

test('debug flag box unchecks for the string "true" and for 1', async () => {
  for (const value of ['true', 1]) {
    const { box, emit } = await flagsUi({ storage: makeStore({ isaDebug: true }) });
    assert.equal(box.checked, true);

    emit({ isaDebug: { newValue: value } }, 'local');

    assert.equal(box.checked, false, String(value));
  }
});

test('debug flag box ignores session changes and unrelated keys', async () => {
  const { box, emit } = await flagsUi();

  emit({ isaDebug: { newValue: true } }, 'session');
  assert.equal(box.checked, false);

  emit({ isaUnrelated: { newValue: true } }, 'local');
  assert.equal(box.checked, false);

  emit({ isaDebug: { newValue: true } }, 'local');
  emit({ isaUnrelated: { newValue: false } }, 'local');
  assert.equal(box.checked, true);
});

test('mounting the debug flags card without chrome.storage.onChanged does not throw', async () => {
  const ui = await loadUi({ storage: makeStore({}, { onChanged: false }), throwOnLoad: true });

  assert.ok(ui.card('isa-debug-flags').querySelector('input[data-isa-flag="isaDebug"]'));
});
