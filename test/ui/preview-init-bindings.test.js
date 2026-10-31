'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPreview } = require('../support/helpers');

function config(company) {
  return {
    emoji: '',
    english: '--<br>Best regards<br>Maya Lindqvist<br>Customer Support at <a href="https://example.test">' + company + '</a>',
    german: '', french: '', italian: '', portuguese: '', spanish: '', dutch: ''
  };
}

function pageHtml() {
  return '<!doctype html><html><body>' +
    '<nav>' +
    '<a href="#signatures" data-section="signatures">Signatures</a>' +
    '<a href="#settings" data-section="settings">Settings</a>' +
    '</nav>' +
    '<section id="signatures" data-workspace-section><div id="status"></div><div id="errorMessage" class="hidden" hidden></div>' +
    '<div id="content" class="hidden" hidden><input id="searchInput"><span id="resultCount"></span><p id="searchEmpty" hidden></p>' +
    '<div id="companyGrid"></div><div id="teamGrid"></div>' +
    '<span id="companyCount"></span><span id="teamCount"></span></div>' +
    '<p id="copyStatus" aria-live="polite"></p></section>' +
    '<section id="settings" data-workspace-section><button id="settingsControl">Setting</button></section>' +
    '</body></html>';
}

function start(data) {
  const writes = [];
  const win = loadPreview(pageHtml(), {
    clipboard: { writeText: async (value) => { writes.push(value); } },
    hasClipboardItem: false
  });
  win.history.replaceState(null, '', '/preview#signatures');
  win.SIGNATURE_DATA = data;
  win.init();
  return { win, writes };
}

function clickLink(win, section) {
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  const link = win.document.querySelector('a[data-section="' + section + '"]');
  link.dispatchEvent(event);
  return event;
}

const DATA = {
  companies: { 'Alpha Co': config('Alpha Co'), 'Bravo Co': config('Bravo Co'), 'Charlie Co': config('Charlie Co') }
};

test('P1: start-up wires the copy button of the second company card', async () => {
  const { win, writes } = start(DATA);
  const cards = win.document.getElementById('companyGrid').children;
  assert.equal(cards.length, 3);
  cards[1].querySelector('.copy-btn').click();
  await new Promise((resolve) => win.setTimeout(resolve, 0));
  assert.equal(writes.length, 1);
  assert.match(writes[0], /Bravo Co/);
  assert.doesNotMatch(writes[0], /Alpha Co|Charlie Co/);
});

test('P2: a copy button click without data start-up writes nothing', async () => {
  const { win, writes } = start(undefined);
  assert.equal(win.document.getElementById('errorMessage').hidden, false);
  const card = win.buildCard('Alpha Co', config('Alpha Co'), 'company-card');
  win.document.body.appendChild(card);
  card.querySelector('.copy-btn').click();
  await new Promise((resolve) => win.setTimeout(resolve, 0));
  assert.equal(writes.length, 0);
});

test('P3: a link to another section is default-prevented, adds one history entry and shows the section', () => {
  const { win } = start(DATA);
  const before = win.history.length;
  const event = clickLink(win, 'settings');
  assert.equal(event.defaultPrevented, true);
  assert.equal(win.history.length, before + 1);
  assert.equal(win.document.getElementById('settings').hidden, false);
  assert.equal(win.document.getElementById('signatures').hidden, true);
});

test('P4: a link to the current section is default-prevented and adds no history entry', () => {
  const { win } = start(DATA);
  const before = win.history.length;
  const event = clickLink(win, 'signatures');
  assert.equal(event.defaultPrevented, true);
  assert.equal(win.history.length, before);
  assert.equal(win.document.getElementById('signatures').hidden, false);
  assert.equal(win.document.getElementById('settings').hidden, true);
});
