'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../../src/popup.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/popup.js'), 'utf8');

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayAt(hour, minute) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).getTime();
}

function entry(at, seen, extra = {}) {
  return { at, seen, platform: 'intercom', label: `L${at}`, count: 1, teamId: '1', ...extra };
}

function loadPopup({ history, respond, chromeOverride } = {}) {
  const sent = [];
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://example.test/popup.html' });
  const chrome = chromeOverride || {
    runtime: {
      sendMessage(message, callback) {
        sent.push(JSON.parse(JSON.stringify(message)));
        const answer = respond ? respond(message, dom.window.chrome) : { ok: true };
        if (typeof callback === 'function') callback(answer);
      },
      lastError: undefined
    },
    storage: { local: { get(keys, callback) { callback({ isaAlertHistory: history }); } } }
  };
  dom.window.chrome = chrome;
  dom.window.eval(SOURCE);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { dom, sent, doc: dom.window.document };
}

function rows(doc) {
  return Array.from(doc.querySelectorAll('#rangList button.rang-row'));
}

function labels(doc) {
  return rows(doc).map(row => row.querySelector('.rang-label').textContent);
}

function seenEntries(n, base = 1000) {
  return Array.from({ length: n }, (_, i) => entry(base + i, true));
}

function unseenEntries(n, base = 5000) {
  return Array.from({ length: n }, (_, i) => entry(base + i, false));
}

test('12 seen entries show only the newest 5 under Earlier, newest first', () => {
  const { doc, dom } = loadPopup({ history: seenEntries(12) });
  assert.deepStrictEqual(labels(doc), ['L1011', 'L1010', 'L1009', 'L1008', 'L1007']);
  assert.equal(doc.querySelectorAll('.rang-earlier').length, 1);
  dom.window.close();
});

test('8 unseen and 12 seen list all 8 unseen, then Earlier with 5', () => {
  const { doc, dom } = loadPopup({ history: [...seenEntries(12), ...unseenEntries(8)] });
  const items = Array.from(doc.querySelector('#rangList').children).map(node => (
    node.classList.contains('rang-earlier') ? 'divider' : node.querySelector('.rang-label').textContent
  ));
  assert.deepStrictEqual(items, [
    'L5007', 'L5006', 'L5005', 'L5004', 'L5003', 'L5002', 'L5001', 'L5000',
    'divider',
    'L1011', 'L1010', 'L1009', 'L1008', 'L1007'
  ]);
  dom.window.close();
});

test('exactly 5 seen entries are all shown', () => {
  const { doc, dom } = loadPopup({ history: seenEntries(5) });
  assert.equal(rows(doc).length, 5);
  dom.window.close();
});

test('6 seen entries drop the oldest one', () => {
  const { doc, dom } = loadPopup({ history: seenEntries(6) });
  assert.deepStrictEqual(labels(doc), ['L1005', 'L1004', 'L1003', 'L1002', 'L1001']);
  dom.window.close();
});

test('12 unseen entries are all listed with no Earlier divider', () => {
  const { doc, dom } = loadPopup({ history: unseenEntries(12) });
  assert.equal(rows(doc).length, 12);
  assert.equal(doc.querySelector('.rang-earlier'), null);
  dom.window.close();
});
