'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const SHARED_RUNTIME_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared-runtime.js'), 'utf8');
const WAIT = 3 * 60 * 1000;

function load() {
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
  const run = code => vm.runInContext(code, context);
  const change = (changes, area = 'local') => {
    if (area === 'local') Object.keys(changes).forEach(key => { store[key] = changes[key].newValue; });
    listeners.forEach(fn => fn(changes, area));
  };
  return { win: dom.window, run, store, change };
}

function pacer(initial = {}) {
  const env = load();
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

const repeatOn = () => ({ isaAlertRepeat: true });

test('clock text 00:00, 07:05 and 23:59 convert to minutes since midnight', () => {
  const { run } = load();
  assert.equal(run("isaClockMinutes('00:00')"), 0);
  assert.equal(run("isaClockMinutes('07:05')"), 425);
  assert.equal(run("isaClockMinutes('23:59')"), 1439);
});

test('clock text that is not exactly HH:MM in 24-hour form gives null', () => {
  const { run } = load();
  ['24:00', '7:05', '12:60', '', '12:30 PM', '12:30:00', ' 12:30', '12:3'].forEach(text => {
    assert.equal(run(`isaClockMinutes(${JSON.stringify(text)})`), null, text);
  });
  assert.equal(run('isaClockMinutes(null)'), null);
  assert.equal(run('isaClockMinutes(undefined)'), null);
});

function quiet(run, enabled, start, end, h, m) {
  return run(`isaInQuietHours({ enabled: ${enabled}, start: ${JSON.stringify(start)}, end: ${JSON.stringify(end)} }, new Date(2026, 0, 15, ${h}, ${m}))`);
}

test('quiet hours are off unless enabled is exactly true', () => {
  const { run } = load();
  assert.equal(quiet(run, false, '09:00', '17:00', 12, 0), false);
  assert.equal(quiet(run, '"true"', '09:00', '17:00', 12, 0), false);
  assert.equal(quiet(run, 1, '09:00', '17:00', 12, 0), false);
});

test('quiet hours are off when the start or the end is invalid', () => {
  const { run } = load();
  assert.equal(quiet(run, true, '9pm', '07:00', 23, 0), false);
  assert.equal(quiet(run, true, '22:00', '25:00', 23, 0), false);
  assert.equal(quiet(run, true, null, '07:00', 23, 0), false);
});

test('quiet hours with equal start and end never match', () => {
  const { run } = load();
  assert.equal(quiet(run, true, '10:00', '10:00', 10, 0), false);
  assert.equal(quiet(run, true, '10:00', '10:00', 3, 0), false);
});

test('a same-day window includes its start and excludes its end', () => {
  const { run } = load();
  assert.equal(quiet(run, true, '09:00', '17:00', 9, 0), true);
  assert.equal(quiet(run, true, '09:00', '17:00', 16, 59), true);
  assert.equal(quiet(run, true, '09:00', '17:00', 17, 0), false);
  assert.equal(quiet(run, true, '09:00', '17:00', 8, 59), false);
});

test('a same-day window does not match at night', () => {
  const { run } = load();
  assert.equal(quiet(run, true, '09:00', '17:00', 23, 30), false);
  assert.equal(quiet(run, true, '09:00', '17:00', 0, 0), false);
});

test('an overnight window covers late evening, midnight and early morning', () => {
  const { run } = load();
  assert.equal(quiet(run, true, '22:00', '07:00', 22, 0), true);
  assert.equal(quiet(run, true, '22:00', '07:00', 23, 30), true);
  assert.equal(quiet(run, true, '22:00', '07:00', 0, 0), true);
  assert.equal(quiet(run, true, '22:00', '07:00', 6, 59), true);
});

test('an overnight window excludes its end and the daytime', () => {
  const { run } = load();
  assert.equal(quiet(run, true, '22:00', '07:00', 7, 0), false);
  assert.equal(quiet(run, true, '22:00', '07:00', 12, 0), false);
  assert.equal(quiet(run, true, '22:00', '07:00', 21, 59), false);
});

test('quiet hours accept a Date created outside the window realm', () => {
  const { win, run } = load();
  win.__d = new Date(2026, 0, 15, 23, 30);
  assert.equal(run('isaInQuietHours({ enabled: true, start: "22:00", end: "07:00" }, window.__d)'), true);
  win.__d = new Date(2026, 0, 15, 12, 0);
  assert.equal(run('isaInQuietHours({ enabled: true, start: "22:00", end: "07:00" }, window.__d)'), false);
});

test('muted while the mute timer is still in the future', () => {
  const { run } = load();
  assert.equal(run('isaAlertsMuted({ muteUntil: 2001, quietHours: { enabled: false } }, 2000)'), true);
});

test('not muted when the mute timer ends exactly now or earlier', () => {
  const { run } = load();
  assert.equal(run('isaAlertsMuted({ muteUntil: 2000, quietHours: { enabled: false } }, 2000)'), false);
  assert.equal(run('isaAlertsMuted({ muteUntil: 1999, quietHours: { enabled: false } }, 2000)'), false);
  assert.equal(run('isaAlertsMuted({ muteUntil: 0, quietHours: { enabled: false } }, 2000)'), false);
});

test('muted by quiet hours alone when the timer is not running', () => {
  const { run } = load();
  const inside = new Date(2026, 0, 15, 23, 0).getTime();
  const outside = new Date(2026, 0, 15, 12, 0).getTime();
  const pacing = '{ muteUntil: 0, quietHours: { enabled: true, start: "22:00", end: "07:00" } }';
  assert.equal(run(`isaAlertsMuted(${pacing}, ${inside})`), true);
  assert.equal(run(`isaAlertsMuted(${pacing}, ${outside})`), false);
});

test('before connect and with nothing stored, nothing is muted and nothing repeats', () => {
  const env = load();
  const clock = { now: 5000000 };
  const calls = [];
  env.win.__clock = clock;
  env.win.__onRepeat = (k, n) => calls.push([k, n]);
  const pacing = env.run('createAlertPacing({ now: () => window.__clock.now, onRepeat: (k, n) => window.__onRepeat(k, n) })');
  assert.equal(pacing.muted(), false);
  pacing.arm('a');
  clock.now += WAIT;
  pacing.settle(['a']);
  assert.deepEqual(calls, []);
  pacing.connect(env.win.chrome.storage.local);
  assert.equal(pacing.muted(), false);
  clock.now += WAIT;
  pacing.settle(['a']);
  assert.deepEqual(calls, []);
});

test('repeat on: nothing rings before 3 minutes and one repeat rings exactly at 3 minutes', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.pacing.settle(['a']);
  env.clock.now += WAIT - 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('settling again right after a repeat does not ring a second time', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.pacing.settle(['a']);
  env.clock.now += 1000;
  env.pacing.settle(['a']);
  assert.equal(env.calls.length, 1);
});

test('repeats come every 3 minutes as repeat 1, 2 and 3 and never a fourth', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  for (let i = 0; i < 3; i += 1) {
    env.clock.now += WAIT - 1;
    env.pacing.settle(['a']);
    assert.equal(env.calls.length, i, `not yet due before repeat ${i + 1}`);
    env.clock.now += 1;
    env.pacing.settle(['a']);
  }
  assert.deepEqual(env.calls, [['a', 1], ['a', 2], ['a', 3]]);
  for (let i = 0; i < 10; i += 1) {
    env.clock.now += WAIT * 5;
    env.pacing.settle(['a']);
  }
  assert.equal(env.calls.length, 3);
});

test('a key missing from one settle call never repeats again even when it comes back', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.clock.now += 60000;
  env.pacing.settle([]);
  env.clock.now += WAIT * 4;
  env.pacing.settle(['a']);
  env.clock.now += WAIT * 4;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
});

test('a key looked at after its first repeat stops repeating', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.pacing.settle([]);
  env.clock.now += WAIT * 3;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('arming an acknowledged key again starts a fresh wait and count', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.pacing.settle([]);
  env.pacing.arm('a');
  env.clock.now += WAIT - 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('arming an armed key restarts its wait', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.clock.now += WAIT - 1000;
  env.pacing.arm('a');
  env.clock.now += 1000;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += WAIT - 1000;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('arming an armed key restarts its repeat count', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1], ['a', 2], ['a', 1]]);
});

test('keys repeat independently on their own clocks', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.clock.now += 100000;
  env.pacing.arm('b');
  env.clock.now += 80000;
  env.pacing.settle(['a', 'b']);
  assert.deepEqual(env.calls, [['a', 1]]);
  env.clock.now += 100000;
  env.pacing.settle(['a', 'b']);
  assert.deepEqual(env.calls, [['a', 1], ['b', 1]]);
});

test('acknowledging one key leaves the other repeating', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.pacing.arm('b');
  env.pacing.settle(['b']);
  env.clock.now += WAIT;
  env.pacing.settle(['a', 'b']);
  assert.deepEqual(env.calls, [['b', 1]]);
});

test('a numeric key and its string form are the same key', () => {
  const env = pacer(repeatOn());
  env.pacing.arm(123);
  env.clock.now += WAIT;
  env.pacing.settle(['123']);
  assert.deepEqual(env.calls, [['123', 1]]);
});

test('settling with the string form missing acknowledges the numeric key', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('123');
  env.pacing.settle([]);
  env.clock.now += WAIT;
  env.pacing.settle([123]);
  assert.deepEqual(env.calls, []);
});

test('repeat off: nothing repeats however long the chat waits', () => {
  const env = pacer();
  env.pacing.arm('a');
  for (let i = 0; i < 5; i += 1) {
    env.clock.now += WAIT;
    env.pacing.settle(['a']);
  }
  assert.deepEqual(env.calls, []);
});

test('turning repeat on later does not ring for a ring armed while it was off', () => {
  const env = pacer();
  env.pacing.arm('a');
  env.clock.now += 10000;
  env.change({ isaAlertRepeat: { newValue: true } });
  env.clock.now += WAIT * 2;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
});

test('turning repeat off stops further repeats', () => {
  const env = pacer(repeatOn());
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.change({ isaAlertRepeat: { newValue: false } });
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  assert.equal(env.calls.length, 1);
});

test('a repeat that comes due while muted is dropped without using up a repeat', () => {
  const env = pacer({ ...repeatOn(), isaAlertMuteUntil: 1000000 + WAIT + 60000 });
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 60000;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [], 'the next repeat waits a full period after the dropped one');
});

test('after a dropped repeat the next repeat comes 3 minutes later and all 3 repeats are still available', () => {
  const env = pacer({ ...repeatOn(), isaAlertMuteUntil: 1000000 + WAIT + 60000 });
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.clock.now += 60000;
  env.pacing.settle(['a']);
  env.clock.now += WAIT - 60000 - 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
  env.clock.now += 1;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1]]);
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, [['a', 1], ['a', 2], ['a', 3]]);
});

test('a repeat that comes due during quiet hours is dropped', () => {
  const start = new Date(2026, 0, 15, 22, 30).getTime();
  const env = pacer({ ...repeatOn(), isaAlertQuietEnabled: true, isaAlertQuietStart: '22:00', isaAlertQuietEnd: '07:00' });
  env.clock.now = start;
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
});

test('muted reports the stored mute timer against the clock', () => {
  const env = pacer({ isaAlertMuteUntil: 1000000 + 5000 });
  assert.equal(env.pacing.muted(), true);
  env.clock.now += 5000;
  assert.equal(env.pacing.muted(), false);
});

test('muted reports quiet hours from storage', () => {
  const env = pacer({ isaAlertQuietEnabled: true, isaAlertQuietStart: '22:00', isaAlertQuietEnd: '07:00' });
  env.clock.now = new Date(2026, 0, 15, 23, 0).getTime();
  assert.equal(env.pacing.muted(), true);
  env.clock.now = new Date(2026, 0, 15, 12, 0).getTime();
  assert.equal(env.pacing.muted(), false);
});

test('quiet hours default to off, so a stored window alone does not mute', () => {
  const env = pacer({ isaAlertQuietStart: '22:00', isaAlertQuietEnd: '07:00' });
  env.clock.now = new Date(2026, 0, 15, 23, 0).getTime();
  assert.equal(env.pacing.muted(), false);
});

test('muted follows a mute timer change made in storage', () => {
  const env = pacer();
  assert.equal(env.pacing.muted(), false);
  env.change({ isaAlertMuteUntil: { newValue: env.clock.now + 60000 } });
  assert.equal(env.pacing.muted(), true);
  env.change({ isaAlertMuteUntil: { newValue: 0 } });
  assert.equal(env.pacing.muted(), false);
});

test('muted follows quiet hour changes made in storage', () => {
  const env = pacer();
  env.clock.now = new Date(2026, 0, 15, 23, 0).getTime();
  env.change({ isaAlertQuietEnabled: { newValue: true }, isaAlertQuietStart: { newValue: '22:00' }, isaAlertQuietEnd: { newValue: '07:00' } });
  assert.equal(env.pacing.muted(), true);
  env.change({ isaAlertQuietEnd: { newValue: '22:30' } });
  env.clock.now = new Date(2026, 0, 15, 23, 0).getTime();
  assert.equal(env.pacing.muted(), false);
});

test('storage changes from another area are ignored', () => {
  const env = pacer();
  env.change({ isaAlertMuteUntil: { newValue: env.clock.now + 60000 } }, 'sync');
  assert.equal(env.pacing.muted(), false);
  env.change({ isaAlertRepeat: { newValue: true } }, 'sync');
  env.pacing.arm('a');
  env.clock.now += WAIT;
  env.pacing.settle(['a']);
  assert.deepEqual(env.calls, []);
});
