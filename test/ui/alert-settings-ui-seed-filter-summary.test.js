'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src');

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function load({ store = {}, signatureData, mode = null, failGet = false, deferGet = false } = {}) {
  const modeMarkup = mode === 'compact' ? ' data-isa-compact="true"' : '';
  const changeListeners = [];
  const errors = [];
  const pendingReads = [];
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="isa-alert-settings"${modeMarkup}></div>
  </body></html>`, { url: 'https://example.test/popup', runScripts: 'outside-only' });
  const win = dom.window;
  win.addEventListener('error', event => errors.push(event.message));
  const writes = [];
  win.chrome = {
    runtime: { lastError: null },
    storage: {
      onChanged: { addListener(listener) { changeListeners.push(listener); } },
      local: {
        get(defaults, callback) {
          if (failGet) {
            win.chrome.runtime.lastError = new Error('read failed');
            callback(null);
            delete win.chrome.runtime.lastError;
            return;
          }
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => {
            result[key] = key in store ? store[key] : fallback;
          });
          if (deferGet) pendingReads.push(() => callback(result));
          else callback(result);
        },
        set(items, callback) {
          writes.push(items);
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    }
  };
  win.SIGNATURE_DATA = signatureData;
  const ctx = dom.getInternalVMContext();
  for (const file of ['alert-sounds.js', 'alert-settings-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return { win, writes, store, changeListeners, pendingReads, errors };
}

const rows = (win, id = 'isa-alert-settings') => [...win.document.querySelectorAll(`#${id} [data-isa="inboxes"] .isa-alert-inbox`)]
  .filter(row => !row.querySelector('input[data-isa-your-inbox]'))
  .map(row => ({ value: row.querySelector('input').value, label: row.querySelector('span').textContent }));
const visibleLabels = win => [...win.document.querySelectorAll('#isa-alert-settings [data-isa="inboxes"] .isa-alert-inbox')]
  .filter(row => !row.querySelector('input[data-isa-your-inbox]'))
  .filter(row => row.style.display !== 'none')
  .map(row => row.querySelector('span').textContent);
const type = (win, value) => {
  const filter = win.document.querySelector('#isa-alert-settings [data-isa="filter"]');
  filter.value = value;
  filter.dispatchEvent(new win.Event('input'));
};
const emit = (changeListeners, changes) => changeListeners.forEach(fn => fn(changes, 'local'));

const FILTER_NAMES = ['Alpha Desk', 'Beta Desk', ...Array.from({ length: 12 }, (_, i) => `Brand ${i}`)];
const filterData = () => ({
  alertRoster: FILTER_NAMES.map((label, i) => ({ teamId: String(100 + i), label }))
});

test('R1: string and object roster entries become rows, and an object without a label shows its teamId', async () => {
  const { win, errors } = load({
    signatureData: {
      alertRoster: ['Plain Inbox', { teamId: 42, label: 'Labelled' }, { teamId: 77 }, { teamId: '88', label: '' }]
    }
  });
  await settled();
  assert.deepEqual(rows(win), [
    { value: 'Plain Inbox', label: 'Plain Inbox' },
    { value: '42', label: 'Labelled' },
    { value: '77', label: '77' },
    { value: '88', label: '88' }
  ]);
  assert.deepEqual(errors, []);
  win.close();
});

test('R2: invalid roster entries are skipped without error and the valid ones keep their order', async () => {
  const { win, errors } = load({
    signatureData: {
      alertRoster: ['First', null, { label: 'No id' }, { teamId: 0, label: 'Zero' }, { teamId: '', label: 'Empty' }, { teamId: 7, label: 'Seventh' }, 'Last']
    }
  });
  await settled();
  assert.deepEqual(rows(win), [
    { value: 'First', label: 'First' },
    { value: '7', label: 'Seventh' },
    { value: 'Last', label: 'Last' }
  ]);
  assert.deepEqual(errors, []);
  win.close();
});

test('R3: an empty roster array renders the same fallback rows and hint as no seed data', async () => {
  const empty = load({ signatureData: { alertRoster: [] } });
  const missing = load({ signatureData: {} });
  await settled();
  const emptyRows = rows(empty.win);
  assert.ok(emptyRows.length > 0, 'the fallback roster is non-empty');
  assert.deepEqual(emptyRows, rows(missing.win));
  const hint = win => win.document.querySelector('#isa-alert-settings [data-isa="hint"]').hidden;
  assert.equal(hint(empty.win), false);
  assert.equal(hint(empty.win), hint(missing.win));
  assert.deepEqual(empty.errors, []);
  empty.win.close();
  missing.win.close();
});

test('G1: null, id-less, and empty-ids groups are skipped, and a group without a label shows its first id', async () => {
  const { win, errors } = load({
    signatureData: {
      alertRoster: [],
      alertGroups: [
        null,
        { label: 'Empty ids', ids: [], detail: [] },
        { label: 'Missing ids', detail: [] },
        { ids: ['900102', '900103'], detail: [] },
        { label: 'Good', ids: ['900101'], detail: [] }
      ]
    }
  });
  await settled();
  assert.deepEqual(rows(win, 'isa-alert-settings').map(r => r.label), ['900102', 'Good']);
  assert.deepEqual(errors, []);
  win.close();
});

test('F1: the filter ignores case and surrounding whitespace, and an empty query shows every row', async () => {
  const { win } = load({ signatureData: filterData() });
  await settled();
  type(win, '  ALPHA ');
  assert.deepEqual(visibleLabels(win), ['Alpha Desk']);
  type(win, 'desk');
  assert.deepEqual(visibleLabels(win), ['Alpha Desk', 'Beta Desk']);
  type(win, '   ');
  assert.equal(visibleLabels(win).length, FILTER_NAMES.length);
  type(win, '');
  assert.equal(visibleLabels(win).length, FILTER_NAMES.length);
  win.close();
});

test('F2: non-matching rows stay hidden after a storage change re-renders the inbox list', async () => {
  const { win, changeListeners, errors } = load({ signatureData: filterData() });
  await settled();
  type(win, 'alpha');
  assert.deepEqual(visibleLabels(win), ['Alpha Desk']);
  emit(changeListeners, { isaAlertEnabledInboxes: { newValue: ['101'] } });
  assert.deepEqual(visibleLabels(win), ['Alpha Desk']);
  emit(changeListeners, {
    isaAlertRoster: { newValue: [{ teamId: '999', label: 'Urgent Zulu Desk' }, { teamId: '998', label: 'Urgent Alpha Annex' }] }
  });
  assert.ok(visibleLabels(win).length > 0);
  assert.ok(visibleLabels(win).every(label => label.toLowerCase().includes('alpha')), visibleLabels(win).join(', '));
  assert.deepEqual(errors, []);
  win.close();
});

test('C1: the compact summary reads "Loading selection…" until settings load', async () => {
  const { win, pendingReads } = load({ mode: 'compact', deferGet: true, signatureData: filterData() });
  await settled();
  const summary = () => win.document.querySelector('#isa-alert-settings [data-isa="summary"]');
  assert.equal(summary().textContent, 'Loading selection…');
  pendingReads.forEach(finish => finish());
  assert.notEqual(summary().textContent, 'Loading selection…');
  win.close();
});

test('C1: the compact summary reads "Selection unavailable." after a load failure', async () => {
  const { win } = load({ mode: 'compact', failGet: true, signatureData: filterData() });
  await settled();
  assert.equal(win.document.querySelector('#isa-alert-settings [data-isa="summary"]').textContent, 'Selection unavailable.');
  win.close();
});

test('C2: Your inbox leads the Selected list when on and is absent from it when off', async () => {
  const data = () => ({
    alertRoster: [{ teamId: '1', label: 'Urgent Alpha' }, { teamId: '2', label: 'Urgent Beta' }]
  });
  const on = load({
    mode: 'compact', signatureData: data(),
    store: { isaAlertEnabled: true, isaAlertYourInbox: true, isaAlertEnabledInboxes: ['2', '1'] }
  });
  const off = load({
    mode: 'compact', signatureData: data(),
    store: { isaAlertEnabled: true, isaAlertYourInbox: false, isaAlertEnabledInboxes: ['2', '1'] }
  });
  await settled();
  const selected = win => win.document.querySelector('#isa-alert-settings [data-isa="summary"] p').textContent;
  assert.match(selected(on.win), /^Selected: Your inbox, /);
  assert.doesNotMatch(selected(off.win), /Your inbox/);
  assert.match(selected(off.win), /^Selected: /);
  on.win.close();
  off.win.close();
});

test('C3: a group counts as selected in the compact summary when only one of its ids is selected', async () => {
  const { win } = load({
    mode: 'compact',
    signatureData: {
      alertRoster: [],
      alertGroups: [
        { label: 'Pair', ids: ['900101', '900102'], detail: [] },
        { label: 'Other', ids: ['900103', '900104'], detail: [] }
      ]
    },
    store: { isaAlertEnabled: true, isaAlertYourInbox: false, isaAlertEnabledInboxes: ['900102'] }
  });
  await settled();
  const summary = win.document.querySelector('#isa-alert-settings [data-isa="summary"]');
  assert.equal(summary.querySelector('p').textContent, 'Selected: Pair');
  win.close();
});
