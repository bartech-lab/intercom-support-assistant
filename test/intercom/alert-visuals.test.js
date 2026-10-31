'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');

const PAGE = '<!doctype html><html><head><title>Inbox</title><link rel="icon" href="/orig.ico"></head><body></body></html>';

function load(html = PAGE) {
  const win = loadExtension(html, { chromeStub: makeChromeStub() });
  const intervals = [];
  win.setInterval = (fn, ms) => { intervals.push(ms); return intervals.length; };
  win.clearInterval = () => {};
  return { win, intervals };
}

function stubCanvas(win, texts = []) {
  win.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, arc() {}, fill() {},
    fillText(text) { texts.push(text); }
  });
  win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,BADGE';
  return texts;
}

function visuals(win, active = ['a']) {
  return win.createAlertVisuals({
    titleMarker: '(!) ',
    blinkMs: 1000,
    runSafe: fn => fn(),
    collectActive: () => active,
    summarize: list => ({ text: `${list.length} waiting`, total: list.length })
  });
}

const favicon = win => win.document.querySelector('link[rel~="icon"]')?.getAttribute('href');

test('the runtime is dead once the extension id is gone', () => {
  const { win } = load();
  assert.equal(win.extensionRuntimeAlive(), true);
  win.chrome.runtime.id = undefined;
  assert.equal(win.extensionRuntimeAlive(), false);
});

test('the badge shows the count up to nine, then 9+', () => {
  const { win } = load();
  const texts = stubCanvas(win);
  win.buildFaviconBadge(9);
  win.buildFaviconBadge(10);
  assert.deepEqual(texts, ['9', '9+']);
});

test('without a canvas badge the favicon is never set to "null"', () => {
  const { win } = load('<!doctype html><html><head><title>Inbox</title></head><body></body></html>');
  win.HTMLCanvasElement.prototype.getContext = () => null;
  const alert = visuals(win);
  alert.updateSummary(['a']);
  alert.start();
  assert.equal(win.document.querySelector('link[rel~="icon"]'), null);

  const withIcon = load('<!doctype html><html><head><title>Inbox</title><link rel="icon" href="/orig.ico"></head><body></body></html>').win;
  withIcon.HTMLCanvasElement.prototype.getContext = () => null;
  const iconAlert = visuals(withIcon);
  iconAlert.updateSummary(['a']);
  iconAlert.start();
  assert.equal(withIcon.document.querySelector('link[rel~="icon"]').getAttribute('href'), '/orig.ico');
});

test('the favicon blinks back to the page icon on the off beat', () => {
  const { win } = load();
  stubCanvas(win);
  const alert = visuals(win);
  alert.updateSummary(['a']);
  alert.start();
  assert.equal(favicon(win), 'data:image/png;base64,BADGE');
  alert.pulse();
  assert.equal(favicon(win), '/orig.ico');
});

test('a second start while the badge shows keeps one timer and the page icon to restore', () => {
  const { win, intervals } = load();
  stubCanvas(win);
  const alert = visuals(win);
  alert.updateSummary(['a']);
  alert.start();
  alert.start();
  assert.equal(intervals.length, 1);
  alert.stop();
  assert.equal(favicon(win), '/orig.ico');
  assert.equal(win.document.title, 'Inbox');
});

test('a new alert after a stop blinks against the current page title, not the old one', () => {
  const { win } = load();
  const alert = visuals(win);
  alert.updateSummary(['a']);
  alert.start();
  alert.stop();
  win.document.title = 'Conversation 2';
  alert.updateSummary(['a']);
  alert.start();
  assert.match(win.document.title, /^\(!\)/);
  alert.pulse();
  assert.equal(win.document.title, 'Conversation 2');
});
