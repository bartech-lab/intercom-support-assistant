'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const SHARED_RUNTIME_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared-runtime.js'), 'utf8');
const WAIT = 60000;

function load() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  unrefWindowTimers(dom.window);
  const context = dom.getInternalVMContext();
  const store = { isaAlertRepeat: true, isaAlertRepeatMinutes: 1 };
  dom.window.chrome = {
    runtime: { lastError: null },
    storage: {
      onChanged: { addListener() {} },
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
  const clock = { now: 1000000 };
  const repeats = [];
  dom.window.__clock = clock;
  dom.window.__onRepeat = (key, n) => repeats.push([String(key), n]);
  const pacing = vm.runInContext('createAlertPacing({ now: () => window.__clock.now, onRepeat: (k, n) => window.__onRepeat(k, n) })', context);
  pacing.connect(dom.window.chrome.storage.local);
  return { pacing, clock, repeats };
}

test('a key ended as viewed while still active never repeats, at that settle or later', () => {
  const env = load();
  env.pacing.arm('K');
  env.clock.now += WAIT;
  env.pacing.settle(['K'], ['K']);
  env.clock.now += WAIT * 3;
  env.pacing.settle(['K'], []);
  env.pacing.settle(['K'], ['K']);
  assert.deepEqual(env.repeats, []);
});

test('other armed keys in the same settle still repeat on time', () => {
  const env = load();
  env.pacing.arm('A');
  env.pacing.arm('B');
  env.clock.now += WAIT;
  env.pacing.settle(['A', 'B'], ['A']);
  assert.deepEqual(env.repeats, [['B', 1]]);
});

test('a viewed key that was never armed repeats nothing even when active', () => {
  const env = load();
  env.pacing.settle(['K'], ['K']);
  env.clock.now += WAIT * 2;
  env.pacing.settle(['K'], ['K']);
  assert.deepEqual(env.repeats, []);
});

test('arming again after a viewed end repeats normally', () => {
  const env = load();
  env.pacing.arm('K');
  env.pacing.settle(['K'], ['K']);
  env.clock.now += WAIT * 2;
  env.pacing.arm('K');
  env.clock.now += WAIT;
  env.pacing.settle(['K'], []);
  assert.deepEqual(env.repeats, [['K', 1]]);
});

test('numeric viewed keys match string-armed keys', () => {
  const env = load();
  env.pacing.arm('123');
  env.clock.now += WAIT;
  env.pacing.settle(['123'], [123]);
  assert.deepEqual(env.repeats, []);
});
