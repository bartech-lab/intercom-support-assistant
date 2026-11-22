'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const ROOT = path.join(__dirname, '..', '..', 'src');
const SHARED_RUNTIME_SRC = fs.readFileSync(path.join(ROOT, 'shared-runtime.js'), 'utf8');
const SUPPORT_TOOLS_SRC = fs.readFileSync(path.join(ROOT, 'support-tools-ui.js'), 'utf8');
const MIN = 60000;
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function loadPacing() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  unrefWindowTimers(dom.window);
  const context = dom.getInternalVMContext();
  const listeners = [];
  const store = {};
  dom.window.chrome = {
    runtime: { lastError: null },
    storage: {
      onChanged: { addListener: fn => listeners.push(fn) },
      local: {
        get(defaults, cb) {
          const out = {};
          Object.keys(defaults).forEach(key => { out[key] = key in store ? store[key] : defaults[key]; });
          cb(out);
        }
      }
    }
  };
  vm.runInContext(SHARED_RUNTIME_SRC, context, { filename: 'shared-runtime.js' });
  const change = changes => {
    Object.keys(changes).forEach(key => { store[key] = changes[key].newValue; });
    listeners.forEach(fn => fn(changes, 'local'));
  };
  return { win: dom.window, run: code => vm.runInContext(code, context), store, change };
}

function pacer(initial = {}) {
  const env = loadPacing();
  Object.assign(env.store, initial);
  const clock = { now: 1000000 };
  const calls = [];
  env.win.__clock = clock;
  env.win.__onRepeat = (key, n) => calls.push([String(key), n]);
  env.pacing = env.run('createAlertPacing({ now: () => window.__clock.now, onRepeat: (k, n) => window.__onRepeat(k, n) })');
  env.clock = clock;
  env.calls = calls;
  env.pacing.connect(env.win.chrome.storage.local);
  return env;
}

const withMinutes = value => ({ isaAlertRepeat: true, isaAlertRepeatMinutes: value });

function firesAt(env, ms) {
  env.pacing.arm('a');
  env.clock.now += ms - 1;
  env.pacing.settle(['a']);
  const early = env.calls.length;
  env.clock.now += 1;
  env.pacing.settle(['a']);
  return { early, onTime: env.calls.length };
}

for (const minutes of [1, 2, 3, 5, 10]) {
  test(`${minutes} minute interval: no repeat 1 ms early, one repeat exactly on time`, () => {
    const result = firesAt(pacer(withMinutes(minutes)), minutes * MIN);
    assert.equal(result.early, 0);
    assert.equal(result.onTime, 1);
  });
}

test('10 minute interval: silent at 3 minutes and at 9 minutes 59 seconds, rings at 10 minutes', () => {
  const env = pacer(withMinutes(10));
  env.pacing.arm('a');
  env.clock.now += 3 * MIN;
  env.pacing.settle(['a']);
  env.clock.now += 6 * MIN + 59 * 1000;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 1000;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('1 minute interval: second repeat comes one minute after the first', () => {
  const env = pacer(withMinutes(1));
  env.pacing.arm('a');
  env.clock.now += MIN;
  env.pacing.settle(['a']);
  env.clock.now += MIN - 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
  env.clock.now += 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1], ['a', 2]]);
});

test('with the interval key absent the wait is 3 minutes', () => {
  const result = firesAt(pacer({ isaAlertRepeat: true }), 3 * MIN);
  assert.equal(result.early, 0);
  assert.equal(result.onTime, 1);
});

for (const bad of [0, 61, 600, -1, '1', '4', '10', null, NaN, 1.5, true]) {
  test(`stored interval ${String(typeof bad === 'string' ? JSON.stringify(bad) : bad)} behaves as 3 minutes`, () => {
    const result = firesAt(pacer(withMinutes(bad)), 3 * MIN);
    assert.equal(result.early, 0);
    assert.equal(result.onTime, 1);
  });
}

for (const minutes of [4, 7, 12, 45, 60]) {
  test(`custom ${minutes} minute interval: no repeat 1 ms early, one repeat exactly on time`, () => {
    const result = firesAt(pacer(withMinutes(minutes)), minutes * MIN);
    assert.equal(result.early, 0);
    assert.equal(result.onTime, 1);
  });
}

test('custom 4 minute interval: silent at 3 minutes 59.999 seconds, rings at 4 minutes', () => {
  const env = pacer(withMinutes(4));
  env.pacing.arm('a');
  env.clock.now += 4 * MIN - 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('custom 60 minute interval: silent at 59 minutes 59.999 seconds, rings at 60 minutes', () => {
  const env = pacer(withMinutes(60));
  env.pacing.arm('a');
  env.clock.now += 60 * MIN - 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('custom 7 minute interval does not fire at 3 minutes', () => {
  const env = pacer(withMinutes(7));
  env.pacing.arm('a');
  env.clock.now += 3 * MIN;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
});

test('interval 61 behaves as 3 minutes and does not wait 61', () => {
  const env = pacer(withMinutes(61));
  env.pacing.arm('a');
  env.clock.now += 3 * MIN;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('interval 0 behaves as 3 minutes and does not fire immediately', () => {
  const env = pacer(withMinutes(0));
  env.pacing.arm('a');
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 3 * MIN;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('changing to a custom 7 minute interval through storage applies to the next check', () => {
  const env = pacer(withMinutes(1));
  env.pacing.arm('a');
  env.clock.now += 6 * MIN;
  env.change({ isaAlertRepeatMinutes: { newValue: 7 } });
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += MIN;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('changing from a custom 7 minute interval to 1 through storage applies to the next check', () => {
  const env = pacer(withMinutes(7));
  env.pacing.arm('a');
  env.clock.now += MIN;
  env.change({ isaAlertRepeatMinutes: { newValue: 1 } });
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('changing the interval through storage while a ring is armed applies to the next check', () => {
  const env = pacer(withMinutes(10));
  env.pacing.arm('a');
  env.clock.now += MIN + 1000;
  env.change({ isaAlertRepeatMinutes: { newValue: 1 } });
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('lengthening the interval through storage holds back a repeat that would have been due', () => {
  const env = pacer(withMinutes(1));
  env.pacing.arm('a');
  env.clock.now += MIN;
  env.change({ isaAlertRepeatMinutes: { newValue: 10 } });
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 9 * MIN;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('an invalid value arriving through storage falls back to 3 minutes', () => {
  const env = pacer(withMinutes(10));
  env.change({ isaAlertRepeatMinutes: { newValue: 61 } });
  const result = firesAt(env, 3 * MIN);
  assert.equal(result.early, 0);
  assert.equal(result.onTime, 1);
});

test('removing the interval key through storage goes back to 3 minutes', () => {
  const env = pacer(withMinutes(10));
  env.change({ isaAlertRepeatMinutes: { newValue: undefined } });
  const result = firesAt(env, 3 * MIN);
  assert.equal(result.early, 0);
  assert.equal(result.onTime, 1);
});

test('a non-default interval still stops after 3 repeats', () => {
  const env = pacer(withMinutes(5));
  env.pacing.arm('a');
  for (let i = 0; i < 6; i += 1) {
    env.clock.now += 5 * MIN;
    env.pacing.settle(['a']);
  }
  assert.deepEqual(env.calls, [['a', 1], ['a', 2], ['a', 3]]);
});

test('a non-default interval does not fire at the default 3 minutes', () => {
  const env = pacer(withMinutes(5));
  env.pacing.arm('a');
  env.clock.now += 3 * MIN;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
});

test('the interval is ignored while repeat is off', () => {
  const env = pacer({ isaAlertRepeatMinutes: 1 });
  env.pacing.arm('a');
  env.clock.now += 20 * MIN;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
});

function loadUi({ store = {}, compact = false } = {}) {
  const attr = compact ? ' data-isa-compact="true"' : '';
  const dom = new JSDOM(`<!doctype html><html><body><div id="isa-alert-pacing"${attr}></div></body></html>`, {
    url: 'https://example.test/popup',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  unrefWindowTimers(win);
  const writes = [];
  const listeners = [];
  win.chrome = {
    runtime: { lastError: null },
    storage: {
      onChanged: { addListener: fn => listeners.push(fn) },
      local: {
        get(defaults, callback) {
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => { result[key] = key in store ? store[key] : fallback; });
          callback(result);
        },
        set(items, callback) {
          writes.push(JSON.parse(JSON.stringify(items)));
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    }
  };
  const ctx = dom.getInternalVMContext();
  for (const file of ['field-input.js', 'alert-sounds.js', 'alert-settings-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return { win, writes, store, listeners, doc: win.document };
}

const SELECT = 'select[data-isa="repeatMinutes"]';
const pick = (env, selector) => env.doc.querySelector(`#isa-alert-pacing ${selector}`);
const choose = (env, value) => {
  const select = pick(env, SELECT);
  select.value = value;
  select.dispatchEvent(new env.win.Event('change', { bubbles: true }));
};

const CUSTOM = 'input[data-isa="repeatCustom"]';
const ROW = '[data-isa="repeatCustomRow"]';
const ERROR_TEXT = 'Enter a whole number of minutes from 1 to 60.';
const block = env => env.doc.getElementById('isa-alert-pacing');
const typeCustom = (env, text) => {
  const input = pick(env, CUSTOM);
  input.value = text;
  input.dispatchEvent(new env.win.Event('change', { bubbles: true }));
};
const external = (env, value) => env.listeners.forEach(fn => fn({ isaAlertRepeatMinutes: { newValue: value } }, 'local'));

test('the interval select offers exactly the presets and custom, in order', async () => {
  const env = loadUi();
  await settled();
  const values = [...pick(env, SELECT).options].map(option => option.value);
  assert.deepEqual(values, ['1', '2', '3', '5', '10', 'custom']);
});

test('the custom field sits inside the custom row', async () => {
  const env = loadUi();
  await settled();
  assert.ok(pick(env, ROW));
  assert.ok(pick(env, ROW).contains(pick(env, CUSTOM)));
});

for (const preset of [1, 2, 3, 5, 10]) {
  test(`stored preset ${preset} selects it and hides the custom row`, async () => {
    const env = loadUi({ store: { isaAlertRepeatMinutes: preset } });
    await settled();
    assert.equal(pick(env, SELECT).value, String(preset));
    assert.equal(pick(env, ROW).hidden, true);
  });
}

for (const custom of [7, 45, 4, 60]) {
  test(`stored custom ${custom} selects custom, shows the row and fills the field`, async () => {
    const env = loadUi({ store: { isaAlertRepeatMinutes: custom } });
    await settled();
    assert.equal(pick(env, SELECT).value, 'custom');
    assert.equal(pick(env, ROW).hidden, false);
    assert.equal(pick(env, CUSTOM).value, String(custom));
  });
}

test('choosing custom shows the row, writes nothing and holds the current minutes', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  choose(env, 'custom');
  await settled();
  assert.equal(pick(env, ROW).hidden, false);
  assert.deepEqual(env.writes, []);
  assert.equal(pick(env, CUSTOM).value, '3');
});

test('choosing custom while 10 is stored puts 10 in the field without writing', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true, isaAlertRepeatMinutes: 10 } });
  await settled();
  choose(env, 'custom');
  await settled();
  assert.deepEqual(env.writes, []);
  assert.equal(pick(env, CUSTOM).value, '10');
});

test('a valid custom number is written as a number under only that key', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  choose(env, 'custom');
  typeCustom(env, '7');
  await settled();
  assert.deepEqual(env.writes, [{ isaAlertRepeatMinutes: 7 }]);
  assert.equal(typeof env.writes[0].isaAlertRepeatMinutes, 'number');
});

for (const edge of ['1', '60', '45']) {
  test(`custom ${edge} is accepted and saved`, async () => {
    const env = loadUi({ store: { isaAlertRepeat: true } });
    await settled();
    choose(env, 'custom');
    typeCustom(env, edge);
    await settled();
    assert.deepEqual(env.writes, [{ isaAlertRepeatMinutes: Number(edge) }]);
    assert.equal(pick(env, CUSTOM).getAttribute('aria-invalid'), null);
  });
}

test('typing a preset number into the open custom field saves it and keeps custom shown', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  choose(env, 'custom');
  typeCustom(env, '5');
  await settled();
  assert.deepEqual(env.writes, [{ isaAlertRepeatMinutes: 5 }]);
  assert.equal(pick(env, SELECT).value, 'custom');
  assert.equal(pick(env, ROW).hidden, false);
});

for (const bad of ['0', '61', '', 'abc', '1.5', '-3']) {
  test(`custom input ${JSON.stringify(bad)} writes nothing and is flagged`, async () => {
    const env = loadUi({ store: { isaAlertRepeat: true } });
    await settled();
    choose(env, 'custom');
    typeCustom(env, bad);
    await settled();
    assert.deepEqual(env.writes, []);
    assert.equal(pick(env, CUSTOM).getAttribute('aria-invalid'), 'true');
    assert.ok(block(env).textContent.includes(ERROR_TEXT));
  });
}

test('a valid entry after an invalid one clears the flag and saves', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  choose(env, 'custom');
  typeCustom(env, '61');
  await settled();
  assert.equal(pick(env, CUSTOM).getAttribute('aria-invalid'), 'true');
  typeCustom(env, '20');
  await settled();
  assert.equal(pick(env, CUSTOM).hasAttribute('aria-invalid'), false);
  assert.deepEqual(env.writes, [{ isaAlertRepeatMinutes: 20 }]);
});

test('choosing a preset after custom was open hides the row and writes the preset number', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  choose(env, 'custom');
  typeCustom(env, '7');
  await settled();
  choose(env, '2');
  await settled();
  assert.equal(pick(env, ROW).hidden, true);
  assert.deepEqual(env.writes[env.writes.length - 1], { isaAlertRepeatMinutes: 2 });
  assert.equal(typeof env.writes[env.writes.length - 1].isaAlertRepeatMinutes, 'number');
});

test('choosing a preset while custom is open but nothing was typed writes the preset', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  choose(env, 'custom');
  choose(env, '10');
  await settled();
  assert.equal(pick(env, ROW).hidden, true);
  assert.deepEqual(env.writes, [{ isaAlertRepeatMinutes: 10 }]);
});

test('the custom field is disabled while repeat is off and enabled once repeat is on', async () => {
  const env = loadUi();
  await settled();
  assert.equal(pick(env, CUSTOM).disabled, true);
  pick(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(pick(env, CUSTOM).disabled, false);
  assert.equal(pick(env, SELECT).disabled, false);
  pick(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(pick(env, CUSTOM).disabled, true);
  assert.equal(pick(env, SELECT).disabled, true);
});

test('the custom field starts enabled when repeat is stored on with a custom value', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true, isaAlertRepeatMinutes: 7 } });
  await settled();
  assert.equal(pick(env, CUSTOM).disabled, false);
  assert.equal(pick(env, SELECT).disabled, false);
});

test('an external change to a custom value flips the select to custom and fills the row', async () => {
  const env = loadUi({ store: { isaAlertRepeatMinutes: 2 } });
  await settled();
  external(env, 12);
  assert.equal(pick(env, SELECT).value, 'custom');
  assert.equal(pick(env, ROW).hidden, false);
  assert.equal(pick(env, CUSTOM).value, '12');
});

test('an external change to a preset shows the preset and hides the row', async () => {
  const env = loadUi({ store: { isaAlertRepeatMinutes: 12 } });
  await settled();
  external(env, 5);
  assert.equal(pick(env, SELECT).value, '5');
  assert.equal(pick(env, ROW).hidden, true);
});

test('an external change to an invalid value shows preset 3 and hides the row', async () => {
  const env = loadUi({ store: { isaAlertRepeatMinutes: 12 } });
  await settled();
  external(env, 61);
  assert.equal(pick(env, SELECT).value, '3');
  assert.equal(pick(env, ROW).hidden, true);
});

test('the interval select shows the stored value', async () => {
  const env = loadUi({ store: { isaAlertRepeatMinutes: 10 } });
  await settled();
  assert.equal(pick(env, SELECT).value, '10');
});

test('the interval select shows 3 when nothing is stored', async () => {
  const env = loadUi();
  await settled();
  assert.equal(pick(env, SELECT).value, '3');
});

for (const bad of [0, 61, -1, '5', '4', null, 600, 2.5, true]) {
  test(`the interval select shows 3 with a hidden row for the invalid stored value ${JSON.stringify(bad)}`, async () => {
    const env = loadUi({ store: { isaAlertRepeatMinutes: bad } });
    await settled();
    assert.equal(pick(env, SELECT).value, '3');
    assert.equal(pick(env, ROW).hidden, true);
  });
}

test('choosing 5 writes the number 5 and nothing else', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  choose(env, '5');
  await settled();
  assert.deepEqual(env.writes, [{ isaAlertRepeatMinutes: 5 }]);
  assert.equal(typeof env.writes[0].isaAlertRepeatMinutes, 'number');
});

test('choosing 1 writes the number 1', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true, isaAlertRepeatMinutes: 10 } });
  await settled();
  choose(env, '1');
  await settled();
  assert.equal(env.store.isaAlertRepeatMinutes, 1);
});

test('the interval select is disabled while repeat is off and enabled once repeat is on', async () => {
  const env = loadUi();
  await settled();
  assert.equal(pick(env, SELECT).disabled, true);
  pick(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(pick(env, SELECT).disabled, false);
  pick(env, '[data-isa="repeat"]').click();
  await settled();
  assert.equal(pick(env, SELECT).disabled, true);
});

test('the interval select starts enabled when repeat is stored on', async () => {
  const env = loadUi({ store: { isaAlertRepeat: true } });
  await settled();
  assert.equal(pick(env, SELECT).disabled, false);
});

test('compact mode has neither the interval select nor the custom field', async () => {
  const env = loadUi({ compact: true, store: { isaAlertRepeat: true, isaAlertRepeatMinutes: 7 } });
  await settled();
  assert.equal(pick(env, SELECT), null);
  assert.equal(env.doc.querySelector('[data-isa="repeatMinutes"]'), null);
  assert.equal(env.doc.querySelector('[data-isa="repeatCustom"]'), null);
});

test('an interval changed elsewhere updates the shown value', async () => {
  const env = loadUi();
  await settled();
  env.listeners.forEach(fn => fn({ isaAlertRepeatMinutes: { newValue: 2 } }, 'local'));
  assert.equal(pick(env, SELECT).value, '2');
  env.listeners.forEach(fn => fn({ isaAlertRepeatMinutes: { newValue: undefined } }, 'local'));
  assert.equal(pick(env, SELECT).value, '3');
});

test('an interval change from another storage area is ignored', async () => {
  const env = loadUi();
  await settled();
  env.listeners.forEach(fn => fn({ isaAlertRepeatMinutes: { newValue: 10 } }, 'sync'));
  assert.equal(pick(env, SELECT).value, '3');
});

const BACKUP_IDS = ['isa-support-tools', 'isa-settings-backup', 'isa-debug-flags'];

function makeStore(initial) {
  const local = Object.assign({}, initial);
  return {
    local: {
      get(query, callback) {
        if (query === null || query === undefined) {
          callback(Object.assign({}, local));
          return;
        }
        const keys = Array.isArray(query) ? query : Object.keys(query);
        const picked = {};
        keys.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(local, key)) picked[key] = local[key];
        });
        callback(picked);
      },
      set(values, callback) {
        Object.keys(values).forEach((key) => { local[key] = values[key]; });
        if (callback) callback();
      }
    },
    session: { get(query, callback) { callback({}); }, set(values, callback) { if (callback) callback(); } },
    onChanged: { addListener: () => {} },
    data: { local }
  };
}

async function loadBackup(initial = {}) {
  const markup = BACKUP_IDS.map(id => `<div id="${id}" data-isa-expanded="true"></div>`).join('');
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: 'https://example.test/preview-page.html',
    runScripts: 'outside-only'
  });
  const win = unrefWindowTimers(dom.window);
  const store = makeStore(initial);
  win.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '2.0.1', name: 'Intercom Support Assistant' }),
      sendMessage(message, callback) { callback({ ok: true }); }
    },
    storage: store
  };
  win.SIGNATURE_DATA = { companies: { Alderpoint: {} } };
  const saved = [];
  const blobs = new Map();
  win.URL.createObjectURL = (blob) => {
    const url = `blob:test-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  win.URL.revokeObjectURL = () => {};
  win.Blob = class Blob {
    constructor(parts) { this.text = parts.join(''); }
  };
  win.HTMLAnchorElement.prototype.click = function click() {
    if (this.download) {
      const blob = blobs.get(this.href);
      saved.push({ filename: this.download, content: blob ? blob.text : '' });
    }
  };
  vm.runInContext(SUPPORT_TOOLS_SRC, dom.getInternalVMContext(), { filename: 'support-tools-ui.js' });
  await settled();
  const card = win.document.getElementById('isa-settings-backup');
  return { win, store, saved, card, pick: hook => card.querySelector(`[data-isa="${hook}"]`) };
}

async function importText(ui, text) {
  const input = ui.pick('file');
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

async function exportPayload(ui) {
  ui.pick('export').dispatchEvent(new ui.win.MouseEvent('click', { bubbles: true }));
  await settled();
  await settled();
  assert.equal(ui.saved.length, 1);
  return JSON.parse(ui.saved[0].content);
}

const backupPayload = settings => JSON.stringify({ schema: 1, exportedAt: '2026-09-09T07:15:00.000Z', settings });

test('an exported backup carries the stored repeat interval', async () => {
  const ui = await loadBackup({ isaAlertRepeat: true, isaAlertRepeatMinutes: 5 });
  const payload = await exportPayload(ui);
  assert.equal(payload.settings.isaAlertRepeatMinutes, 5);
});

test('the repeat interval survives an export and import round trip', async () => {
  const source = await loadBackup({ isaAlertRepeatMinutes: 10 });
  const text = JSON.stringify(await exportPayload(source));
  const target = await loadBackup({});
  await importText(target, text);
  assert.equal(target.store.data.local.isaAlertRepeatMinutes, 10);
});

test('an imported numeric repeat interval is stored without a wrong-type note', async () => {
  const ui = await loadBackup({});
  await importText(ui, backupPayload({ isaAlertRepeatMinutes: 2 }));
  assert.equal(ui.store.data.local.isaAlertRepeatMinutes, 2);
  assert.doesNotMatch(ui.pick('result').textContent, /wrong value type/);
});

for (const bad of ['3', true, null, [3]]) {
  test(`an imported repeat interval of ${JSON.stringify(bad)} is skipped as the wrong value type`, async () => {
    const ui = await loadBackup({ isaAlertRepeatMinutes: 5 });
    await importText(ui, backupPayload({ isaAlertRepeatMinutes: bad, isaAlertSound: 'chime' }));
    assert.equal(ui.store.data.local.isaAlertRepeatMinutes, 5);
    assert.match(ui.pick('result').textContent, /wrong value type: isaAlertRepeatMinutes/);
    assert.equal(ui.store.data.local.isaAlertSound, 'chime');
  });
}
