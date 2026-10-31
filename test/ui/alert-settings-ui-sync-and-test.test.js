'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

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

function load({ signatureData = DATA, store = {}, noStorage = false, deferGet = false, readyState = null, noSendMessage = false, attrs = 'data-isa-expanded="true"' } = {}) {
  const changeListeners = [];
  const writes = [];
  const pendingReads = [];
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="isa-alert-settings" ${attrs}></div>
  </body></html>`, { url: 'https://example.test/popup', runScripts: 'outside-only' });
  const win = dom.window;
  if (readyState) Object.defineProperty(win.document, 'readyState', { configurable: true, get: () => readyState });
  win.chrome = {
    storage: noStorage ? {} : {
      onChanged: { addListener(listener) { changeListeners.push(listener); } },
      local: {
        get(defaults, callback) {
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
    },
    runtime: { lastError: null }
  };
  win.SIGNATURE_DATA = signatureData;
  const ctx = dom.getInternalVMContext();
  const run = () => {
    for (const file of ['alert-sounds.js', 'alert-settings-ui.js']) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
    }
  };
  run();
  const panel = win.document.querySelector('#isa-alert-settings');
  return { win, panel, writes, store, changeListeners, pendingReads };
}

const fire = (listeners, changes, area) => listeners.forEach(fn => fn(changes, area));
const soundSelect = panel => panel.querySelector('[data-isa="sound"]');
const inboxValues = panel => [...panel.querySelectorAll('[data-isa="inboxes"] input[type="checkbox"]:not([data-isa-your-inbox])')]
  .filter(cb => cb.checked).map(cb => cb.value);
const testStatus = panel => panel.querySelector('[data-isa="testStatus"]');
const clickTest = panel => panel.querySelector('[data-isa="test"]').click();

test('sync: a sound change from another page moves the select, and a removed value shows the default', async () => {
  const { win, panel, changeListeners } = load({ store: { isaAlertSound: 'marimba' } });
  await settled();
  assert.equal(soundSelect(panel).value, 'marimba');
  fire(changeListeners, { isaAlertSound: { newValue: 'blink-blink' } }, 'local');
  assert.equal(soundSelect(panel).value, 'blink-blink');
  fire(changeListeners, { isaAlertSound: { newValue: 'marimba' } }, 'local');
  assert.equal(soundSelect(panel).value, 'marimba');
  fire(changeListeners, { isaAlertSound: {} }, 'local');
  assert.equal(soundSelect(panel).value, win.ISA_ALERT_SOUNDS.defaultId);
  win.close();
});

test('sync: a sound change in the sync area changes nothing', async () => {
  const { win, panel, changeListeners } = load({ store: { isaAlertSound: 'marimba' } });
  await settled();
  fire(changeListeners, { isaAlertSound: { newValue: 'blink-blink' } }, 'sync');
  assert.equal(soundSelect(panel).value, 'marimba');
  win.close();
});

test('sync: inbox selection changes update the checkboxes, and a non-array value clears them', async () => {
  const { win, panel, changeListeners } = load({ store: { isaAlertEnabledInboxes: ['90005450'] } });
  await settled();
  assert.deepEqual(inboxValues(panel), ['90005450']);
  fire(changeListeners, { isaAlertEnabledInboxes: { newValue: ['9005326'] } }, 'local');
  assert.deepEqual(inboxValues(panel), ['9005326']);
  fire(changeListeners, { isaAlertEnabledInboxes: { newValue: ['90005450', '9005326'] } }, 'local');
  assert.deepEqual(inboxValues(panel), ['90005450', '9005326']);
  fire(changeListeners, { isaAlertEnabledInboxes: { newValue: 'oops' } }, 'local');
  assert.deepEqual(inboxValues(panel), []);
  win.close();
});

test('sync: an inbox change in the sync area changes nothing', async () => {
  const { win, panel, changeListeners } = load({ store: { isaAlertEnabledInboxes: ['90005450'] } });
  await settled();
  fire(changeListeners, { isaAlertEnabledInboxes: { newValue: ['9005326'] } }, 'sync');
  assert.deepEqual(inboxValues(panel), ['90005450']);
  win.close();
});

test('sync: the enabled flag turns the switch on and back off, in the local area only', async () => {
  const { win, panel, changeListeners } = load();
  await settled();
  const sw = panel.querySelector('[data-isa="enabled"]');
  fire(changeListeners, { isaAlertEnabled: { newValue: true } }, 'local');
  assert.equal(sw.checked, true);
  fire(changeListeners, { isaAlertEnabled: { newValue: false } }, 'sync');
  assert.equal(sw.checked, true);
  fire(changeListeners, { isaAlertEnabled: { newValue: false } }, 'local');
  assert.equal(sw.checked, false);
  win.close();
});

test('test button: sends exactly { type: "alert-test" } once and shows Testing… until the reply', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true } });
  await settled();
  const sent = [];
  let reply;
  win.chrome.runtime.sendMessage = (msg, cb) => { sent.push(msg); reply = cb; };
  clickTest(panel);
  assert.deepEqual(plain(sent), [{ type: 'alert-test' }]);
  assert.equal(testStatus(panel).textContent, 'Testing…');
  reply({ level: 'granted', ok: true });
  assert.notEqual(testStatus(panel).textContent, 'Testing…');
  win.close();
});

const OUTCOMES = [
  ['no response', undefined, /^This browser cannot show notifications\.$/, true],
  ['level unavailable', { level: 'unavailable' }, /^This browser cannot show notifications\.$/, true],
  ['level denied', { level: 'denied' }, /^Notifications are off for this extension\./, true],
  ['ok false', { level: 'granted', ok: false }, /^Notification blocked\./, true],
  ['ok true', { level: 'granted', ok: true }, /^Test sent\./, false]
];
for (const [name, response, expected, bad] of OUTCOMES) {
  test(`test button outcome: ${name}`, async () => {
    const { win, panel } = load({ store: { isaAlertEnabled: true } });
    await settled();
    win.chrome.runtime.sendMessage = (msg, cb) => cb(response);
    clickTest(panel);
    const status = testStatus(panel);
    assert.match(status.textContent, expected);
    assert.equal(status.classList.contains('isa-alert-test-bad'), bad);
    win.close();
  });
}

test('test button: the bad marker from a failed test is cleared by a later successful test', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true } });
  await settled();
  win.chrome.runtime.sendMessage = (msg, cb) => cb({ level: 'denied' });
  clickTest(panel);
  assert.ok(testStatus(panel).classList.contains('isa-alert-test-bad'));
  win.chrome.runtime.sendMessage = (msg, cb) => cb({ level: 'granted', ok: true });
  clickTest(panel);
  assert.equal(testStatus(panel).classList.contains('isa-alert-test-bad'), false);
  assert.match(testStatus(panel).textContent, /^Test sent\./);
  win.close();
});

test('test button: without ISA_ALERT_SOUNDS.play it does not throw and still sends the message', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true } });
  await settled();
  const sent = [];
  win.chrome.runtime.sendMessage = (msg, cb) => { sent.push(msg); cb({ level: 'granted', ok: true }); };
  for (const replacement of [undefined, {}, { play: 'nope' }]) {
    win.ISA_ALERT_SOUNDS = replacement;
    assert.doesNotThrow(() => clickTest(panel));
  }
  assert.equal(sent.length, 3);
  assert.match(testStatus(panel).textContent, /^Test sent\./);
  win.close();
});

test('preview button: plays the stored sound without sending a notification test', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true, isaAlertSound: 'marimba' } });
  await settled();
  const played = [];
  const sent = [];
  win.ISA_ALERT_SOUNDS.play = (...args) => { played.push(args); };
  win.chrome.runtime.sendMessage = msg => { sent.push(msg); };
  panel.querySelector('[data-isa="preview"]').click();
  assert.deepEqual(played, [['marimba']]);
  assert.deepEqual(sent, []);
  win.close();
});

test('loading: changing the sound before the stored settings load writes nothing', async () => {
  const { win, panel, writes, pendingReads } = load({ deferGet: true });
  await settled();
  const select = soundSelect(panel);
  const other = [...select.options].map(o => o.value).find(v => v !== select.value);
  select.value = other;
  select.dispatchEvent(new win.Event('change'));
  assert.deepEqual(writes, []);
  pendingReads.forEach(fn => fn());
  await settled();
  assert.deepEqual(writes.filter(w => 'isaAlertSound' in w), []);
  win.close();
});

test('loading: after load, changing the sound writes the chosen id once', async () => {
  const { win, panel, writes } = load();
  await settled();
  const select = soundSelect(panel);
  select.value = 'marimba';
  select.dispatchEvent(new win.Event('change'));
  assert.deepEqual(plain(writes).filter(w => 'isaAlertSound' in w), [{ isaAlertSound: 'marimba' }]);
  win.close();
});

test('prune: stale stored inboxes are rewritten exactly once, and a clean selection writes nothing', async () => {
  const stale = load({ signatureData: GROUPED, store: { isaAlertEnabledInboxes: ['90005450', '90005357', 'gone'] } });
  await settled();
  await settled();
  assert.deepEqual(plain(stale.writes), [{ isaAlertEnabledInboxes: ['90005450'] }]);
  assert.deepEqual(inboxValues(stale.panel), ['90005450']);
  stale.win.close();

  const clean = load({ signatureData: GROUPED, store: { isaAlertEnabledInboxes: ['90005450'] } });
  await settled();
  assert.deepEqual(clean.writes, []);
  clean.win.close();
});

test('storage: with no chrome.storage.local the panel states that storage is unavailable', async () => {
  const { win, panel } = load({ noStorage: true });
  await settled();
  const text = [...panel.querySelectorAll('[data-isa="storageStatus"]')].map(el => el.textContent).join('|');
  assert.ok(text.includes('Alert settings storage is unavailable. Alert switches are disabled.'), text);
  win.close();
});

test('mount: while readyState is loading the panel mounts at DOMContentLoaded, not before', async () => {
  const { win, panel } = load({ readyState: 'loading' });
  assert.equal(panel.children.length, 0);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  assert.ok(panel.querySelector('[data-isa="sound"]'));
  win.close();
});

test('mount: when the document is already parsed the panel mounts synchronously', () => {
  const { win, panel } = load({ readyState: 'complete' });
  assert.ok(panel.querySelector('[data-isa="sound"]'));
  win.close();
});

test('mount: ISA_ALERT_SETTINGS.mount is exposed and mounts a late element', async () => {
  const { win } = load({ readyState: 'complete' });
  assert.equal(typeof win.ISA_ALERT_SETTINGS.mount, 'function');
  const late = win.document.createElement('div');
  late.id = 'isa-late';
  late.setAttribute('data-isa-expanded', 'true');
  win.document.body.appendChild(late);
  win.ISA_ALERT_SETTINGS.mount(late);
  assert.ok(late.querySelector('[data-isa="sound"]'));
  win.close();
});

test('loading: toggling an inbox or the main switch before the stored settings load writes nothing', async () => {
  const { win, panel, writes, pendingReads } = load({ deferGet: true });
  await settled();
  const box = panel.querySelector('[data-isa="inboxes"] input[type="checkbox"]:not([data-isa-your-inbox])');
  box.checked = !box.checked;
  box.dispatchEvent(new win.Event('change', { bubbles: true }));
  const enabled = panel.querySelector('[data-isa="enabled"]');
  enabled.checked = !enabled.checked;
  enabled.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual(writes, []);
  pendingReads.forEach(fn => fn());
  await settled();
  assert.deepEqual(writes.filter(w => 'isaAlertEnabled' in w || 'isaAlertEnabledInboxes' in w), []);
  win.close();
});

test('sound: a failed save puts the select back on the last saved sound, not the default', async () => {
  const { win, panel } = load({ store: { isaAlertSound: 'marimba' } });
  await settled();
  const select = soundSelect(panel);
  const other = [...select.options].map(o => o.value).find(v => v !== 'marimba' && v !== select.options[0].value);
  win.chrome.storage.local.set = (items, callback) => {
    win.chrome.runtime.lastError = { message: 'quota' };
    callback();
    win.chrome.runtime.lastError = null;
  };
  select.value = other;
  select.dispatchEvent(new win.Event('change'));
  assert.equal(select.value, 'marimba');
  win.close();
});

test('test button: the Testing… status is not shown in the error style', async () => {
  const { win, panel } = load({ store: { isaAlertEnabled: true } });
  await settled();
  win.chrome.runtime.sendMessage = () => {};
  clickTest(panel);
  assert.equal(testStatus(panel).textContent, 'Testing…');
  assert.equal(testStatus(panel).classList.contains('isa-alert-test-bad'), false);
  win.close();
});

test('mode: data-isa-expanded wins over data-isa-compact and keeps the sound controls', async () => {
  const { win, panel } = load({ attrs: 'data-isa-compact="true" data-isa-expanded="true"' });
  await settled();
  assert.equal(panel.getAttribute('data-isa-mode'), 'expanded');
  assert.ok(soundSelect(panel));
  win.close();
});
