'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');

function load(html) {
  const win = loadExtension(html, { chromeStub: makeChromeStub() });
  const cleared = [];
  win.setInterval = () => 41;
  win.clearInterval = id => cleared.push(id);
  win.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {} });
  win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,BADGE';
  return { win, cleared };
}

const PAGE = '<!doctype html><html><head><title>Inbox</title><link rel="icon" href="/orig.ico"></head><body></body></html>';

function visuals(win, active) {
  return win.createAlertVisuals({
    titleMarker: '(!) ',
    blinkMs: 1000,
    runSafe: fn => fn(),
    collectActive: () => active,
    summarize: list => ({ text: `${list.length} waiting`, total: list.length })
  });
}

test('a favicon the alert has to create goes into the head', () => {
  const { win } = load('<!doctype html><html><head><title>Inbox</title></head><body></body></html>');
  const alert = visuals(win, ['a']);
  alert.updateSummary(['a']);
  alert.start();
  const link = win.document.querySelector('link[rel~="icon"]');
  assert.equal(link.parentNode, win.document.head);
});

test('each pulse shows the current number of waiting conversations', () => {
  const { win } = load(PAGE);
  const active = ['a'];
  const alert = visuals(win, active);
  alert.updateSummary(active);
  alert.start();
  assert.equal(win.document.title, '(!) 1 waiting');
  active.push('b');
  alert.pulse();
  alert.pulse();
  assert.equal(win.document.title, '(!) 2 waiting');
});

test('a title another alert marked is never taken as the page title to restore', () => {
  const { win } = load(PAGE);
  const alert = visuals(win, ['a']);
  alert.updateSummary(['a']);
  alert.start();
  alert.pulse();
  assert.equal(win.document.title, 'Inbox');
  win.document.title = '(!) 3 waiting elsewhere';
  alert.pulse();
  alert.pulse();
  alert.stop();
  assert.equal(win.document.title, 'Inbox');
});

test('stopping the alert clears its blink timer', () => {
  const { win, cleared } = load(PAGE);
  const alert = visuals(win, ['a']);
  alert.updateSummary(['a']);
  alert.start();
  alert.stop();
  assert.deepEqual(cleared, [41]);
});
