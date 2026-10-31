'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src');
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

const DATA = {
  alertRoster: [
    { teamId: '90005450', label: 'Urgent Alderpoint' },
    { teamId: '9005326', label: 'Urgent alderpoint' }
  ]
};

function load({ store = {}, signatureData = DATA, mode = 'expanded', noStorage = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="isa-alert-settings" data-isa-${mode}="true"></div>
  </body></html>`, { url: 'https://example.test/popup', runScripts: 'outside-only' });
  const win = dom.window;
  win.chrome = {
    storage: noStorage ? {} : {
      onChanged: { addListener() {} },
      local: {
        get(defaults, callback) {
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => {
            result[key] = key in store ? store[key] : fallback;
          });
          callback(result);
        },
        set(items, callback) {
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    },
    runtime: { lastError: null }
  };
  win.SIGNATURE_DATA = signatureData;
  const ctx = dom.getInternalVMContext();
  for (const file of ['alert-sounds.js', 'alert-settings-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  const panel = win.document.querySelector('#isa-alert-settings');
  return { win, panel, store };
}

const yourInbox = panel => panel.querySelector('[data-isa="inboxes"] input[data-isa-your-inbox]');
const inboxBox = (panel, value) => [...panel.querySelectorAll('[data-isa="inboxes"] input[type="checkbox"]:not([data-isa-your-inbox])')]
  .find(cb => cb.value === value);
const enable = panel => panel.querySelector('[data-isa="enabled"]').click();
const status = panel => panel.querySelector('[data-isa="storageStatus"]');
const isHidden = el => el.hidden || el.style.display === 'none';

const UNAVAILABLE = 'Alert settings storage is unavailable. Your previous setting was restored.';
const SAVE_FAILED = 'Could not save alert settings. Your previous setting was restored.';

test('S1: with no settings store, toggling Your inbox reverts it and shows the unavailable message', async () => {
  const { win, panel } = load({ noStorage: true });
  await settled();
  [...panel.querySelectorAll('input')].forEach(input => { input.disabled = false; });
  const box = yourInbox(panel);
  const before = box.checked;
  box.click();
  assert.equal(yourInbox(panel).checked, before);
  assert.equal(isHidden(status(panel)), false);
  assert.equal(status(panel).textContent, UNAVAILABLE);
  win.close();
});

test('S1: with no settings store, toggling an inbox checkbox reverts it and shows the unavailable message', async () => {
  const { win, panel } = load({ noStorage: true });
  await settled();
  [...panel.querySelectorAll('input')].forEach(input => { input.disabled = false; });
  const box = inboxBox(panel, '9005326');
  const before = box.checked;
  box.click();
  assert.equal(inboxBox(panel, '9005326').checked, before);
  assert.equal(isHidden(status(panel)), false);
  assert.equal(status(panel).textContent, UNAVAILABLE);
  win.close();
});

test('S2: a stale failure from the first write is ignored and the second write success leaves no status', async () => {
  const { win, panel } = load();
  await settled();
  enable(panel);
  const callbacks = [];
  win.chrome.storage.local.set = (items, callback) => { callbacks.push(callback); };
  const box = yourInbox(panel);
  const original = box.checked;
  box.click();
  box.click();
  assert.equal(callbacks.length, 2);
  assert.equal(box.checked, original);
  win.chrome.runtime.lastError = { message: 'first write failed' };
  callbacks[0]();
  delete win.chrome.runtime.lastError;
  assert.equal(box.checked, original);
  assert.equal(isHidden(status(panel)), true);
  assert.equal(status(panel).textContent, '');
  callbacks[1]();
  assert.equal(box.checked, original);
  assert.equal(isHidden(status(panel)), true);
  assert.equal(status(panel).textContent, '');
  win.close();
});

test('S2: three quick toggles keep the last value when earlier writes fail late', async () => {
  const { win, panel } = load();
  await settled();
  enable(panel);
  const callbacks = [];
  win.chrome.storage.local.set = (items, callback) => { callbacks.push(callback); };
  const box = inboxBox(panel, '9005326');
  box.click();
  box.click();
  box.click();
  assert.equal(box.checked, true);
  win.chrome.runtime.lastError = { message: 'stale' };
  callbacks[0]();
  callbacks[1]();
  delete win.chrome.runtime.lastError;
  assert.equal(box.checked, true);
  assert.equal(isHidden(status(panel)), true);
  win.close();
});

test('S3: a resolving promise confirms the write without a callback', async () => {
  const { win, panel } = load();
  await settled();
  enable(panel);
  win.chrome.storage.local.set = () => Promise.resolve();
  const box = yourInbox(panel);
  const original = box.checked;
  box.click();
  await settled();
  await settled();
  assert.equal(box.checked, !original);
  assert.equal(isHidden(status(panel)), true);
  assert.equal(status(panel).textContent, '');
  win.close();
});

test('S3: a rejecting promise restores the previous value and shows the save failure', async () => {
  const { win, panel } = load();
  await settled();
  enable(panel);
  win.chrome.storage.local.set = () => Promise.reject(new Error('quota'));
  const box = yourInbox(panel);
  const original = box.checked;
  box.click();
  await settled();
  await settled();
  assert.equal(yourInbox(panel).checked, original);
  assert.equal(status(panel).textContent, SAVE_FAILED);
  win.close();
});

test('S3: a rejection is not treated as success because the status is visible afterwards', async () => {
  const { win, panel } = load();
  await settled();
  enable(panel);
  win.chrome.storage.local.set = () => Promise.reject(new Error('denied'));
  const box = inboxBox(panel, '90005450');
  const original = box.checked;
  box.click();
  await settled();
  await settled();
  assert.equal(isHidden(status(panel)), false);
  assert.equal(inboxBox(panel, '90005450').checked, original);
  win.close();
});

const GROUPED = {
  alertRoster: [
    { teamId: '1', label: 'Urgent A1' },
    { teamId: '2', label: 'Urgent A2' },
    { teamId: '3', label: 'Urgent B1' },
    { teamId: '4', label: 'Urgent B2' },
    { teamId: '5', label: 'Urgent C1' }
  ],
  alertGroups: [
    { label: 'Alpha', ids: ['1', '2'], detail: [] },
    { label: 'Beta', ids: ['3', '4'], detail: [] },
    { label: 'Gamma', ids: ['5'], detail: [] }
  ]
};
const groupBox = (panel, label) => [...panel.querySelectorAll('[data-isa="inboxes"] .isa-alert-inbox')]
  .find(row => row.querySelector('.isa-alert-name').textContent === label).querySelector('input');
const groupedStore = () => ({ isaAlertEnabledInboxes: ['1', '2', '3'] });

test('S4: a group with all ids selected is checked and not indeterminate', async () => {
  const { win, panel } = load({ signatureData: GROUPED, store: groupedStore() });
  await settled();
  const alpha = groupBox(panel, 'Alpha');
  assert.equal(alpha.checked, true);
  assert.equal(alpha.indeterminate, false);
  win.close();
});

test('S4: a group with some ids selected is unchecked and indeterminate', async () => {
  const { win, panel } = load({ signatureData: GROUPED, store: groupedStore() });
  await settled();
  const beta = groupBox(panel, 'Beta');
  assert.equal(beta.checked, false);
  assert.equal(beta.indeterminate, true);
  win.close();
});

test('S4: a group with no ids selected is neither checked nor indeterminate', async () => {
  const { win, panel } = load({ signatureData: GROUPED, store: groupedStore() });
  await settled();
  const gamma = groupBox(panel, 'Gamma');
  assert.equal(gamma.checked, false);
  assert.equal(gamma.indeterminate, false);
  win.close();
});

const rosterOf = count => ({
  alertRoster: Array.from({ length: count }, (_, i) => ({ teamId: String(100 + i), label: `Urgent Brand ${i}` }))
});

test('S5: the filter input is hidden when the panel offers exactly 12 inbox items', async () => {
  const { win, panel } = load({ signatureData: rosterOf(12) });
  await settled();
  const filter = panel.querySelector('[data-isa="filter"]');
  assert.ok(filter);
  assert.equal(isHidden(filter), true);
  win.close();
});

test('S5: the filter input is shown when the panel offers exactly 13 inbox items', async () => {
  const { win, panel } = load({ signatureData: rosterOf(13) });
  await settled();
  const filter = panel.querySelector('[data-isa="filter"]');
  assert.ok(filter);
  assert.equal(isHidden(filter), false);
  win.close();
});
