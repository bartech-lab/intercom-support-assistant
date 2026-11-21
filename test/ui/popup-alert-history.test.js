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
  return { at, seen, label: `L${at}`, count: 1, teamId: '1', ...extra };
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

test('unseen rows are listed newest first', () => {
  const { doc, dom } = loadPopup({ history: [entry(1000, false), entry(3000, false), entry(2000, false)] });
  assert.deepStrictEqual(labels(doc), ['L3000', 'L2000', 'L1000']);
  assert.equal(doc.querySelector('.rang-earlier'), null);
  assert.equal(doc.querySelector('#rangList').textContent.includes('Earlier'), false);
  dom.window.close();
});

test('seen entries are never listed, even when one is newer than an unseen one', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, true), entry(2, false), entry(3, true), entry(4, false), entry(5, true)]
  });
  assert.deepStrictEqual(labels(doc), ['L4', 'L2']);
  assert.equal(doc.querySelector('#rangList').children.length, 2);
  assert.equal(doc.querySelector('#rangList').textContent.includes('Earlier'), false);
  dom.window.close();
});

test('a seen entry newer than every unseen entry does not appear', () => {
  const { doc, dom } = loadPopup({ history: [entry(10, true), entry(5, false)] });
  assert.deepStrictEqual(labels(doc), ['L5']);
  dom.window.close();
});

test('with only seen entries the list has no rows at all', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, true), entry(2, true)] });
  assert.equal(doc.querySelector('#rangList').children.length, 0);
  assert.equal(rows(doc).length, 0);
  assert.equal(doc.querySelector('.rang-more'), null);
  dom.window.close();
});

test('exactly 3 unseen entries show 3 rows and no more item', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, false), entry(2, false), entry(3, false), entry(4, true)] });
  assert.deepStrictEqual(labels(doc), ['L3', 'L2', 'L1']);
  assert.equal(doc.querySelector('.rang-more'), null);
  assert.equal(doc.querySelector('#rangList').children.length, 3);
  dom.window.close();
});

test('4 unseen entries show the newest 3 rows and an and 1 more item last', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, false), entry(2, false), entry(3, false), entry(4, false)] });
  assert.deepStrictEqual(labels(doc), ['L4', 'L3', 'L2']);
  const list = doc.querySelector('#rangList');
  assert.equal(list.children.length, 4);
  const more = list.lastElementChild;
  assert.equal(more.tagName, 'LI');
  assert.equal(more.classList.contains('rang-more'), true);
  assert.equal(more.textContent, 'and 1 more');
  dom.window.close();
});

test('7 unseen entries show 3 rows, and 4 more, and a count of 7', () => {
  const history = [1, 2, 3, 4, 5, 6, 7].map(n => entry(n, false));
  const { doc, dom } = loadPopup({ history });
  assert.deepStrictEqual(labels(doc), ['L7', 'L6', 'L5']);
  assert.equal(doc.querySelectorAll('.rang-more').length, 1);
  assert.equal(doc.querySelector('.rang-more').textContent, 'and 4 more');
  assert.equal(doc.querySelector('#rangCount').textContent, '7');
  dom.window.close();
});

test('seen entries do not count toward the 3 row limit or the more item', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false), entry(2, false), entry(3, false), entry(4, true), entry(5, true), entry(6, true)]
  });
  assert.deepStrictEqual(labels(doc), ['L3', 'L2', 'L1']);
  assert.equal(doc.querySelector('.rang-more'), null);
  assert.equal(doc.querySelector('#rangCount').textContent, '3');
  dom.window.close();
});

test('the more item is not a button and clicking it sends no open message', () => {
  const { doc, sent, dom } = loadPopup({ history: [1, 2, 3, 4, 5].map(n => entry(n, false)) });
  const more = doc.querySelector('.rang-more');
  assert.equal(more.tagName === 'BUTTON' || more.querySelector('button') !== null, false);
  more.click();
  assert.equal(sent.filter(message => message.type === 'alert-history-open').length, 0);
  dom.window.close();
});

test('each row carries its unseen flag, time and label', () => {
  const { doc, dom } = loadPopup({
    history: [
      entry(1, false, { label: 'Urgent Saltmarsh Crafts' }),
      entry(2, false, { label: 'Urgent Northside' })
    ]
  });
  const [first, second] = rows(doc);
  assert.equal(first.dataset.unseen, 'true');
  assert.equal(first.querySelector('.rang-label').textContent, 'Urgent Northside');
  assert.ok(first.querySelector('.rang-time'));
  assert.equal(second.dataset.unseen, 'true');
  assert.equal(second.querySelector('.rang-label').textContent, 'Urgent Saltmarsh Crafts');
  dom.window.close();
});

test('an entry from today shows zero-padded 24-hour time', () => {
  const { doc, dom } = loadPopup({ history: [entry(todayAt(9, 5), false)] });
  assert.equal(rows(doc)[0].querySelector('.rang-time').textContent, '09:05');
  dom.window.close();
});

test('an afternoon entry shows 17:30 without AM or PM', () => {
  const { doc, dom } = loadPopup({ history: [entry(todayAt(17, 30), false)] });
  assert.equal(rows(doc)[0].querySelector('.rang-time').textContent, '17:30');
  dom.window.close();
});

test('an entry from another day shows DD.MM HH:MM', () => {
  const now = new Date();
  const other = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 7, 4);
  const { doc, dom } = loadPopup({ history: [entry(other.getTime(), false)] });
  const expected = `${pad(other.getDate())}.${pad(other.getMonth() + 1)} 07:04`;
  assert.equal(rows(doc)[0].querySelector('.rang-time').textContent, expected);
  dom.window.close();
});

test('the unseen count shows the number of unseen entries', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, false), entry(2, true), entry(3, false), entry(4, false)] });
  assert.equal(doc.querySelector('#rangCount').textContent, '3');
  dom.window.close();
});

test('the unseen count is empty when nothing is unseen', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, true)] });
  assert.equal(doc.querySelector('#rangCount').textContent, '');
  dom.window.close();
});

test('the empty message is visible when there are no entries', () => {
  const { doc, dom } = loadPopup({ history: [] });
  const empty = doc.querySelector('#rangEmpty');
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, 'Nothing rang since you last looked.');
  dom.window.close();
});

test('the empty message is visible when only seen entries exist', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, true), entry(2, true)] });
  assert.equal(doc.querySelector('#rangEmpty').hidden, false);
  assert.equal(doc.querySelector('#rangEmpty').textContent, 'Nothing rang since you last looked.');
  dom.window.close();
});

test('the empty message is hidden when at least one entry is unseen', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, true), entry(2, false)] });
  assert.equal(doc.querySelector('#rangEmpty').hidden, true);
  dom.window.close();
});

test('the popup marks alerts seen exactly once when something is unseen', () => {
  const { sent, dom } = loadPopup({ history: [entry(1, false), entry(2, false)] });
  assert.equal(sent.filter(message => message.type === 'alert-history-seen').length, 1);
  assert.deepStrictEqual(sent.find(message => message.type === 'alert-history-seen'), { type: 'alert-history-seen' });
  dom.window.close();
});

test('the empty message is hidden when 4 unseen entries overflow the list', () => {
  const { doc, dom } = loadPopup({ history: [1, 2, 3, 4].map(n => entry(n, false)) });
  assert.equal(doc.querySelector('#rangEmpty').hidden, true);
  dom.window.close();
});

test('the popup does not send seen when nothing is unseen', () => {
  const { sent, dom } = loadPopup({ history: [entry(1, true)] });
  assert.equal(sent.filter(message => message.type === 'alert-history-seen').length, 0);
  dom.window.close();
});

test('clicking a row asks the background to bring the Intercom tab forward', () => {
  const { doc, sent, dom } = loadPopup({ history: [entry(1, false), entry(2, false)] });
  rows(doc)[0].click();
  assert.deepStrictEqual(sent.filter(message => message.type === 'alert-history-open'), [
    { type: 'alert-history-open' }
  ]);
  dom.window.close();
});

test('an ok answer leaves the status empty', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, false)], respond: () => ({ ok: true }) });
  rows(doc)[0].click();
  assert.equal(doc.querySelector('#popupStatus').textContent, '');
  dom.window.close();
});

test('a not-ok answer says no Intercom tab is open', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false)],
    respond: () => ({ ok: false, reason: 'no-tab' })
  });
  rows(doc)[0].click();
  assert.equal(doc.querySelector('#popupStatus').textContent, 'No Intercom tab is open.');
  dom.window.close();
});

test('a browser callback error says no tab is open', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false)],
    respond: (message, chrome) => {
      if (message.type === 'alert-history-open') chrome.runtime.lastError = { message: 'Unavailable' };
      return undefined;
    }
  });
  rows(doc)[0].click();
  assert.equal(doc.querySelector('#popupStatus').textContent, 'No Intercom tab is open.');
  dom.window.close();
});

test('a throwing sendMessage on click says no tab is open', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false)],
    respond: (message) => {
      if (message.type === 'alert-history-open') throw new Error('Extension unavailable');
      return { ok: true };
    }
  });
  rows(doc)[0].click();
  assert.equal(doc.querySelector('#popupStatus').textContent, 'No Intercom tab is open.');
  dom.window.close();
});

test('a label with markup appears literally and creates no element', () => {
  const label = '<img src=x onerror=1>';
  const { doc, dom } = loadPopup({ history: [entry(1, false, { label })] });
  assert.equal(rows(doc)[0].querySelector('.rang-label').textContent, label);
  assert.equal(rows(doc)[0].querySelectorAll('img').length, 0);
  dom.window.close();
});

test('null entries and entries without a finite time are skipped', () => {
  const { doc, dom } = loadPopup({
    history: [null, entry('soon', false, { label: 'bad-string' }), entry(NaN, false, { label: 'bad-nan' }),
      entry(Infinity, false, { label: 'bad-inf' }), { seen: false, label: 'bad-missing' }, entry(5, false, { label: 'good' })]
  });
  assert.deepStrictEqual(labels(doc), ['good']);
  dom.window.close();
});

test('without chrome.storage the popup shows the empty state', () => {
  const { doc, dom } = loadPopup({
    chromeOverride: { runtime: { sendMessage(message, callback) { if (callback) callback({ ok: true }); } } }
  });
  assert.equal(rows(doc).length, 0);
  assert.equal(doc.querySelector('#rangEmpty').hidden, false);
  dom.window.close();
});

test('a throwing storage read shows the empty state', () => {
  const { doc, dom } = loadPopup({
    chromeOverride: {
      runtime: { sendMessage(message, callback) { if (callback) callback({ ok: true }); } },
      storage: { local: { get() { throw new Error('storage down'); } } }
    }
  });
  assert.equal(rows(doc).length, 0);
  assert.equal(doc.querySelector('#rangEmpty').hidden, false);
  dom.window.close();
});

test('a stored value that is not an array shows the empty state', () => {
  const { doc, sent, dom } = loadPopup({ history: { 0: entry(1, false), length: 1 } });
  assert.equal(rows(doc).length, 0);
  assert.equal(doc.querySelector('#rangEmpty').hidden, false);
  assert.equal(sent.filter(message => message.type === 'alert-history-seen').length, 0);
  dom.window.close();
});

test('the navigation buttons still open their workspace section', () => {
  const { doc, sent, dom } = loadPopup({ history: [] });
  for (const section of ['signatures', 'settings', 'tools']) {
    doc.querySelector(`[data-section="${section}"]`).click();
  }
  assert.deepStrictEqual(sent.filter(message => message.type === 'open-preview'), [
    { type: 'open-preview', section: 'signatures' },
    { type: 'open-preview', section: 'settings' },
    { type: 'open-preview', section: 'tools' }
  ]);
  dom.window.close();
});

test('a row that rang more than once says how many times, and a single ring says nothing', () => {
  const { doc, dom } = loadPopup({
    history: [
      entry(1, false, { label: 'Urgent Saltmarsh Crafts', rings: 1 }),
      entry(2, false, { label: 'Urgent Northside', rings: 3 })
    ]
  });
  const [repeated, single] = rows(doc);
  assert.equal(repeated.querySelector('.rang-times').textContent.trim(), 'rang 3 times');
  assert.equal(single.querySelector('.rang-times'), null);
  dom.window.close();
});
