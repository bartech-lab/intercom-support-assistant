'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src');

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function loadSettingsUi({ store = {}, signatureData = null, mode = null, failGet = false, failSet = false, deferGet = false, throwGet = false, noStorage = false, noSoundScript = false } = {}) {
  const modeMarkup = mode === 'compact' ? ' data-isa-compact="true"' : mode === 'expanded' ? ' data-isa-expanded="true"' : '';
  const changeListeners = [];
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="isa-alert-settings"${modeMarkup}></div>
  </body></html>`, { url: 'https://example.test/popup', runScripts: 'outside-only' });
  const win = dom.window;
  const writes = [];
  const pendingReads = [];
  win.chrome = {
    storage: noStorage ? {} : {
      onChanged: { addListener(listener) { changeListeners.push(listener); } },
      local: {
        get(defaults, callback) {
          if (throwGet) throw new Error('read threw');
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
  win.chrome.runtime = { lastError: null };
  win.SIGNATURE_DATA = signatureData || {
    alertRoster: [
      { teamId: '900101', label: 'Urgent Alderpoint' },
      { teamId: '900102', label: 'Urgent Brightwell' }
    ]
  };
  const ctx = dom.getInternalVMContext();
  const files = noSoundScript ? ['alert-settings-ui.js'] : ['alert-sounds.js', 'alert-settings-ui.js'];
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return { win, writes, store, changeListeners, pendingReads };
}

const plain = value => JSON.parse(JSON.stringify(value));
const enable = (win, id) => win.document.querySelector(`#${id} [data-isa="enabled"]`).click();
const rows = (win, id) => [...win.document.querySelectorAll(`#${id} [data-isa="inboxes"] .isa-alert-inbox`)]
  .filter(row => !row.querySelector('input[data-isa-your-inbox]'))
  .map(row => ({ value: row.querySelector('input').value, label: row.querySelector('span').textContent }));

test('the panel auto-mounts from its script', async () => {
  const { win } = loadSettingsUi();
  await settled();
  assert.ok(win.document.querySelector('#isa-alert-settings .isa-alert-toggle'));
});

test('the Intercom panel keeps its wording, roster shape, and stripped labels', async () => {
  const { win } = loadSettingsUi();
  await settled();
  const toggle = win.document.querySelector('#isa-alert-settings .isa-alert-toggle');
  assert.equal(toggle.querySelector('span').textContent, 'Intercom');
  assert.equal(toggle.querySelector('[role="switch"]').getAttribute('aria-label'), 'New-message alerts');
  assert.deepEqual(rows(win, 'isa-alert-settings'), [
    { value: '900101', label: 'Alderpoint' },
    { value: '900102', label: 'Brightwell' }
  ]);
});

test('only Your inbox is selected by default; no Urgent inbox is', async () => {
  const { win } = loadSettingsUi();
  await settled();
  const checked = id => [...win.document.querySelectorAll(`#${id} [data-isa="inboxes"] input[type="checkbox"]:not([data-isa-your-inbox])`)]
    .filter(cb => cb.checked).map(cb => cb.value);
  assert.deepEqual(checked('isa-alert-settings'), []);
  assert.equal(win.document.querySelector('#isa-alert-settings input[data-isa-your-inbox]').checked, true);
});

test('a retired inbox is hidden on the Intercom panel even when storage still lists it', async () => {
  const { win, changeListeners } = loadSettingsUi({
    signatureData: {
      alertRoster: [{ teamId: '900101', label: 'Urgent Alderpoint' }, { teamId: '90005357', label: 'Urgent Southside' }],
      retiredAlertInboxIds: ['90005371']
    },
    store: { isaAlertRoster: [{ teamId: '90005371', label: 'Urgent Saltmarsh Crafts' }] }
  });
  await settled();
  assert.deepEqual(rows(win, 'isa-alert-settings').map(r => r.value), ['900101', '90005357']);

  changeListeners.forEach(fn => fn({
    isaAlertRoster: { newValue: [{ teamId: '90005371', label: 'Urgent Saltmarsh Crafts' }, { teamId: '111', label: 'Urgent New' }] }
  }, 'local'));
  assert.deepEqual(rows(win, 'isa-alert-settings').map(r => r.value), ['900101', '90005357', '111']);
});

test('Your inbox is on by default', async () => {
  const { win } = loadSettingsUi();
  await settled();
  const yourInbox = win.document.querySelector('#isa-alert-settings [data-isa="inboxes"] input[data-isa-your-inbox]');
  assert.ok(yourInbox, 'the Intercom panel renders a Your inbox row');
  assert.equal(yourInbox.checked, true);
});

test('Your inbox writes its own key and never leaks into the brand list', async () => {
  const { win, writes } = loadSettingsUi({ store: { isaAlertEnabledInboxes: ['900101', '900102'] } });
  await settled();
  enable(win, 'isa-alert-settings');
  writes.length = 0;
  win.document.querySelector('#isa-alert-settings [data-isa="inboxes"] input[data-isa-your-inbox]').click();
  assert.deepEqual(plain(writes), [{ isaAlertYourInbox: false }]);

  writes.length = 0;
  const boxes = [...win.document.querySelectorAll('#isa-alert-settings [data-isa="inboxes"] input[type="checkbox"]:not([data-isa-your-inbox])')];
  boxes.find(cb => cb.value === '900102').click();
  assert.deepEqual(plain(writes), [{ isaAlertEnabledInboxes: ['900101'] }],
    'the brand write must not carry the Your inbox checkbox');
});

test('a stored Your inbox opt-out survives a reload', async () => {
  const { win } = loadSettingsUi({ store: { isaAlertYourInbox: false } });
  await settled();
  const yourInbox = win.document.querySelector('#isa-alert-settings [data-isa="inboxes"] input[data-isa-your-inbox]');
  assert.equal(yourInbox.checked, false);
});

test('toggling one inbox keeps a selected inbox the roster has not discovered yet', async () => {
  const { win, writes } = loadSettingsUi({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: ['900102', '90067313'] }
  });
  await settled();
  writes.length = 0;
  const boxes = [...win.document.querySelectorAll('#isa-alert-settings [data-isa="inboxes"] input[type="checkbox"]:not([data-isa-your-inbox])')];
  assert.equal(boxes.some(cb => cb.value === '90067313'), false, 'the imported inbox is not in the rendered roster');
  boxes.find(cb => cb.value === '900101').click();

  assert.deepEqual(plain(writes), [{ isaAlertEnabledInboxes: ['900101', '900102', '90067313'] }]);
});

test('expanded controls are immediate and use native disabled state', async () => {
  const { win } = loadSettingsUi({ mode: 'expanded' });
  await settled();
  const panel = win.document.querySelector('#isa-alert-settings');
  assert.ok(panel.querySelector('[data-isa="body"]'));
  assert.equal(panel.querySelector('[data-isa="configure"]'), null);
  assert.equal(panel.querySelector('[data-isa="sound"]').disabled, true);
  assert.equal(panel.querySelector('[data-isa="test"]').disabled, true);
  enable(win, 'isa-alert-settings');
  assert.equal(panel.querySelector('[data-isa="sound"]').disabled, false);
  assert.equal(panel.querySelector('[data-isa="test"]').disabled, false);
});

test('storage read failures disable switches and report the failure', async () => {
  const { win } = loadSettingsUi({ mode: 'compact', failGet: true });
  await settled();
  const panel = win.document.querySelector('#isa-alert-settings');
  assert.equal(panel.querySelector('[data-isa="enabled"]').disabled, true);
  assert.match(panel.querySelector('[data-isa="storageStatus"]').textContent, /Could not load/);
});

test('storage write failures restore the confirmed switch state', async () => {
  const { win, writes } = loadSettingsUi({ mode: 'compact', failSet: true });
  await settled();
  const panel = win.document.querySelector('#isa-alert-settings');
  const enabled = panel.querySelector('[data-isa="enabled"]');
  enabled.click();
  assert.equal(writes.length, 1);
  assert.equal(enabled.checked, false);
  assert.match(panel.querySelector('[data-isa="storageStatus"]').textContent, /previous setting was restored/);
});


test('quick switches remain disabled until delayed storage reads finish', async () => {
  const { win, pendingReads, writes } = loadSettingsUi({ mode: 'compact', deferGet: true, store: { isaAlertEnabled: true } });
  await settled();
  const switches = [...win.document.querySelectorAll('[data-isa="enabled"]')];
  assert.equal(switches.length, 1);
  assert.equal(switches[0].disabled, true);
  switches[0].click();
  assert.equal(writes.length, 0);
  pendingReads.forEach(finish => finish());
  assert.equal(switches[0].disabled, false);
  assert.equal(switches[0].checked, true);
  win.close();
});

test('native-shaped storage functions wait for asynchronous failure before confirming a quick switch', async () => {
  const { win } = loadSettingsUi({ mode: 'compact' });
  await settled();
  let finish;
  win.chrome.storage.local.set = (...args) => { finish = args[1]; };
  const control = win.document.querySelector('#isa-alert-settings [data-isa="enabled"]');
  control.click();
  assert.equal(control.checked, true);
  win.chrome.runtime.lastError = { message: 'write denied' };
  finish();
  delete win.chrome.runtime.lastError;
  assert.equal(control.checked, false);
  assert.match(win.document.querySelector('#isa-alert-settings [data-isa="storageStatus"]').textContent, /Could not save/);
  win.close();
});

test('mounting without alert-sounds.js still resolves a default sound instead of crashing, matching popup.html', async () => {
  const { win } = loadSettingsUi({ noSoundScript: true });
  await settled();
  assert.equal(win.ISA_ALERT_SOUNDS, undefined, 'popup.html really does not load alert-sounds.js');
  assert.equal(win.document.querySelector('#isa-alert-settings .isa-alert-toggle span').textContent, 'Intercom');
  const options = [...win.document.querySelectorAll('#isa-alert-settings [data-isa="sound"] option')].map(o => o.value);
  assert.deepEqual(options, ['tritone']);
  win.close();
});

test('mounting injects the settings stylesheet once', async () => {
  const { win } = loadSettingsUi();
  await settled();
  assert.ok(win.document.getElementById('isa-alert-settings-style'));
  assert.ok(win.document.querySelector('#isa-alert-settings'));
  assert.equal(win.document.querySelectorAll('#isa-alert-settings-style').length, 1);
  win.close();
});

test('Your inbox row starts checked before storage confirms, matching the default-on spec', async () => {
  const { win, pendingReads } = loadSettingsUi({ deferGet: true });
  await settled();
  const yourInbox = win.document.querySelector('#isa-alert-settings [data-isa="inboxes"] input[data-isa-your-inbox]');
  assert.equal(yourInbox.checked, true, 'Your inbox is on by default even while the load is still pending');
  pendingReads.forEach(finish => finish());
  win.close();
});

test('a write success updates the confirmed snapshot so a later failure restores it, not a stale value', async () => {
  const { win } = loadSettingsUi({ mode: 'compact' });
  await settled();
  const panel = win.document.querySelector('#isa-alert-settings');
  const enabled = panel.querySelector('[data-isa="enabled"]');
  enabled.click();
  assert.equal(enabled.checked, true);
  win.chrome.storage.local.set = (items, callback) => {
    win.chrome.runtime.lastError = { message: 'write denied' };
    if (callback) callback();
    delete win.chrome.runtime.lastError;
  };
  enabled.click();
  assert.equal(enabled.checked, true, 'the failed write restores the confirmed ON state, not a stale default');
  win.close();
});

test('a synchronous storage.set throw still restores state and reports failure', async () => {
  const { win } = loadSettingsUi({ mode: 'compact' });
  await settled();
  const panel = win.document.querySelector('#isa-alert-settings');
  const enabled = panel.querySelector('[data-isa="enabled"]');
  win.chrome.storage.local.set = () => { throw new Error('quota exceeded'); };
  enabled.click();
  assert.equal(enabled.checked, false, 'the optimistic flip is undone when the write throws synchronously');
  assert.match(panel.querySelector('[data-isa="storageStatus"]').textContent, /Could not save/);
  win.close();
});

test('the filter search box narrows visible inboxes by substring, and clearing it shows every row again', async () => {
  const { win } = loadSettingsUi({
    signatureData: {
      alertRoster: Array.from({ length: 13 }, (_, i) => ({ teamId: String(i), label: `Urgent Brand ${i}` }))
    }
  });
  await settled();
  const filter = win.document.querySelector('#isa-alert-settings [data-isa="filter"]');
  const visibleLabels = () => [...win.document.querySelectorAll('#isa-alert-settings .isa-alert-inbox')]
    .filter(row => row.style.display !== 'none')
    .map(row => row.querySelector('span').textContent);
  filter.value = 'and 1';
  filter.dispatchEvent(new win.Event('input'));
  assert.deepEqual(visibleLabels().sort(), ['Brand 1', 'Brand 10', 'Brand 11', 'Brand 12']);
  filter.value = '';
  filter.dispatchEvent(new win.Event('input'));
  assert.ok(visibleLabels().length >= 13, 'clearing the filter shows every inbox again');
  win.close();
});

test('the default-inbox hint shows only while the roster still matches the built-in fallback', async () => {
  const { win, changeListeners } = loadSettingsUi({
    signatureData: { alertRoster: [] }
  });
  await settled();
  const hint = win.document.querySelector('#isa-alert-settings [data-isa="hint"]');
  assert.equal(hint.hidden, false, 'still on the fallback roster, so the hint explains that');
  changeListeners.forEach(fn => fn({
    isaAlertRoster: { newValue: [{ teamId: '900555', label: 'Urgent Discovered' }] }
  }, 'local'));
  assert.equal(hint.hidden, true, 'a real discovered roster replaces the fallback, so the hint goes away');
  win.close();
});

test('a selected inbox the roster has not discovered yet still appears in the compact summary', async () => {
  const { win } = loadSettingsUi({
    mode: 'compact',
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: ['90067313'] }
  });
  await settled();
  const summary = win.document.querySelector('#isa-alert-settings [data-isa="summary"]');
  assert.match(summary.querySelector('p').textContent, /90067313/);
  win.close();
});

test('the expanded body dims via a CSS class while disabled', async () => {
  const { win } = loadSettingsUi({ mode: 'expanded' });
  await settled();
  const body = win.document.querySelector('#isa-alert-settings [data-isa="body"]');
  assert.ok(body.classList.contains('isa-alert-disabled'), 'disabled while the master switch is off');
  win.document.querySelector('#isa-alert-settings [data-isa="enabled"]').click();
  assert.equal(body.classList.contains('isa-alert-disabled'), false, 'the dimming clears once alerts are enabled');
  win.close();
});

test('the preview button plays the selected sound, and the test button reports each outcome distinctly', async () => {
  const { win } = loadSettingsUi({ mode: 'expanded' });
  await settled();
  const panel = win.document.querySelector('#isa-alert-settings');
  panel.querySelector('[data-isa="enabled"]').click();
  const played = [];
  win.ISA_ALERT_SOUNDS.play = id => played.push(id);
  panel.querySelector('[data-isa="sound"]').value = 'marimba';
  panel.querySelector('[data-isa="preview"]').click();
  assert.deepEqual(played, ['marimba'], 'the preview button must actually call play()');

  win.chrome.runtime.sendMessage = (msg, cb) => cb({ level: 'unavailable' });
  panel.querySelector('[data-isa="test"]').click();
  const status = panel.querySelector('[data-isa="testStatus"]');
  assert.match(status.textContent, /cannot show notifications/);
  assert.ok(status.classList.contains('isa-alert-test-bad'));

  win.chrome.runtime.sendMessage = (msg, cb) => cb({ level: 'denied' });
  panel.querySelector('[data-isa="test"]').click();
  assert.match(status.textContent, /Notifications are off/);
  assert.ok(status.classList.contains('isa-alert-test-bad'));

  win.chrome.runtime.sendMessage = (msg, cb) => cb({ level: 'granted', ok: true });
  panel.querySelector('[data-isa="test"]').click();
  assert.match(status.textContent, /^Test sent\./);
  assert.equal(status.classList.contains('isa-alert-test-bad'), false, 'a successful test must not be flagged as an error');
  win.close();
});

test('a failed load leaves the compact summary stuck unless it re-renders after the failure', async () => {
  const { win } = loadSettingsUi({ mode: 'compact', failGet: true });
  await settled();
  const summary = win.document.querySelector('#isa-alert-settings [data-isa="summary"]');
  assert.equal(summary.textContent.trim(), 'Selection unavailable.');
  win.close();
});

test('a synchronous storage.get throw still reports the load failure', async () => {
  const { win } = loadSettingsUi({ throwGet: true });
  await settled();
  const panel = win.document.querySelector('#isa-alert-settings');
  assert.match(panel.querySelector('[data-isa="storageStatus"]').textContent, /Could not load/);
  win.close();
});

test('no storage API at all still updates the compact summary to say so', async () => {
  const { win } = loadSettingsUi({ mode: 'compact', noStorage: true });
  await settled();
  const summary = win.document.querySelector('#isa-alert-settings [data-isa="summary"]');
  assert.equal(summary.textContent.trim(), 'Selection unavailable.');
  win.close();
});

test('a storage change notification never crashes on an unrelated or unusable sound key', async () => {
  const { win: compactWin, changeListeners: compactListeners } = loadSettingsUi({ mode: 'compact' });
  await settled();
  const compactSwitch = compactWin.document.querySelector('#isa-alert-settings [data-isa="enabled"]');
  assert.doesNotThrow(() => {
    compactListeners.forEach(fn => fn({ isaAlertSound: { newValue: 'marimba' }, isaAlertEnabled: { newValue: true } }, 'local'));
  });
  assert.equal(compactSwitch.checked, true, 'the enabled change still applies even though compact has no sound control');
  compactWin.close();

  const { win: expandedWin, changeListeners: expandedListeners } = loadSettingsUi({ mode: 'expanded' });
  await settled();
  const expandedSwitch = expandedWin.document.querySelector('#isa-alert-settings [data-isa="enabled"]');
  assert.doesNotThrow(() => {
    expandedListeners.forEach(fn => fn({ isaAlertEnabled: { newValue: true } }, 'local'));
  });
  assert.equal(expandedSwitch.checked, true, 'a change to an unrelated key must not crash on a missing sound entry');
  expandedWin.close();
});

test('a storage change to Your inbox reflects the exact boolean value it was set to', async () => {
  const { win, changeListeners } = loadSettingsUi();
  await settled();
  const yourInbox = () => win.document.querySelector('#isa-alert-settings [data-isa="inboxes"] input[data-isa-your-inbox]');
  assert.equal(yourInbox().checked, true, 'default on before any change arrives');
  changeListeners.forEach(fn => fn({ isaAlertYourInbox: { newValue: false } }, 'local'));
  assert.equal(yourInbox().checked, false, 'an explicit false must turn the row off');
  changeListeners.forEach(fn => fn({ isaAlertYourInbox: { newValue: true } }, 'local'));
  assert.equal(yourInbox().checked, true, 'an explicit true must turn the row back on');
  win.close();
});

const GROUPED_DATA = {
  alertRoster: [
    { teamId: '900101', label: 'Urgent Alderpoint' },
    { teamId: '90005357', label: 'Urgent Southside' },
    { teamId: '900102', label: 'Urgent Brightwell' },
    { teamId: '90005385', label: 'Urgent Harbor' }
  ],
  alertGroups: [
    { label: 'Northside', ids: ['900101'], detail: ['Orchard Kitchen', 'Quayside Fashion'] },
    { label: 'Southside', ids: ['90005357'], detail: ['Saltmarsh Crafts', 'Marlowe Books'] },
    { label: 'alderpoint', ids: ['900102'], detail: [] }
  ]
};
const groupBox = (win, id, label) => [...win.document.querySelectorAll(`#${id} [data-isa="inboxes"] .isa-alert-inbox`)]
  .find(row => row.querySelector('.isa-alert-name').textContent === label).querySelector('input');
