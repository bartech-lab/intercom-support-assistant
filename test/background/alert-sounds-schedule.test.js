'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'alert-sounds.js'), 'utf8');

function load({ times = 1 } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;
  const log = { contexts: 0, notes: [] };
  win.AudioContext = function RecordingAudioContext() {
    log.contexts += 1;
    this.state = 'suspended';
    this.currentTime = 2;
    this.resume = () => { this.state = 'running'; return Promise.resolve(); };
    this.createOscillator = () => {
      const note = { start: null, stop: null, ramps: [] };
      log.notes.push(note);
      return {
        frequency: { setValueAtTime() {} },
        connect: node => node,
        start(at) { note.start = at; },
        stop(at) { note.stop = at; }
      };
    };
    this.createGain = () => {
      const target = log.notes[log.notes.length - 1];
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime(value, at) { target.ramps.push(at); } },
        connect: node => node
      };
    };
    this.destination = {};
  };
  Object.defineProperty(win.navigator, 'userActivation', { value: { isActive: true, hasBeenActive: true }, configurable: true });
  const ctx = dom.getInternalVMContext();
  for (let i = 0; i < times; i += 1) vm.runInContext(SRC, ctx, { filename: 'alert-sounds.js' });
  return { win, log };
}

async function unlock(win) {
  win.dispatchEvent(new win.Event('pointerdown'));
  await Promise.resolve();
}

test('the notes of a preset start at their own offsets, not all at once', async () => {
  const { win, log } = load();
  await unlock(win);
  win.ISA_ALERT_SOUNDS.play('rising-chime');
  const starts = log.notes.map(note => note.start);
  assert.equal(starts.length, 3);
  assert.ok(starts[0] < starts[1] && starts[1] < starts[2], JSON.stringify(starts));
});

test('every note keeps sounding until its fade-out has finished', async () => {
  const { win, log } = load();
  await unlock(win);
  win.ISA_ALERT_SOUNDS.play('tritone');
  assert.equal(log.notes.length, 2);
  for (const note of log.notes) {
    assert.ok(note.stop > Math.max(...note.ramps), JSON.stringify(note));
  }
});

test('loading the script twice keeps one API and one context per gesture', async () => {
  const { win, log } = load({ times: 2 });
  const api = win.ISA_ALERT_SOUNDS;
  await unlock(win);
  assert.equal(log.contexts, 1);
  assert.equal(win.ISA_ALERT_SOUNDS, api);
});

test('the preset list offers the silent choice', () => {
  const { win } = load();
  assert.ok(win.ISA_ALERT_SOUNDS.presets.some(preset => preset.id === 'silent'));
});
