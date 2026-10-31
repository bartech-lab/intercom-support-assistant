'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPreview } = require('../support/helpers');

const LANGS = ['english', 'german', 'french', 'italian', 'portuguese', 'spanish', 'dutch'];
const EN = '--<br>Best regards<br>Maya Lindqvist';
const DE = '--<br>Viele Grüße<br>Maya Lindqvist';

function config(overrides = {}) {
  const base = { emoji: '' };
  LANGS.forEach(lang => { base[lang] = ''; });
  return Object.assign(base, { english: EN, german: DE }, overrides);
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

function installClock(win) {
  const clock = { now: 0, queue: [], seq: 0 };
  win.setTimeout = (callback, delayMs = 0) => {
    clock.seq += 1;
    clock.queue.push({ id: clock.seq, at: clock.now + delayMs, callback });
    return clock.seq;
  };
  win.clearTimeout = (id) => {
    clock.queue = clock.queue.filter(entry => entry.id !== id);
  };
  clock.advance = (ms) => {
    const target = clock.now + ms;
    for (;;) {
      const due = clock.queue.filter(entry => entry.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock.queue = clock.queue.filter(entry => entry !== due);
      clock.now = due.at;
      due.callback();
    }
    clock.now = target;
  };
  return clock;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function readBlob(win, blob) {
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function setup({ rich = false, plain = false, writeFails = false } = {}) {
  const items = [];
  const texts = [];
  let clipboard;
  if (rich) clipboard = { write: async (data) => { items.push(data); } };
  else if (plain) clipboard = { writeText: async (value) => { texts.push(value); } };
  const win = loadPreview(pageHtml(), { clipboard, hasClipboardItem: rich });
  const clock = installClock(win);
  const errors = [];
  win.addEventListener('error', event => errors.push(event));
  const consoleCalls = [];
  win.console.error = (...args) => { consoleCalls.push(args); };
  win.bindCopyButtons();
  return { win, clock, items, texts, errors, consoleCalls };
}

function addCard(win, cfg) {
  const card = win.buildCard('Alderpoint', cfg, 'company-card');
  win.document.body.appendChild(card);
  return card;
}

function status(win) {
  return win.document.getElementById('copyStatus');
}

function ensureStatus(win) {
  let el = status(win);
  if (!el) {
    el = win.document.createElement('p');
    el.id = 'copyStatus';
    win.document.body.appendChild(el);
  }
  return el;
}

function startInit(data) {
  const win = loadPreview(pageHtml());
  win.history.replaceState(null, '', '/preview#signatures');
  win.SIGNATURE_DATA = data;
  win.init();
  return win;
}

function activePaneHtml(win, name) {
  const section = [...win.document.querySelectorAll('article.preview-card')].find(card => card.querySelector('.brand-name').textContent === name);
  return {
    english: section.querySelector('.signature-content[data-lang="english"]').innerHTML,
    german: section.querySelector('.signature-content[data-lang="german"]').innerHTML
  };
}

test('C1 company card-top holds copy button, brand icon and brand name in order', () => {
  const win = loadPreview();
  const withIcon = win.buildCard('Alderpoint', config({ emoji: 'https://e.test/i.png' }), 'company-card');
  const children = [...withIcon.querySelector('.card-top').children];
  assert.equal(withIcon.tagName, 'ARTICLE');
  assert.ok(withIcon.classList.contains('preview-card'));
  assert.equal(children.length, 3);
  assert.equal(children[0].classList.contains('copy-btn'), true);
  assert.deepEqual(children.slice(1).map(el => el.className), ['brand-icon', 'brand-name']);
  assert.deepEqual(children.map(el => el.tagName), [children[0].tagName, 'IMG', 'DIV']);
  assert.equal(children[1].getAttribute('src'), 'https://e.test/i.png');
  assert.equal(children[1].getAttribute('alt'), '');
  assert.equal(children[2].textContent, 'Alderpoint');

  const noIcon = win.buildCard('Alderpoint', config({ emoji: '' }), 'company-card');
  const top = noIcon.querySelector('.card-top');
  assert.equal(top.querySelector('img'), null);
  assert.equal(top.children.length, 2);
  assert.equal(top.children[0].classList.contains('copy-btn'), true);
  assert.equal(top.children[1].className, 'brand-name');
  assert.equal(top.children[1].textContent, 'Alderpoint');
});

test('C2 a banner with only english text leaves the german signature unchanged', () => {
  const plain = startInit({ companies: { 'Alderpoint': config() } });
  const baseline = activePaneHtml(plain, 'Alderpoint');

  const banner = '<b>SALE</b>';
  const win = startInit({
    companies: { 'Alderpoint': config() },
    promotionalBanners: { 'Alderpoint': { english: banner, expires: '2999-12-31' } }
  });
  const result = activePaneHtml(win, 'Alderpoint');
  assert.equal(result.german, baseline.german);
  assert.equal(result.german.includes('undefined'), false);
  assert.equal(result.english, '<br>' + banner + EN);
  assert.notEqual(result.english, baseline.english);
});

test('C3 copy collapses runs of three or more line breaks to one blank line', async () => {
  const html = 'A<br><br><br><br>B<br>';
  const { win, items } = setup({ rich: true });
  const card = addCard(win, config({ english: html }));
  card.querySelector('.copy-btn').click();
  await flush();
  assert.equal(items.length, 1);
  assert.equal(items[0].length, 1);
  const data = items[0][0].data;
  assert.deepEqual(Object.keys(data).sort(), ['text/html', 'text/plain']);
  assert.equal(await readBlob(win, data['text/plain']), 'A\n\nB');
  assert.equal(await readBlob(win, data['text/html']), html);
});

test('C4 a successful copy marks the button copied for 1500 ms', async () => {
  const { win, clock, texts } = setup({ plain: true });
  ensureStatus(win);
  const card = addCard(win, config());
  const button = card.querySelector('.copy-btn');
  button.click();
  await flush();
  assert.equal(texts.length, 1);
  assert.equal(button.classList.contains('copied'), true);
  assert.equal(button.getAttribute('title'), 'Copied');
  assert.equal(button.getAttribute('aria-label'), 'Copied');
  clock.advance(1499);
  assert.equal(button.classList.contains('copied'), true);
  clock.advance(1);
  assert.equal(button.classList.contains('copied'), false);
  assert.equal(button.getAttribute('title'), 'Copy signature');
  assert.equal(button.getAttribute('aria-label'), 'Copy signature');
});

test('C5 copying without any clipboard API announces the failure and logs it once', async () => {
  const { win, clock, consoleCalls } = setup();
  ensureStatus(win);
  assert.equal(win.navigator.clipboard, undefined);
  assert.equal(win.ClipboardItem, undefined);
  const card = addCard(win, config());
  const button = card.querySelector('.copy-btn');
  button.click();
  await flush();
  clock.advance(0);
  assert.equal(status(win).textContent, 'Could not copy signature. Try again.');
  assert.equal(consoleCalls.length, 1);
  assert.equal(consoleCalls[0][0], 'Copy failed:');
  assert.equal(button.classList.contains('copied'), false);
  clock.advance(1500);
  assert.equal(button.classList.contains('copied'), false);
});

test('C6 a pane with only line breaks copies nothing and announces nothing', async () => {
  const { win, clock, items, texts } = setup({ rich: true });
  ensureStatus(win);
  status(win).textContent = 'previous';
  const card = addCard(win, config({ english: '<br><br>' }));
  const button = card.querySelector('.copy-btn');
  button.click();
  await flush();
  clock.advance(0);
  assert.equal(items.length, 0);
  assert.equal(texts.length, 0);
  assert.equal(status(win).textContent, 'previous');
  assert.equal(button.classList.contains('copied'), false);
});

test('C7 a repeated announcement is re-set on the next tick and clears 4000 ms after the newest', async () => {
  const { win, clock, texts } = setup({ plain: true });
  ensureStatus(win);
  const card = addCard(win, config());
  const button = card.querySelector('.copy-btn');

  button.click();
  await flush();
  clock.advance(0);
  assert.equal(status(win).textContent, 'Signature copied.');

  button.click();
  await flush();
  assert.equal(texts.length, 2);
  assert.equal(status(win).textContent, '');
  clock.advance(0);
  assert.equal(status(win).textContent, 'Signature copied.');

  const later = setup({ plain: true });
  ensureStatus(later.win);
  const laterCard = addCard(later.win, config());
  const laterButton = laterCard.querySelector('.copy-btn');
  laterButton.click();
  await flush();
  later.clock.advance(3000);
  laterButton.click();
  await flush();
  later.clock.advance(0);
  assert.equal(status(later.win).textContent, 'Signature copied.');
  later.clock.advance(1500);
  assert.equal(status(later.win).textContent, 'Signature copied.');
  later.clock.advance(2499);
  assert.equal(status(later.win).textContent, 'Signature copied.');
  later.clock.advance(1);
  assert.equal(status(later.win).textContent, '');
});

test('C8 clicks outside a copy button or outside a preview card do nothing', async () => {
  const { win, clock, items, texts, errors } = setup({ rich: true });
  ensureStatus(win);
  status(win).textContent = 'previous';
  addCard(win, config());

  const plainDiv = win.document.createElement('div');
  win.document.body.appendChild(plainDiv);
  plainDiv.click();

  const strayButton = win.document.createElement('button');
  strayButton.className = 'copy-btn';
  win.document.body.appendChild(strayButton);
  strayButton.click();

  await flush();
  clock.advance(5000);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 0);
  assert.equal(texts.length, 0);
  assert.equal(status(win).textContent, 'previous');
  assert.equal(strayButton.classList.contains('copied'), false);
});

test('C7b three copies at 0, 2000 and 4500 ms clear only 4000 ms after the third', async () => {
  const { win, clock, texts } = setup({ plain: true });
  ensureStatus(win);
  const card = addCard(win, config());
  const button = card.querySelector('.copy-btn');
  const copyAt = async (time) => {
    clock.advance(time - clock.now);
    button.click();
    await flush();
    clock.advance(0);
  };

  await copyAt(0);
  await copyAt(2000);
  await copyAt(4500);
  assert.equal(texts.length, 3);
  assert.equal(status(win).textContent, 'Signature copied.');
  clock.advance(7000 - clock.now);
  assert.equal(status(win).textContent, 'Signature copied.');
  clock.advance(8499 - clock.now);
  assert.equal(status(win).textContent, 'Signature copied.');
  clock.advance(8500 - clock.now);
  assert.equal(status(win).textContent, '');
});
