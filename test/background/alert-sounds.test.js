'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'alert-sounds.js'), 'utf8');

function loadAlertSounds({ isActive, hasBeenActive, trustEvents, brokenAudioContext = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;
  win.__audioCtorCount = 0;
  win.__resumeCount = 0;
  win.__oscillators = 0;
  win.__ctorAttempts = 0;
  win.AudioContext = brokenAudioContext ? function BrokenAudioContext() {
    win.__ctorAttempts += 1;
    throw new Error('blocked by autoplay policy');
  } : function FakeAudioContext() {
    win.__audioCtorCount += 1;
    this.state = 'suspended';
    this.currentTime = 0;
    this.resume = () => { win.__resumeCount += 1; this.state = 'running'; return Promise.resolve(); };
    this.createOscillator = () => {
      win.__oscillators += 1;
      return { frequency: { setValueAtTime() {} }, connect: node => node, start() {}, stop() {} };
    };
    this.createGain = () => ({
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect: node => node
    });
    this.destination = {};
  };
  if (isActive !== undefined || hasBeenActive !== undefined) {
    Object.defineProperty(win.navigator, 'userActivation', {
      value: { isActive: !!isActive, hasBeenActive: !!hasBeenActive },
      configurable: true
    });
  }
  if (trustEvents) {
    Object.defineProperty(win.Event.prototype, 'isTrusted', { get() { return true; }, configurable: true });
  }
  const ctx = dom.getInternalVMContext();
  vm.runInContext(SRC, ctx, { filename: 'alert-sounds.js' });
  return win;
}

test('a ding never constructs or resumes a context on its own, even when active', () => {
  const win = loadAlertSounds({ isActive: true, hasBeenActive: true });
  win.ISA_ALERT_SOUNDS.play('blink-blink');
  win.ISA_ALERT_SOUNDS.play('tritone');
  assert.strictEqual(win.__audioCtorCount, 0);
  assert.strictEqual(win.__resumeCount, 0);
});

test('without the userActivation API, an untrusted event never touches Web Audio', () => {
  const win = loadAlertSounds();
  win.dispatchEvent(new win.Event('pointerdown'));
  win.dispatchEvent(new win.Event('keydown'));
  assert.strictEqual(win.__audioCtorCount, 0);
  assert.strictEqual(win.__resumeCount, 0);
});

test('a trusted but non-activating gesture never touches Web Audio', () => {
  const win = loadAlertSounds({ isActive: false, hasBeenActive: false, trustEvents: true });
  win.dispatchEvent(new win.Event('keydown'));
  assert.strictEqual(win.__audioCtorCount, 0);
  assert.strictEqual(win.__resumeCount, 0);
});

test('a trusted, activating gesture unlocks audio and later dings reuse it', () => {
  const win = loadAlertSounds({ isActive: true, hasBeenActive: true, trustEvents: true });
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__audioCtorCount, 1);
  assert.ok(win.__resumeCount >= 1, 'resumes inside the gesture');
  win.ISA_ALERT_SOUNDS.play('blink-blink');
  assert.strictEqual(win.__audioCtorCount, 1);
  assert.ok(win.__oscillators > 0, 'the ding is scheduled on the unlocked context');
});

test('the silent preset schedules no sound on an unlocked context', () => {
  const win = loadAlertSounds({ isActive: true, hasBeenActive: true, trustEvents: true });
  win.dispatchEvent(new win.Event('pointerdown'));
  win.ISA_ALERT_SOUNDS.play('silent');
  assert.strictEqual(win.__audioCtorCount, 1);
  assert.strictEqual(win.__oscillators, 0);
});

test('the recorded gesture flag is the fallback once the User Activation API stops answering mid-check', () => {
  const win = loadAlertSounds({ isActive: true, hasBeenActive: true });
  let reads = 0;
  Object.defineProperty(win.navigator, 'userActivation', {
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? { isActive: true, hasBeenActive: true } : undefined;
    }
  });
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__audioCtorCount, 1, 'the gesture is accepted through the API on the first check');
  assert.ok(win.__resumeCount >= 1, 'the recorded flag, not the vanished API, must still let it resume');
});

test('a broken AudioContext constructor cannot leave the first-gesture handler stuck retrying', () => {
  const win = loadAlertSounds({ isActive: true, hasBeenActive: true, brokenAudioContext: true });
  win.dispatchEvent(new win.Event('pointerdown'));
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.strictEqual(win.__ctorAttempts, 1,
    'a null context must bail out cleanly so the one-time gesture listeners are still removed');
});
