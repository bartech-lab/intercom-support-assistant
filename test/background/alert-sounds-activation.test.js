'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'alert-sounds.js'), 'utf8');
const GESTURES = ['pointerdown', 'keydown'];

function load({
  userActivation,
  trusted = true,
  initialState = 'suspended',
  resumeChangesState = true,
  resumeRejects = false,
  throwOscillator = false
} = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;
  win.__contexts = [];
  win.__resumeCount = 0;
  win.__oscillators = 0;
  win.__started = 0;
  win.__listeners = [];
  const add = win.addEventListener.bind(win);
  const remove = win.removeEventListener.bind(win);
  const wrapped = new Map();
  const asTrusted = fn => {
    if (!trusted) return fn;
    if (!wrapped.has(fn)) {
      wrapped.set(fn, function (event) {
        const proxy = new Proxy(event, {
          get(target, key) {
            if (key === 'isTrusted') return true;
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
        return fn.call(this, proxy);
      });
    }
    return wrapped.get(fn);
  };
  win.addEventListener = (type, fn, opts) => {
    win.__listeners.push({ type, fn, capture: opts === true || !!(opts && opts.capture) });
    return add(type, asTrusted(fn), opts);
  };
  win.removeEventListener = (type, fn, opts) => {
    const capture = opts === true || !!(opts && opts.capture);
    const i = win.__listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) win.__listeners.splice(i, 1);
    return remove(type, asTrusted(fn), opts);
  };
  win.AudioContext = function FakeAudioContext() {
    win.__contexts.push(this);
    this.state = initialState;
    this.currentTime = 0;
    this.resume = () => {
      win.__resumeCount += 1;
      if (resumeChangesState) this.state = 'running';
      return resumeRejects ? Promise.reject(new Error('resume refused')) : Promise.resolve();
    };
    this.createOscillator = () => {
      if (throwOscillator) throw new Error('audio failure');
      win.__oscillators += 1;
      return {
        frequency: { setValueAtTime() {} },
        connect: node => node,
        start() { win.__started += 1; },
        stop() {}
      };
    };
    this.createGain = () => ({
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
      connect: node => node
    });
    this.destination = {};
  };
  if (userActivation !== undefined) {
    Object.defineProperty(win.navigator, 'userActivation', { value: userActivation, configurable: true });
  }
  Object.defineProperty(win.Event.prototype, 'isTrusted', { get() { return trusted; }, configurable: true });
  vm.runInContext(SRC, dom.getInternalVMContext(), { filename: 'alert-sounds.js' });
  return win;
}

function gestureListeners(win) {
  return win.__listeners.filter(l => GESTURES.includes(l.type));
}

function play(win, id) {
  const before = win.__oscillators;
  win.ISA_ALERT_SOUNDS.play(id);
  return win.__oscillators - before;
}

for (const type of GESTURES) {
  test(`S1: a trusted ${type} alone creates one context and resumes it`, () => {
    const win = load();
    assert.strictEqual(win.__contexts.length, 0);
    win.dispatchEvent(new win.Event(type));
    assert.strictEqual(win.__contexts.length, 1);
    assert.strictEqual(win.__resumeCount, 1);
  });
}

test('S1: the gesture listeners are registered before any gesture', () => {
  const win = load();
  const types = gestureListeners(win).map(l => l.type);
  assert.ok(types.includes('pointerdown'));
  assert.ok(types.includes('keydown'));
});

test('S2: after the first gesture no pointerdown or keydown listener remains', () => {
  const win = load();
  win.dispatchEvent(new win.Event('keydown'));
  assert.deepStrictEqual(gestureListeners(win), []);
});

test('S2: a later gesture of the other type creates no context and does not resume again', () => {
  const win = load();
  win.dispatchEvent(new win.Event('pointerdown'));
  win.__contexts[0].state = 'suspended';
  win.dispatchEvent(new win.Event('keydown'));
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__contexts.length, 1);
  assert.strictEqual(win.__resumeCount, 1);
});

test('S3: userActivation.isActive false ignores the gesture and keeps listeners', () => {
  const win = load({ userActivation: { isActive: false, hasBeenActive: false } });
  const before = gestureListeners(win).length;
  assert.ok(before >= 2);
  win.dispatchEvent(new win.Event('pointerdown'));
  win.dispatchEvent(new win.Event('keydown'));
  assert.strictEqual(win.__contexts.length, 0);
  assert.strictEqual(win.__resumeCount, 0);
  assert.strictEqual(gestureListeners(win).length, before);
});

test('S3: userActivation.isActive true counts even when the event is untrusted', () => {
  const win = load({ userActivation: { isActive: true, hasBeenActive: true }, trusted: false });
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__contexts.length, 1);
  assert.strictEqual(win.__resumeCount, 1);
});

test('S3: an ignored gesture does not consume the one-shot, the next active one works', () => {
  const activation = { isActive: false, hasBeenActive: false };
  const win = load({ userActivation: activation });
  win.dispatchEvent(new win.Event('keydown'));
  assert.strictEqual(win.__contexts.length, 0);
  activation.isActive = true;
  win.dispatchEvent(new win.Event('keydown'));
  assert.strictEqual(win.__contexts.length, 1);
  assert.strictEqual(win.__resumeCount, 1);
});

test('S3: without userActivation an untrusted event is ignored and listeners stay', () => {
  const win = load({ trusted: false });
  const before = gestureListeners(win).length;
  win.dispatchEvent(new win.Event('pointerdown'));
  win.dispatchEvent(new win.Event('keydown'));
  assert.strictEqual(win.__contexts.length, 0);
  assert.strictEqual(win.__resumeCount, 0);
  assert.strictEqual(gestureListeners(win).length, before);
});

for (const state of ['running', 'closed']) {
  test(`S4: a context already ${state} is not resumed`, () => {
    const win = load({ initialState: state });
    win.dispatchEvent(new win.Event('pointerdown'));
    assert.strictEqual(win.__contexts.length, 1);
    assert.strictEqual(win.__resumeCount, 0);
  });
}

test('S5: a rejected resume is swallowed and the script keeps working', async () => {
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const win = load({ resumeRejects: true, resumeChangesState: false });
    assert.doesNotThrow(() => win.dispatchEvent(new win.Event('keydown')));
    assert.strictEqual(win.__resumeCount, 1);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(unhandled, []);
    win.__contexts[0].state = 'running';
    assert.ok(play(win, 'tritone') > 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('S6: play before any gesture creates no context and no oscillator', () => {
  const win = load();
  win.ISA_ALERT_SOUNDS.play('tritone');
  assert.strictEqual(win.__contexts.length, 0);
  assert.strictEqual(win.__oscillators, 0);
  assert.strictEqual(win.__resumeCount, 0);
});

test('S7: play on a suspended context creates no oscillators', () => {
  const win = load({ resumeChangesState: false });
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__contexts[0].state, 'suspended');
  assert.strictEqual(play(win, 'tritone'), 0);
  assert.strictEqual(win.__contexts.length, 1);
});

test('S7: play on a running context creates the same positive number of oscillators each call', () => {
  const win = load();
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__contexts[0].state, 'running');
  const first = play(win, 'tritone');
  const second = play(win, 'tritone');
  assert.ok(first > 0);
  assert.strictEqual(second, first);
  assert.strictEqual(win.__started, win.__oscillators);
  assert.strictEqual(win.__contexts.length, 1);
});

test('S7: a suspended context that later becomes running starts sounding', () => {
  const win = load({ resumeChangesState: false });
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(play(win, 'tritone'), 0);
  win.__contexts[0].state = 'running';
  assert.ok(play(win, 'tritone') > 0);
});

test('S8: an unknown id plays as many oscillators as the default preset', () => {
  const win = load();
  win.dispatchEvent(new win.Event('pointerdown'));
  const expected = play(win, win.ISA_ALERT_SOUNDS.defaultId);
  assert.ok(expected > 0);
  assert.strictEqual(play(win, 'no-such-preset'), expected);
});

test('S9: an error thrown by createOscillator does not escape play', () => {
  const win = load({ throwOscillator: true });
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__contexts[0].state, 'running');
  assert.doesNotThrow(() => win.ISA_ALERT_SOUNDS.play('tritone'));
});
