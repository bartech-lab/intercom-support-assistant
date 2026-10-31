'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPreview } = require('../support/helpers');

const FULL = '--<br>Best regards<br>Maya Lindqvist';

function config(overrides = {}) {
  return Object.assign({
    emoji: '',
    english: FULL,
    german: FULL,
    french: FULL,
    italian: FULL,
    portuguese: FULL,
    spanish: FULL,
    dutch: FULL
  }, overrides);
}

function pageHtml() {
  return '<!doctype html><html><body>' +
    '<section id="signatures" data-workspace-section><div id="status"></div><div id="errorMessage" class="hidden" hidden></div>' +
    '<div id="content" class="hidden" hidden><input id="searchInput"><span id="resultCount"></span><p id="searchEmpty" hidden></p>' +
    '<div id="companyGrid"></div><div id="teamGrid"></div>' +
    '<span id="companyCount"></span><span id="teamCount"></span></div>' +
    '<p id="copyStatus" aria-live="polite"></p></section>' +
    '</body></html>';
}

function startPage(teamSignature) {
  const win = loadPreview(pageHtml());
  win.history.replaceState(null, '', '/preview#signatures');
  win.SIGNATURE_DATA = { companies: { Alderpoint: config() }, teamSignature };
  win.init();
  return win;
}

function companyCard(overrides) {
  const win = loadPreview();
  const card = win.buildCard('Alderpoint', config(overrides), 'company-card');
  win.document.body.appendChild(card);
  return card;
}

function tab(card, lang) {
  return card.querySelector(`.lang-tab[data-lang="${lang}"]`);
}

function pane(card, lang) {
  return card.querySelector(`.signature-content[data-lang="${lang}"]`);
}

test('R1: a language tab is empty when its signature is missing, empty or whitespace only', () => {
  const card = companyCard({ english: undefined, german: '   ', french: '', italian: FULL });
  assert.ok(tab(card, 'english').classList.contains('empty'), 'missing english');
  assert.ok(tab(card, 'german').classList.contains('empty'), 'whitespace german');
  assert.ok(tab(card, 'french').classList.contains('empty'), 'empty french');
  assert.equal(tab(card, 'italian').classList.contains('empty'), false, 'italian has text');

  const withText = companyCard({ english: '', german: FULL });
  assert.ok(tab(withText, 'english').classList.contains('empty'));
  assert.equal(tab(withText, 'german').classList.contains('empty'), false, 'second language with text');
});

test('R1: a missing second language is empty while the first with text is not', () => {
  const cfg = config();
  delete cfg.german;
  const win = loadPreview();
  const card = win.buildCard('Alderpoint', cfg, 'company-card');
  assert.ok(tab(card, 'german').classList.contains('empty'));
  assert.equal(tab(card, 'english').classList.contains('empty'), false);
});

test('R2: a whitespace-only signature renders the same empty pane as a missing one', () => {
  const win = loadPreview();
  const missingCfg = config();
  delete missingCfg.german;
  const missing = win.buildCard('Alderpoint', missingCfg, 'company-card');
  const blank = win.buildCard('Alderpoint', config({ german: '   ' }), 'company-card');

  for (const card of [missing, blank]) {
    const el = pane(card, 'german').querySelector('.empty-signature');
    assert.ok(el, 'empty-signature element present');
    assert.equal(el.textContent.trim(), 'No signature defined');
  }
  assert.equal(pane(blank, 'german').innerHTML, pane(missing, 'german').innerHTML);
  assert.equal(pane(blank, 'german').textContent.trim(), 'No signature defined');
  assert.equal(pane(blank, 'english').querySelector('.empty-signature'), null, 'a language with text has no empty marker');
});

test('R3: a configured team signature renders one team card and counts it', () => {
  const win = startPage(config());
  const cards = win.document.querySelectorAll('#teamGrid .team-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].dataset.name, 'team signature');
  assert.equal(cards[0].querySelectorAll('.copy-btn').length, 1);
  assert.equal(win.document.getElementById('teamCount').textContent, '1');
  assert.equal(win.document.getElementById('content').hidden, false);
});

test('R4: an absent team signature leaves the team grid empty while brand cards still render', () => {
  for (const missing of [undefined, null]) {
    const win = startPage(missing);
    assert.equal(win.document.querySelectorAll('#teamGrid .team-card').length, 0);
    assert.equal(win.document.getElementById('teamCount').textContent, '0');
    assert.equal(win.document.querySelectorAll('#companyGrid .company-card').length, 1);
  }
});

test('R5: a team signature that is not an object shows the load error', () => {
  for (const bad of ['text', ['english'], 7]) {
    const win = startPage(bad);
    assert.equal(win.document.getElementById('errorMessage').hidden, false, JSON.stringify(bad));
    assert.equal(win.document.getElementById('content').hidden, true, JSON.stringify(bad));
  }
});
