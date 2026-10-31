'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'tools', 'read-capture.js');

const CONTEXT = {
  schema: 1,
  generatedAt: '2026-09-14T10:05:00.000Z',
  workspaceUrl: 'chrome-extension://test/preview-page.html#tools',
  extensionVersion: '2.0.16.0',
  health: {
    checkedAt: '2026-09-14T10:05:00.000Z',
    extension: { name: 'Intercom Support Assistant', version: '2.0.16.0' },
    browser: { chromeVersion: '141.0.7390.54', userAgent: 'test' },
    notificationLevel: 'denied',
    tabsError: null,
    tabs: [
      { tabId: 7, title: 'Inbox', url: 'https://app.intercom.com/a/inbox/1', active: true, injected: true },
      { tabId: 9, title: 'Inbox 2', url: 'https://app.intercom.com/a/inbox/2', active: false, injected: false, notInjected: true }
    ]
  },
  healthError: null,
  storage: {
    local: { isaAlertEnabled: true, isaAlertLastSeen: { 900102: 4 } },
    localError: null,
    session: {},
    sessionError: null
  },
  settings: { isaAlertEnabled: true, isaAlertEnabledInboxes: ['900102'], isaAlertSound: '<script>' },
  coverage: {
    available: true,
    companyCount: 2,
    companies: ['Orchard Kitchen', 'Marlowe Books'],
    teamSignatureInboxes: ['Billing', 'Returns'],
    alertRoster: [{ teamId: '900102', label: 'Urgent Marlowe Books' }],
    promotionalBanners: ['Brightwell']
  },
  capture: {
    filename: 'intercom-20260914T100500-123.html',
    meta: { surface: 'intercom', conversationId: '123', view: 'conversation' }
  }
};

const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeCapture(context, { includeBlock = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isa-capture-context-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'intercom-20260914T100500-123.html');
  const json = JSON.stringify(context, null, 2).replace(/</g, '\\u003c');
  const block = includeBlock
    ? `<script type="application/json" id="isa-capture-context">\n${json}\n</script>`
    : '';
  fs.writeFileSync(file, `<!doctype html>\n<html><head>${block}</head><body></body></html>\n`, 'utf8');
  return file;
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('the reader prints the build, the browser, and the tab states', () => {
  const file = writeCapture(CONTEXT);
  const result = run([file, '--context']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /schema: 1/);
  assert.match(result.stdout, /extension: 2\.0\.16\.0\n/);
  assert.match(result.stdout, /chrome: 141\.0\.7390\.54/);
  assert.match(result.stdout, /notifications: denied/);
  assert.match(result.stdout, /Tabs \(2\):/);
  assert.match(result.stdout, /loaded \[active\] https:\/\/app\.intercom\.com/);
  assert.match(result.stdout, /not-loaded \(needs reload\) https:\/\/app\.intercom\.com\/a\/inbox\/2/);
});

test('the reader prints settings, storage keys, and coverage', () => {
  const file = writeCapture(CONTEXT);
  const result = run([file, '--context']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /isaAlertEnabled: true/);
  assert.match(result.stdout, /isaAlertEnabledInboxes: \[900102\]/);
  assert.match(result.stdout, /Local storage keys \(2\): isaAlertEnabled, isaAlertLastSeen/);
  assert.match(result.stdout, /brands: 2/);
  assert.match(result.stdout, /team signature inboxes: Billing, Returns/);
});

test('the reader unescapes a value that was escaped for the html host', () => {
  const file = writeCapture(CONTEXT);
  const result = run([file, '--context']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /isaAlertSound: <script>/);
});

test('the json mode prints the whole block for further processing', () => {
  const file = writeCapture(CONTEXT);
  const result = run([file, '--context', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.schema, 1);
  assert.equal(parsed.health.tabs.length, 2);
});

test('a capture with no context block says so and fails', () => {
  const file = writeCapture(CONTEXT, { includeBlock: false });
  const result = run([file, '--context']);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /No isa-capture-context block found/);
});

test('a health failure recorded at save time is printed, not hidden', () => {
  const file = writeCapture(Object.assign({}, CONTEXT, { health: null, healthError: 'worker asleep' }));
  const result = run([file, '--context']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /healthError: worker asleep/);
});

test('a context block from a workspace without signature data is called out', () => {
  const file = writeCapture(Object.assign({}, CONTEXT, { coverage: { available: false } }));
  const result = run([file, '--context']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /signature data was not loaded/);
});

test('a real capture carrying a context block reads both ways', () => {
  const { loadExtension } = require('../support/helpers');
  const win = loadExtension('<!doctype html><html><head><title>Intercom</title></head><body><div id="teammate-app-react"></div></body></html>');
  const capture = win.ISA_DOM_CAPTURE.buildCapture({ surface: 'intercom', view: 'conversation' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isa-capture-real-'));
  const file = path.join(dir, capture.filename);
  const json = JSON.stringify(CONTEXT, null, 2).replace(/</g, '\\u003c');
  const block = `<script type="application/json" id="isa-capture-context">\n${json}\n</script>`;
  const head = /<head[^>]*>/i.exec(capture.html);
  assert.ok(head, 'a real capture always carries a head element');
  const at = head.index + head[0].length;
  fs.writeFileSync(file, `${capture.html.slice(0, at)}\n${block}${capture.html.slice(at)}`, 'utf8');

  const context = run([file, '--context']);
  assert.equal(context.status, 0, context.stderr);
  assert.match(context.stdout, /extension: 2\.0\.16\.0/);

  const dom = run([file]);
  assert.equal(dom.status, 0, `${dom.stdout}\n${dom.stderr}`);
  assert.match(dom.stdout, /surface:\s+intercom/);
  assert.match(dom.stdout, /carries a context block\. Read it with --context\./);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a capture without a context block never mentions one', () => {
  const { loadExtension } = require('../support/helpers');
  const win = loadExtension('<!doctype html><html><head><title>Intercom</title></head><body><div id="teammate-app-react"></div></body></html>');
  const capture = win.ISA_DOM_CAPTURE.buildCapture({ surface: 'intercom', view: 'conversation' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isa-capture-plain-'));
  const file = path.join(dir, capture.filename);
  fs.writeFileSync(file, capture.html, 'utf8');

  const dom = run([file]);
  assert.equal(dom.status, 0, `${dom.stdout}\n${dom.stderr}`);
  assert.equal(/--context/.test(dom.stdout), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
