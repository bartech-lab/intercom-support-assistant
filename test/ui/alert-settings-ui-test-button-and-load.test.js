'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src');
const settled = () => new Promise(resolve => setTimeout(resolve, 0));
const plain = value => JSON.parse(JSON.stringify(value));

const DATA = {
  alertRoster: [
    { teamId: '90005450', label: 'Urgent Alderpoint' },
    { teamId: '9005326', label: 'Urgent alderpoint' }
  ]
};
const GROUPED = {
  alertRoster: [
    { teamId: '90005450', label: 'Urgent Alderpoint' },
    { teamId: '90005357', label: 'Urgent Kids & Books' }
  ],
  alertGroups: [{ label: 'ALDER', ids: ['90005450'], detail: [] }]
};

function load({ store = {}, signatureData = DATA, mode = 'expanded', getResult = 'normal', failSet = false, runtime = 'full' } = {}) {
  const changeListeners = [];
  const writes = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', err => errors.push(err));
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="isa-alert-settings" data-isa-${mode}="true"></div>
  </body></html>`, { url: 'https://example.test/popup', runScripts: 'outside-only', virtualConsole });
  const win = dom.window;
  win.addEventListener('error', event => errors.push(event.error || event));
  win.chrome = {
    storage: {
      onChanged: { addListener(listener) { changeListeners.push(listener); } },
      local: {
        get(defaults, callback) {
          if (getResult === 'undefined') { callback(undefined); return; }
          if (getResult === 'throws') throw new Error('storage get exploded');
          if (getResult === 'asyncUndefined') { setTimeout(() => callback(undefined), 0); return; }
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => {
            result[key] = key in store ? store[key] : fallback;
          });
          callback(result);
        },
        set(items, callback) {
          writes.push(items);
          if (failSet) {
            win.chrome.runtime.lastError = new Error('write failed');
            if (callback) callback();
            delete win.chrome.runtime.lastError;
            return;
          }
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    }
  };
  if (runtime === 'full' || runtime === 'nosend') win.chrome.runtime = { lastError: null };
  win.SIGNATURE_DATA = signatureData;
  const ctx = dom.getInternalVMContext();
  for (const file of ['alert-sounds.js', 'alert-settings-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  const panel = win.document.querySelector('#isa-alert-settings');
  return { win, panel, writes, store, changeListeners, errors };
}

const testStatus = panel => panel.querySelector('[data-isa="testStatus"]');

test('B1: the test button plays the selected non-default sound exactly once', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true } });
  await settled();
  const played = [];
  win.ISA_ALERT_SOUNDS.play = (...args) => { played.push(args); };
  const select = panel.querySelector('[data-isa="sound"]');
  select.value = 'marimba';
  select.dispatchEvent(new win.Event('change'));
  played.length = 0;
  win.chrome.runtime.sendMessage = (msg, cb) => cb({ level: 'granted', ok: true });
  panel.querySelector('[data-isa="test"]').click();
  assert.deepEqual(played, [['marimba']]);
  win.close();
});

test('B2: the test button outside the extension (no chrome.runtime) shows an error status', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true }, runtime: 'none' });
  await settled();
  panel.querySelector('[data-isa="test"]').click();
  const status = testStatus(panel);
  assert.equal(status.textContent, 'Testing works only inside the extension.');
  assert.ok(status.classList.contains('isa-alert-test-bad'));
  win.close();
});

test('B2: the test button with chrome.runtime but no sendMessage shows the same error', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true }, runtime: 'nosend' });
  await settled();
  panel.querySelector('[data-isa="test"]').click();
  const status = testStatus(panel);
  assert.equal(status.textContent, 'Testing works only inside the extension.');
  assert.ok(status.classList.contains('isa-alert-test-bad'));
  win.close();
});

test('B3: a sendMessage failure with lastError reports the extension is unreachable', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true } });
  await settled();
  win.chrome.runtime.sendMessage = (msg, cb) => {
    win.chrome.runtime.lastError = { message: 'no receiver' };
    cb(undefined);
    delete win.chrome.runtime.lastError;
  };
  panel.querySelector('[data-isa="test"]').click();
  const status = testStatus(panel);
  assert.equal(status.textContent, 'Could not reach the extension to send a test. Try reloading the extension.');
  assert.ok(status.classList.contains('isa-alert-test-bad'));
  win.close();
});

test('B3: lastError wins even when the callback also carries a granted result', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true } });
  await settled();
  win.chrome.runtime.sendMessage = (msg, cb) => {
    win.chrome.runtime.lastError = { message: 'port closed' };
    cb({ level: 'granted', ok: true });
    delete win.chrome.runtime.lastError;
  };
  panel.querySelector('[data-isa="test"]').click();
  assert.equal(testStatus(panel).textContent, 'Could not reach the extension to send a test. Try reloading the extension.');
  win.close();
});

test('B4: an undefined storage result reports a load failure and disables the switches', async () => {
  const { win, panel } = load({ mode: 'compact', getResult: 'undefined' });
  await settled();
  assert.equal(panel.querySelector('[data-isa="enabled"]').disabled, true);
  assert.equal(panel.querySelector('[data-isa="storageStatus"]').textContent, 'Could not load alert settings. Alert switches are unavailable.');
  win.close();
});

test('B4b: an asynchronous undefined storage result reports a load failure without raising errors', async () => {
  const { win, panel, errors } = load({ mode: 'compact', getResult: 'asyncUndefined' });
  await settled();
  await settled();
  assert.equal(panel.querySelector('[data-isa="enabled"]').disabled, true);
  assert.equal(panel.querySelector('[data-isa="storageStatus"]').textContent, 'Could not load alert settings. Alert switches are unavailable.');
  assert.deepEqual(errors, []);
  win.close();
});

test('B4c: a storage read that throws reports a load failure and disables the switches', async () => {
  const { win, panel, errors } = load({ getResult: 'throws' });
  await settled();
  assert.equal(panel.querySelector('[data-isa="enabled"]').disabled, true);
  assert.equal(panel.querySelector('[data-isa="storageStatus"]').textContent, 'Could not load alert settings. Alert switches are unavailable.');
  assert.deepEqual(errors, []);
  win.close();
});

for (const stored of [{}, { isaAlertSound: '' }]) {
  test(`B5: a missing stored sound (${JSON.stringify(stored)}) shows the default sound`, async () => {
    const { win, panel } = load({ store: stored });
    await settled();
    const value = panel.querySelector('[data-isa="sound"]').value;
    assert.equal(value, win.ISA_ALERT_SOUNDS.defaultId);
    assert.equal(value, 'blink-blink');
    win.close();
  });
}

test('B6: a prune of a stale inbox id writes the pruned list back', async () => {
  const { win, writes } = load({ signatureData: GROUPED, store: { isaAlertEnabledInboxes: ['90005450', '90005357'] } });
  await settled();
  assert.deepEqual(plain(writes), [{ isaAlertEnabledInboxes: ['90005450'] }]);
  win.close();
});

test('B6: a failed prune write reports the save failure and keeps the visible selection', async () => {
  const { win, panel, writes } = load({
    signatureData: GROUPED,
    failSet: true,
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: ['90005450', '90005357'] }
  });
  await settled();
  assert.deepEqual(plain(writes), [{ isaAlertEnabledInboxes: ['90005450'] }]);
  assert.match(panel.querySelector('[data-isa="storageStatus"]').textContent, /Could not save/);
  const boxes = [...panel.querySelectorAll('[data-isa="inboxes"] input[type="checkbox"]:not([data-isa-your-inbox])')];
  assert.deepEqual(boxes.map(cb => [cb.value, cb.checked]), [['90005450', true]]);
  win.close();
});

test('B7: storage changes from sync and session areas do not move the enable switch', async () => {
  const { win, panel, changeListeners } = load({ mode: 'compact' });
  await settled();
  const sw = panel.querySelector('[data-isa="enabled"]');
  assert.equal(sw.checked, false);
  changeListeners.forEach(fn => fn({ isaAlertEnabled: { newValue: true } }, 'sync'));
  assert.equal(sw.checked, false);
  changeListeners.forEach(fn => fn({ isaAlertEnabled: { newValue: true } }, 'session'));
  assert.equal(sw.checked, false);
  changeListeners.forEach(fn => fn({ isaAlertEnabled: { newValue: true } }, 'local'));
  assert.equal(sw.checked, true);
  win.close();
});
