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
const SEC = 1000;
const MIN = 60000;

function makeHub(clock) {
  const hub = { channels: [], posts: [], opened: [] };
  hub.channelClass = class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.listeners = [];
      hub.opened.push(name);
      hub.channels.push(this);
    }

    postMessage(data) {
      hub.posts.push({ at: clock.now, data: JSON.parse(JSON.stringify(data)), from: this });
      hub.channels.forEach(other => {
        if (other === this || other.name !== this.name) return;
        const event = { data: JSON.parse(JSON.stringify(data)) };
        if (typeof other.onmessage === 'function') other.onmessage(event);
        other.listeners.forEach(fn => fn(event));
      });
    }

    addEventListener(type, fn) {
      if (type === 'message') this.listeners.push(fn);
    }

    removeEventListener() {}

    close() {}
  };
  return hub;
}

function tab(clock, { channel, minutes = 1, repeat = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  unrefWindowTimers(dom.window);
  const store = { isaAlertRepeat: repeat, isaAlertRepeatMinutes: minutes };
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
  if (channel !== undefined) dom.window.BroadcastChannel = channel;
  const context = dom.getInternalVMContext();
  vm.runInContext(SHARED_RUNTIME_SRC, context, { filename: 'shared-runtime.js' });
  const calls = [];
  dom.window.__clock = clock;
  dom.window.__onRepeat = (key, n) => calls.push([String(key), n]);
  const pacing = vm.runInContext('createAlertPacing({ now: () => window.__clock.now, onRepeat: (k, n) => window.__onRepeat(k, n) })', context);
  pacing.connect(dom.window.chrome.storage.local);
  return { pacing, calls };
}

function setup(options) {
  const clock = { now: 1000000 };
  const hub = makeHub(clock);
  const a = tab(clock, { channel: hub.channelClass, repeat: false });
  const b = tab(clock, { channel: hub.channelClass, ...options });
  return { clock, hub, a, b };
}

function ringAfterInterval(env, keys = ['K']) {
  env.clock.now += MIN;
  env.b.pacing.settle(keys);
  env.clock.now += MIN;
  env.b.pacing.settle(keys);
  env.clock.now += MIN;
  env.b.pacing.settle(keys);
  return env.b.calls.length;
}

test('each pacing instance opens the isa-alert-seen channel', () => {
  const env = setup();
  assert.equal(env.hub.opened.filter(name => name === 'isa-alert-seen').length, 2);
});

test('control: without any viewed announcement the ring repeats', () => {
  const env = setup();
  env.b.pacing.arm('K');
  env.clock.now += MIN;
  env.b.pacing.settle(['K']);
  assert.deepEqual(env.b.calls.map(c => c[0]), ['K']);
});

test('a key viewed in another tab stops the repeat, now and later', () => {
  const env = setup();
  env.b.pacing.arm('K');
  env.a.pacing.settle([], ['K']);
  assert.equal(ringAfterInterval(env), 0);
});

test('a different viewed key does not stop the ring', () => {
  const env = setup();
  env.b.pacing.arm('K');
  env.a.pacing.settle([], ['X']);
  env.clock.now += MIN;
  env.b.pacing.settle(['K']);
  assert.deepEqual(env.b.calls.map(c => c[0]), ['K']);
});

test('after being stopped, a new arm of the same key later repeats normally', () => {
  const env = setup();
  env.b.pacing.arm('K');
  env.a.pacing.settle([], ['K']);
  env.clock.now += MIN;
  env.b.pacing.settle(['K']);
  assert.equal(env.b.calls.length, 0);
  env.b.pacing.settle([]);
  env.clock.now += 6 * SEC;
  env.b.pacing.arm('K');
  env.clock.now += MIN;
  env.b.pacing.settle(['K']);
  assert.deepEqual(env.b.calls.map(c => c[0]), ['K']);
});

test('race: arming within 5 s after the announcement gives no repeat', () => {
  const env = setup();
  env.a.pacing.settle([], ['K']);
  env.clock.now += 4 * SEC;
  env.b.pacing.arm('K');
  assert.equal(ringAfterInterval(env), 0);
});

test('race: arming more than 5 s after the last announcement repeats', () => {
  const env = setup();
  env.a.pacing.settle([], ['K']);
  env.clock.now += 5 * SEC + 1;
  env.b.pacing.arm('K');
  env.clock.now += MIN;
  env.b.pacing.settle(['K']);
  assert.deepEqual(env.b.calls.map(c => c[0]), ['K']);
});

test('a tab that keeps viewing announces a key at most once per 10 s', () => {
  const env = setup();
  for (let i = 0; i < 65; i += 1) {
    env.a.pacing.settle([], ['K']);
    env.clock.now += SEC;
  }
  const times = env.hub.posts.map(post => post.at);
  assert.equal(times.length >= 6, true);
  assert.equal(times.length <= 7, true);
  for (let i = 1; i < times.length; i += 1) assert.equal(times[i] - times[i - 1] >= 10 * SEC, true);
});

test('a ring armed 30 s into a continuous view never repeats', () => {
  const env = setup();
  const step = () => {
    env.a.pacing.settle([], ['K']);
    env.clock.now += SEC;
  };
  for (let i = 0; i < 30; i += 1) step();
  env.b.pacing.arm('K');
  for (let i = 0; i < 200; i += 1) {
    step();
    env.b.pacing.settle(['K']);
  }
  assert.equal(env.b.calls.length, 0);
});

test('malformed channel messages are ignored without throwing and do not stop a ring', () => {
  const env = setup();
  const receiver = env.hub.channels[1];
  env.b.pacing.arm('K');
  for (const bad of [null, {}, { key: 5 }, undefined, 'K', []]) {
    assert.doesNotThrow(() => {
      if (typeof receiver.onmessage === 'function') receiver.onmessage({ data: bad });
      receiver.listeners.forEach(fn => fn({ data: bad }));
    });
  }
  assert.equal(typeof receiver.onmessage === 'function' || receiver.listeners.length > 0, true);
  env.clock.now += MIN;
  env.b.pacing.settle(['K']);
  assert.deepEqual(env.b.calls.map(c => c[0]), ['K']);
});

test('without BroadcastChannel pacing still repeats and settle with viewed keys does not throw', () => {
  const clock = { now: 1000000 };
  const b = tab(clock);
  b.pacing.arm('K');
  clock.now += MIN;
  assert.doesNotThrow(() => b.pacing.settle(['K'], ['X']));
  assert.deepEqual(b.calls.map(c => c[0]), ['K']);
});

test('a BroadcastChannel constructor that throws leaves pacing working', () => {
  const clock = { now: 1000000 };
  const throwingChannel = class { constructor() { throw new Error('no channel'); } };
  let b;
  assert.doesNotThrow(() => { b = tab(clock, { channel: throwingChannel }); });
  b.pacing.arm('K');
  clock.now += MIN;
  assert.doesNotThrow(() => b.pacing.settle(['K'], ['X']));
  assert.deepEqual(b.calls.map(c => c[0]), ['K']);
});

test('settle without a viewed list still fires on time', () => {
  const env = setup();
  env.b.pacing.arm('K');
  env.clock.now += MIN - 1;
  env.b.pacing.settle(['K']);
  assert.equal(env.b.calls.length, 0);
  env.clock.now += 1;
  env.b.pacing.settle(['K']);
  assert.equal(env.b.calls.length, 1);
});

test('numeric viewed keys stop a ring armed with the string form', () => {
  const env = setup();
  env.b.pacing.arm('900201');
  env.a.pacing.settle([], [900201]);
  assert.equal(ringAfterInterval(env, ['900201']), 0);
});
