'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../../src/popup.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/popup.js'), 'utf8');

function todayAt(hour, minute) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).getTime();
}

function entry(at, seen, extra = {}) {
  return { at, seen, label: 'Urgent Northside', count: 1, teamId: '1', ...extra };
}

function loadPopup({ history } = {}) {
  const sent = [];
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://example.test/popup.html' });
  dom.window.chrome = {
    runtime: {
      sendMessage(message, callback) {
        sent.push(JSON.parse(JSON.stringify(message)));
        if (typeof callback === 'function') callback({ ok: true });
      },
      lastError: undefined
    },
    storage: { local: { get(keys, callback) { callback({ isaAlertHistory: history }); } } }
  };
  dom.window.eval(SOURCE);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { dom, sent, doc: dom.window.document };
}

function rows(doc) {
  return Array.from(doc.querySelectorAll('#rangList button.rang-row'));
}

function labels(doc) {
  return rows(doc).map(row => row.querySelector('.rang-label').firstChild.textContent);
}

function where(doc) {
  return rows(doc).map((row) => {
    const times = row.querySelector('.rang-times');
    return times ? times.textContent.trim() : '';
  });
}

test('three plain unseen entries for one place become one row that rang 3 times', () => {
  const { doc, dom } = loadPopup({ history: [entry(3, false), entry(1, false), entry(2, false)] });
  assert.equal(rows(doc).length, 1);
  assert.deepStrictEqual(where(doc), ['rang 3 times']);
  dom.window.close();
});

test('a place with a single plain entry shows no rang text', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, false)] });
  assert.deepStrictEqual(where(doc), ['']);
  assert.equal(rows(doc)[0].textContent.includes('rang'), false);
  dom.window.close();
});

test('one entry with rings 4 plus one plain entry rang 5 times', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, false, { rings: 4 }), entry(2, false)] });
  assert.deepStrictEqual(where(doc), ['rang 5 times']);
  dom.window.close();
});

test('rings of 1, undefined, 0 and 4 sum to 1, 1, 1 and 4', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false, { rings: 1 }), entry(2, false), entry(3, false, { rings: 0 }), entry(4, false, { rings: 4 })]
  });
  assert.deepStrictEqual(where(doc), ['rang 7 times']);
  dom.window.close();
});

test('a single entry with rings 4 rang 4 times', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, false, { rings: 4 })] });
  assert.deepStrictEqual(where(doc), ['rang 4 times']);
  dom.window.close();
});

test('a single entry with rings 0 or 1 shows no rang text', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false, { label: 'A', rings: 0 }), entry(2, false, { label: 'B', rings: 1 })]
  });
  assert.deepStrictEqual(where(doc), ['', '']);
  dom.window.close();
});

test('the grouped row shows the time of the newest entry even when storage is unsorted', () => {
  const { doc, dom } = loadPopup({
    history: [entry(todayAt(10, 15), false), entry(todayAt(18, 40), false), entry(todayAt(8, 5), false)]
  });
  assert.equal(rows(doc)[0].querySelector('.rang-time').textContent, '18:40');
  dom.window.close();
});

test('a seen entry between unseen ones of the same place adds nothing', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false), entry(2, true, { rings: 9 }), entry(3, false)]
  });
  assert.deepStrictEqual(where(doc), ['rang 2 times']);
  dom.window.close();
});

test('a newer seen entry does not set the row time', () => {
  const { doc, dom } = loadPopup({
    history: [entry(todayAt(9, 0), false), entry(todayAt(9, 30), false), entry(todayAt(20, 0), true)]
  });
  assert.equal(rows(doc)[0].querySelector('.rang-time').textContent, '09:30');
  dom.window.close();
});

test('a place with one unseen and several seen entries shows no rang text', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, true), entry(2, false), entry(3, true)] });
  assert.deepStrictEqual(where(doc), ['']);
  dom.window.close();
});

test('a reminder and a normal entry with the same label give two rows', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false), entry(2, false, { kind: 'reminder' }), entry(3, false)]
  });
  assert.equal(rows(doc).length, 2);
  assert.equal(doc.querySelector('.rang-more'), null);
  const texts = where(doc).slice().sort();
  assert.equal(texts.some(text => text.includes('rang 2 times')), true);
  assert.equal(texts.some(text => text === ''), true);
  dom.window.close();
});

test('rows are ordered by their newest entry, newest first', () => {
  const { doc, dom } = loadPopup({
    history: [
      entry(10, false, { label: 'A' }),
      entry(30, false, { label: 'B' }),
      entry(5, false, { label: 'B' }),
      entry(20, false, { label: 'C' }),
      entry(1, false, { label: 'A' })
    ]
  });
  assert.deepStrictEqual(labels(doc), ['B', 'C', 'A']);
  dom.window.close();
});

test('a place with many old entries and one very new entry ranks first', () => {
  const { doc, dom } = loadPopup({
    history: [
      entry(100, false, { label: 'Urgent Saltmarsh Crafts' }), entry(101, false, { label: 'Urgent Saltmarsh Crafts' }), entry(102, false, { label: 'Urgent Saltmarsh Crafts' }),
      entry(50, false, { label: 'Urgent Alderpoint' }), entry(999, false, { label: 'Urgent Alderpoint' })
    ]
  });
  assert.deepStrictEqual(labels(doc), ['Urgent Alderpoint', 'Urgent Saltmarsh Crafts']);
  dom.window.close();
});

test('five entries over two places give 2 rows, no more item and a count of 5', () => {
  const { doc, dom } = loadPopup({
    history: [
      entry(1, false, { label: 'A' }), entry(2, false, { label: 'B' }), entry(3, false, { label: 'A' }),
      entry(4, false, { label: 'B' }), entry(5, false, { label: 'A' })
    ]
  });
  assert.equal(rows(doc).length, 2);
  assert.equal(doc.querySelector('.rang-more'), null);
  assert.equal(doc.querySelector('#rangCount').textContent, '5');
  dom.window.close();
});

test('the count is entries, not rings and not places', () => {
  const { doc, dom } = loadPopup({
    history: [entry(1, false, { rings: 6 }), entry(2, false, { rings: 4 }), entry(3, true, { rings: 8 })]
  });
  assert.equal(doc.querySelector('#rangCount').textContent, '2');
  dom.window.close();
});

test('exactly 3 places show 3 rows and no more item', () => {
  const { doc, dom } = loadPopup({
    history: [1, 2, 3].flatMap(n => [entry(n, false, { label: `P${n}` }), entry(n + 10, false, { label: `P${n}` })])
  });
  assert.equal(rows(doc).length, 3);
  assert.equal(doc.querySelector('.rang-more'), null);
  dom.window.close();
});

test('five places show 3 rows and and 2 more, counting places not entries', () => {
  const history = [];
  for (let n = 1; n <= 5; n += 1) {
    history.push(entry(n, false, { label: `P${n}` }), entry(n + 100, false, { label: `P${n}` }), entry(n + 200, false, { label: `P${n}` }));
  }
  const { doc, dom } = loadPopup({ history });
  assert.deepStrictEqual(labels(doc), ['P5', 'P4', 'P3']);
  const more = doc.querySelector('#rangList').lastElementChild;
  assert.equal(more.classList.contains('rang-more'), true);
  assert.equal(more.textContent, 'and 2 more');
  assert.equal(doc.querySelector('#rangCount').textContent, '15');
  dom.window.close();
});

test('places that exist only as seen entries are not counted in the more item', () => {
  const history = [
    entry(1, false, { label: 'A' }), entry(2, false, { label: 'B' }), entry(3, false, { label: 'C' }),
    entry(4, false, { label: 'D' }), entry(5, true, { label: 'E' }), entry(6, true, { label: 'F' })
  ];
  const { doc, dom } = loadPopup({ history });
  assert.equal(doc.querySelector('.rang-more').textContent, 'and 1 more');
  dom.window.close();
});

test('clicking a grouped row sends one open message', () => {
  const { doc, sent, dom } = loadPopup({
    history: [entry(1, false), entry(2, false), entry(3, false), entry(4, false, { label: 'Urgent inbox' })]
  });
  const row = rows(doc).find(item => item.querySelector('.rang-label').firstChild.textContent === 'Urgent Northside');
  row.click();
  assert.deepStrictEqual(sent.filter(message => message.type === 'alert-history-open'), [{ type: 'alert-history-open' }]);
  dom.window.close();
});

test('seen entries of a place give no row and no rang text', () => {
  const { doc, dom } = loadPopup({ history: [entry(1, true), entry(2, true), entry(3, true)] });
  assert.equal(rows(doc).length, 0);
  assert.equal(doc.querySelector('#rangList').children.length, 0);
  dom.window.close();
});
