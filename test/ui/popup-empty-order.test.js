'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../../src/popup.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/popup.js'), 'utf8');

function loadPopup(history) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://example.test/popup.html' });
  dom.window.chrome = {
    runtime: { sendMessage(message, callback) { if (typeof callback === 'function') callback({ ok: true }); }, lastError: undefined },
    storage: { local: { get(keys, callback) { callback({ isaAlertHistory: history }); } } }
  };
  dom.window.eval(SOURCE);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

const entry = (at, seen) => ({ at, seen, label: `L${at}`, count: 1, teamId: '1' });

test('the empty message comes before the list in document order', () => {
  const dom = loadPopup([]);
  const doc = dom.window.document;
  const empty = doc.querySelector('#rangEmpty');
  const list = doc.querySelector('#rangList');
  assert.ok(empty.compareDocumentPosition(list) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test('with only seen entries the message shows and the list holds the Earlier heading', () => {
  const dom = loadPopup([entry(1, true), entry(2, true)]);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('#rangEmpty').hidden, false);
  assert.ok(Array.from(doc.querySelector('#rangList').children).some(node => node.textContent === 'Earlier'));
  dom.window.close();
});

test('with an unseen entry the message is hidden', () => {
  const dom = loadPopup([entry(1, true), entry(2, false)]);
  assert.equal(dom.window.document.querySelector('#rangEmpty').hidden, true);
  dom.window.close();
});
