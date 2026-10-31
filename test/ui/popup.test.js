'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function loadPopup(sendMessage) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../../src/popup.html'), 'utf8'), {
    runScripts: 'outside-only', url: 'https://example.test/popup.html'
  });
  dom.window.chrome = { runtime: { sendMessage } };
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../src/popup.js'), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

test('popup opens each workspace section with a direct destination', () => {
  const messages = [];
  const dom = loadPopup((message, callback) => { messages.push(JSON.parse(JSON.stringify(message))); callback(); });
  for (const section of ['signatures', 'settings', 'tools']) {
    dom.window.document.querySelector(`[data-section="${section}"]`).click();
  }
  assert.deepEqual(messages, ['signatures', 'settings', 'tools'].map((section) => ({ type: 'open-preview', section })));
  assert.equal(dom.window.document.querySelectorAll('[data-isa-compact="true"]').length, 1);
  assert.equal(dom.window.document.querySelector('[data-isa-collapsible]'), null);
  dom.window.close();
});

test('popup reports unavailable workspace messaging', () => {
  const dom = loadPopup(() => { throw new Error('Extension unavailable'); });
  dom.window.document.querySelector('#previewBtn').click();
  assert.match(dom.window.document.querySelector('#popupStatus').textContent, /Could not open the workspace/);
  dom.window.close();
});

test('popup reports browser callback errors', () => {
  const dom = loadPopup((message, callback) => {
    dom.window.chrome.runtime.lastError = { message: 'Unavailable' };
    callback();
    delete dom.window.chrome.runtime.lastError;
  });
  dom.window.document.querySelector('[data-section="settings"]').click();
  assert.match(dom.window.document.querySelector('#popupStatus').textContent, /Try again/);
  dom.window.close();
});
