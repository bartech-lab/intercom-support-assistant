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

const HEALTH = {
  checkedAt: '2026-09-14T10:05:00.000Z',
  extension: { name: 'Intercom Support Assistant', version: '2.0.16.0' },
  browser: { chromeVersion: '141.0.0.0', userAgent: 'test' },
  notificationLevel: 'granted',
  tabsError: null,
  tabs: [
    { tabId: 7, title: 'Inbox', url: 'https://app.intercom.com/a/inbox/x', active: true, injected: true },
    { tabId: 9, title: 'Inbox 2', url: 'https://app.intercom.com/a/inbox/demo1234/inbox/shared', active: false, injected: false, notInjected: true }
  ]
};

const SIGNATURE_DATA = {
  companies: { 'Marlowe Books': {}, 'Orchard Kitchen': {} },
  teamSignatureInboxes: ['Billing', 'Returns'],
  alertRoster: [{ teamId: '900102', label: 'Urgent Marlowe Books' }],
  promotionalBanners: { Brightwell: {} }
};

function captureResponder() {
  return (message) => {
    if (message.type === 'support-health') return { ok: true, health: HEALTH };
    return {
      ok: true,
      filename: 'intercom-20260914T100500-123.html',
      meta: { surface: 'intercom', conversationId: '123', view: 'conversation' },
      html: '<!doctype html>\n<html><head><title>t</title></head><body></body></html>'
    };
  };
}

function makeStore(initial) {
  const local = Object.assign({}, initial);
  const session = { isaNoteLeases: {} };
  const listeners = [];

  const area = (data, name) => ({
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
      const changes = {};
      Object.keys(values).forEach((key) => {
        changes[key] = { oldValue: data[key], newValue: values[key] };
        data[key] = values[key];
      });
      listeners.forEach(listener => listener(changes, name));
      if (callback) callback();
    }
  });

  return {
    local: area(local, 'local'),
    session: area(session, 'session'),
    onChanged: { addListener: listener => listeners.push(listener) },
    data: { local, session }
  };
}

async function loadUi({
  containers = ['isa-support-tools', 'isa-settings-backup', 'isa-debug-flags'],
  expanded = true,
  responder = null,
  storage = null,
  signatureData = SIGNATURE_DATA
} = {}) {
  const markup = containers
    .map(id => `<div id="${id}" data-isa-expanded="${expanded ? 'true' : 'false'}"></div>`)
    .join('');
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: 'https://example.test/preview-page.html',
    runScripts: 'outside-only'
  });
  const win = unrefWindowTimers(dom.window);
  const sent = [];
  const store = storage || makeStore({});

  win.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '2.0.16.0', name: 'Intercom Support Assistant' }),
      sendMessage(message, callback) {
        sent.push(message);
        const reply = responder ? responder(message) : { ok: true, health: HEALTH };
        callback(reply);
      }
    },
    storage: store
  };

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
    sent,
    saved,
    store,
    card,
    pick: (id, hook) => card(id).querySelector(`[data-isa="${hook}"]`),
    click: element => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true })),
    api: () => win.ISA_SUPPORT_TOOLS
  };
}

test('the three cards mount and send nothing on load', async () => {
  const ui = await loadUi();

  assert.equal(ui.sent.length, 0, 'no automatic check may run');
  assert.equal(ui.card('isa-support-tools').querySelector('.isa-st-title').textContent, 'Captures');
  assert.match(ui.pick('isa-support-tools', 'summary').textContent, /Nothing is uploaded\./);
  assert.match(ui.pick('isa-settings-backup', 'summary').textContent, /Import merges that file/);
  assert.equal(ui.card('isa-debug-flags').querySelectorAll('.isa-st-check').length, 3);
  assert.match(ui.card('isa-debug-flags').querySelector('.isa-st-hint').textContent, /Logs selector, language, and routing decisions/);
});

test('a collapsed card keeps its body hidden', async () => {
  const ui = await loadUi({ expanded: false });

  assert.equal(ui.pick('isa-support-tools', 'body').hasAttribute('hidden'), true);
  assert.equal(ui.card('isa-support-tools').querySelector('[data-isa="toggle"]').getAttribute('aria-expanded'), 'false');
});

test('the health check lists tabs and marks a tab that needs a reload', async () => {
  const ui = await loadUi();
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();

  const result = ui.pick('isa-support-tools', 'result');
  const lines = [...result.querySelectorAll('.isa-st-lines li')].map(row => row.textContent);
  assert.equal(ui.sent[0].type, 'support-health');
  assert.ok(lines.some(line => line.includes('2.0.16.0')));
  assert.ok(lines.some(line => line.includes('granted')));

  const rows = [...result.querySelectorAll('.isa-st-row')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /extension loaded/);
  assert.match(rows[1].textContent, /not loaded: reload this tab/);
});

test('a failed health check reports the reason and leaves the button usable', async () => {
  const ui = await loadUi({ responder: () => ({ ok: false, reason: 'health-failed', error: 'boom' }) });
  const check = ui.pick('isa-support-tools', 'check');
  ui.click(check);
  await settled();

  assert.equal(check.disabled, false);
  assert.match(ui.pick('isa-support-tools', 'result').textContent, /Health check failed: boom/);
});

test('downloading a tab saves one file that carries both metadata blocks', async () => {
  const captured = [];
  const ui = await loadUi({
    responder: (message) => {
      if (message.type === 'support-health') return { ok: true, health: HEALTH };
      captured.push(message);
      return {
        ok: true,
        filename: 'intercom-20260914T100500-123.html',
        meta: { surface: 'intercom', conversationId: '123', view: 'conversation' },
        html: '<!doctype html>\n<html><head><script type="application/json" id="isa-capture-meta">\n{"surface":"intercom"}\n</script><title>t</title></head><body></body></html>'
      };
    }
  });

  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const row = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  ui.click(row.querySelector('[data-isa-row="download"]'));
  await settled();
  await settled();

  assert.equal(captured[0].type, 'dom-capture');
  assert.equal(captured[0].tabId, 7);
  assert.equal(ui.saved.length, 1);
  assert.equal(ui.saved[0].filename, 'intercom-20260914T100500-123.html');
  assert.match(row.textContent, /saved intercom-20260914T100500-123\.html/);
  const content = ui.saved[0].content;
  assert.equal(content.split('id="isa-capture-meta"').length, 2);
  assert.equal(content.split('id="isa-capture-context"').length, 2);
  assert.ok(content.indexOf('id="isa-capture-context"') > content.indexOf('<head>'));
  assert.ok(content.indexOf('id="isa-capture-context"') < content.indexOf('id="isa-capture-meta"'));
  assert.ok(content.includes('<title>t</title>'));
});

test('each tab row offers exactly one download', async () => {
  const ui = await loadUi();
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();

  const rows = [...ui.pick('isa-support-tools', 'result').querySelectorAll('.isa-st-row')];
  assert.equal(rows.length, 2);
  rows.forEach((row) => {
    assert.deepEqual(
      Array.from(row.querySelectorAll('button')).map(button => button.textContent),
      ['Download']
    );
  });
});

test('listing tabs again clears a stale row status', async () => {
  const ui = await loadUi({ responder: captureResponder() });

  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const first = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  ui.click(first.querySelector('[data-isa-row="download"]'));
  await settled();
  await settled();
  assert.match(first.textContent, /saved intercom-20260914T100500-123\.html/);

  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const again = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  assert.equal(/saved/.test(again.textContent), false);
});

test('a failed capture reports the reason, saves nothing, and keeps the row usable', async () => {
  const ui = await loadUi({
    responder: (message) => {
      if (message.type === 'support-health') return { ok: true, health: HEALTH };
      return { ok: false, reason: 'timeout' };
    }
  });

  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const row = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  const download = row.querySelector('[data-isa-row="download"]');
  ui.click(download);
  await settled();
  await settled();

  assert.equal(ui.saved.length, 0);
  assert.match(row.textContent, /failed: timed out/);
  assert.equal(download.disabled, false);
  assert.equal(download.textContent, 'Download');
});

test('a stale tab reports the reload hint rather than a raw connection error', async () => {
  const ui = await loadUi({
    responder: (message) => {
      if (message.type === 'support-health') return { ok: true, health: HEALTH };
      return { ok: false, reason: 'unreachable', error: 'x', notInjected: true };
    }
  });

  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const row = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  ui.click(row.querySelector('[data-isa-row="download"]'));
  await settled();
  await settled();

  assert.match(row.textContent, /failed: extension not loaded in that tab, reload it/);
});

test('the context block carries health, settings, and coverage', async () => {
  const store = makeStore({
    isaAlertEnabled: true,
    isaAlertEnabledInboxes: ['900102'],
    isaAlertLastSeen: { 900102: 3 }
  });
  const ui = await loadUi({ storage: store });
  const support = await ui.api().collectContext();

  assert.equal(support.schema, 1);
  assert.equal(support.health.extension.version, '2.0.16.0');
  assert.deepEqual(Array.from(Object.keys(support.settings)).sort(), ['isaAlertEnabled', 'isaAlertEnabledInboxes']);
  assert.equal(support.storage.local.isaAlertLastSeen[900102], 3);
  assert.equal(support.coverage.companyCount, 2);
  assert.deepEqual(Array.from(support.coverage.teamSignatureInboxes), ['Billing', 'Returns']);
  assert.equal(support.coverage.available, true);
});

test('the context block records a health failure instead of dropping it', async () => {
  const ui = await loadUi({ responder: () => ({ ok: false, reason: 'no-response', error: 'worker asleep' }) });
  const support = await ui.api().collectContext();

  assert.equal(support.health, null);
  assert.equal(support.healthError, 'worker asleep');
});

test('coverage reports unavailable when signature data never loaded', async () => {
  const ui = await loadUi({ signatureData: null });

  assert.equal(ui.api().buildCoverage().available, false);
});

test('injecting the context block keeps the captured html intact', async () => {
  const ui = await loadUi();
  const context = await ui.api().collectContext();
  const capture = '<!doctype html>\n<html><head><script type="application/json" id="isa-capture-meta">{}</script></head><body>page</body></html>';
  const merged = ui.api().injectCaptureContext(capture, context);

  assert.ok(merged.includes('id="isa-capture-meta"'));
  assert.ok(merged.includes('id="isa-capture-context"'));
  assert.ok(merged.includes('<body>page</body>'));
  assert.ok(merged.indexOf('id="isa-capture-context"') < merged.indexOf('id="isa-capture-meta"'));
});

test('the context block escapes a closing tag hidden in stored data', async () => {
  const store = makeStore({ isaAlertSound: '</script><script>alert(1)</script>' });
  const ui = await loadUi({ storage: store });
  const context = await ui.api().collectContext();
  const html = ui.api().injectCaptureContext('<!doctype html>\n<html><head></head><body></body></html>', context);

  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('\\u003c/script'));
});

test('exporting settings writes an allowlisted file and skips derived keys', async () => {
  const store = makeStore({
    isaAlertEnabled: true,
    isaAlertSound: 'chime',
    isaAlertRoster: [{ teamId: '1', label: 'x' }],
    isaAlertLastSeen: { 1: 2 }
  });
  const ui = await loadUi({ storage: store });
  ui.click(ui.pick('isa-settings-backup', 'export'));
  await settled();
  await settled();

  assert.equal(ui.saved.length, 1);
  assert.match(ui.saved[0].filename, /^isa-settings-2\.0\.16\.0-\d{8}-\d{4}\.json$/);
  assert.match(ui.pick('isa-settings-backup', 'summary').textContent, /with 2 settings/);

  const picked = ui.api().pickBackupSettings(store.data.local);
  assert.deepEqual(Array.from(Object.keys(picked)).sort(), ['isaAlertEnabled', 'isaAlertSound']);
});

test('importing merges known keys and never clears storage first', async () => {
  const store = makeStore({ isaAlertSound: 'tritone', isaAlertLastSeen: { 1: 2 } });
  const ui = await loadUi({ storage: store });
  const file = ui.card('isa-settings-backup').querySelector('[data-isa="file"]');

  const payload = {
    schema: 1,
    exportedAt: '2026-09-14T10:05:00.000Z',
    settings: { isaAlertEnabled: true, isaAlertEnabledInboxes: ['900102'] }
  };
  await importFile(ui, file, JSON.stringify(payload));

  assert.equal(store.data.local.isaAlertEnabled, true);
  assert.deepEqual(Array.from(store.data.local.isaAlertEnabledInboxes), ['900102']);
  assert.equal(store.data.local.isaAlertSound, 'tritone', 'untouched settings must survive an import');
  assert.equal(store.data.local.isaAlertLastSeen[1], 2, 'derived state must survive an import');
  assert.match(ui.pick('isa-settings-backup', 'summary').textContent, /Restored 2 settings/);
});

test('importing refuses a newer schema instead of guessing', async () => {
  const store = makeStore({});
  const ui = await loadUi({ storage: store });
  const file = ui.card('isa-settings-backup').querySelector('[data-isa="file"]');

  await importFile(ui, file, JSON.stringify({ schema: 2, settings: { isaAlertEnabled: true } }));

  assert.equal(store.data.local.isaAlertEnabled, undefined);
  assert.match(ui.pick('isa-settings-backup', 'result').textContent, /settings schema 2/);
});

test('importing skips an unknown key and a wrong value type', async () => {
  const store = makeStore({});
  const ui = await loadUi({ storage: store });
  const file = ui.card('isa-settings-backup').querySelector('[data-isa="file"]');

  await importFile(ui, file, JSON.stringify({
    schema: 1,
    settings: { isaAlertEnabled: 'yes', isaDebug: true, madeUpKey: 1 }
  }));

  assert.equal(store.data.local.isaAlertEnabled, undefined);
  assert.equal(store.data.local.isaDebug, true);
  const text = ui.pick('isa-settings-backup', 'result').textContent;
  assert.match(text, /wrong value type: isaAlertEnabled/);
  assert.match(text, /not a setting this build knows: madeUpKey/);
});

test('importing rejects a file that is not JSON', async () => {
  const ui = await loadUi();
  const file = ui.card('isa-settings-backup').querySelector('[data-isa="file"]');

  await importFile(ui, file, 'not json');

  assert.match(ui.pick('isa-settings-backup', 'result').textContent, /not valid JSON/);
});

test('the debug flags load their current values', async () => {
  const store = makeStore({ isaAlertDebug: true });
  const ui = await loadUi({ storage: store });
  await settled();

  const inputs = ui.card('isa-debug-flags').querySelectorAll('input[type="checkbox"]');
  assert.equal(inputs.length, 3);
  assert.equal(inputs[0].checked, false);
  assert.equal(inputs[1].checked, true);
  assert.equal(inputs[0].disabled, false);
});

test('toggling a debug flag writes it and says it is on, with no reload step because the flags apply live', async () => {
  const store = makeStore({});
  const ui = await loadUi({ storage: store });
  await settled();

  const input = ui.card('isa-debug-flags').querySelector('input[data-isa-flag="isaAlertDebug"]');
  input.checked = true;
  input.dispatchEvent(new ui.win.Event('change', { bubbles: true }));
  await settled();

  assert.equal(store.data.local.isaAlertDebug, true);
  assert.equal(ui.pick('isa-debug-flags', 'summary').textContent, 'Alert logging is on.');
  assert.equal(input.disabled, false, 'the checkbox stays usable after a successful save');
});

test('a flag changed elsewhere updates the checkbox', async () => {
  const store = makeStore({});
  const ui = await loadUi({ storage: store });
  await settled();

  store.local.set({ isaDebug: true }, () => {});
  await settled();

  const input = ui.card('isa-debug-flags').querySelector('input[data-isa-flag="isaDebug"]');
  assert.equal(input.checked, true);
});

test('the backup allowlist excludes every derived key', async () => {
  const ui = await loadUi();
  const backup = ui.api().backupKeys.map(entry => entry.key);

  ui.api().derivedKeys.forEach((key) => {
    assert.equal(backup.includes(key), false, `${key} must never be restored`);
  });
});

test('a storage exception while saving a debug flag surfaces its real message', async () => {
  const ui = await loadUi({
    storage: {
      local: {
        get(query, callback) { callback({}); },
        set() { throw new Error('set boom'); }
      },
      onChanged: { addListener: () => {} }
    }
  });
  await settled();

  const input = ui.card('isa-debug-flags').querySelector('input[data-isa-flag="isaAlertDebug"]');
  input.checked = true;
  input.dispatchEvent(new ui.win.Event('change', { bubbles: true }));
  await settled();

  assert.match(ui.pick('isa-debug-flags', 'summary').textContent, /Could not save Alert logging: set boom/);
});

test('a real per-tab error is shown instead of a generic no-reply placeholder', async () => {
  const health = {
    ...HEALTH,
    tabs: [
      ...HEALTH.tabs,
      { tabId: 11, title: 'Ghost tab', url: 'https://app.intercom.com/a/inbox/demo1234/inbox/ghost', active: false, injected: false, error: 'socket closed' }
    ]
  };
  const ui = await loadUi({ responder: () => ({ ok: true, health }) });
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();

  const rows = [...ui.pick('isa-support-tools', 'result').querySelectorAll('.isa-st-row')];
  assert.equal(rows.length, 3);
  assert.match(rows[2].textContent, /not loaded: socket closed/);
});

test('mounting the debug flags card twice leaves the first mount untouched', async () => {
  const ui = await loadUi();
  const container = ui.card('isa-debug-flags');
  const firstBody = container.querySelector('[data-isa="body"]');

  ui.api().mountDebugFlags(container);

  assert.equal(container.querySelector('[data-isa="body"]'), firstBody, 'a second mount must not rebuild the card');
});

test('saving a file removes the temporary download link instead of leaking it into the page', async () => {
  const ui = await loadUi({ responder: captureResponder() });
  ui.click(ui.pick('isa-support-tools', 'check'));
  await settled();
  const row = ui.pick('isa-support-tools', 'result').querySelector('.isa-st-row');
  ui.click(row.querySelector('[data-isa-row="download"]'));
  await settled();
  await settled();

  assert.equal(ui.win.document.querySelectorAll('a[download]').length, 0);
});

async function importFile(ui, input, text) {
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
