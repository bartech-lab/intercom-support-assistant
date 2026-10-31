'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPreview } = require('../support/helpers');

const SAMPLE_CONFIG = {
  emoji: '',
  english: '--<br>Best regards<br>Maya Lindqvist<br>Customer Support at <a href="https://alderpoint.example">Alderpoint</a>',
  german: '--<br>Viele Grüße<br>Maya Lindqvist<br>Kundenservice bei <a href="https://alderpoint.example">Alderpoint</a>',
  french: '',
  italian: '',
  portuguese: '--<br>Com os melhores cumprimentos<br>Maya Lindqvist<br>Apoio ao Cliente em <a href="https://alderpoint.example">Alderpoint</a>',
  spanish: '--<br>Atentamente<br>Maya Lindqvist<br>Atención al Cliente en <a href="https://alderpoint.example">Alderpoint</a>',
  dutch: '--<br>Met vriendelijke groet<br>Maya Lindqvist<br>Klantenservice van <a href="https://alderpoint.example">Alderpoint</a>'
};

function makeCard(win) {
  const card = win.buildCard('Alderpoint', SAMPLE_CONFIG, 'company-card');
  win.document.body.appendChild(card);
  return card;
}

test('preview cards provide plain-text conversion and one copy button', () => {
  const win = loadPreview();
  const text = win.htmlToPlainText('Best regards<br>Maya Lindqvist<br>Customer Support at <a href="x">Alderpoint</a>');
  assert.strictEqual(text, 'Best regards\nMaya Lindqvist\nCustomer Support at Alderpoint');
  const card = win.buildCard('Alderpoint', SAMPLE_CONFIG, 'company-card');
  const buttons = card.querySelectorAll('.card-top .copy-btn');
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].getAttribute('aria-label'), 'Copy signature');
});

test('preview copy follows the active language with the plain-text fallback', async () => {
  const writes = [];
  const win = loadPreview(undefined, {
    clipboard: { writeText: async (value) => { writes.push(value); } },
    hasClipboardItem: false
  });
  win.bindCopyButtons();
  win.bindLanguageSwitching();
  const card = makeCard(win);

  card.querySelector('.copy-btn').click();
  await new Promise((resolve) => win.setTimeout(resolve, 0));
  card.querySelector('.lang-tab[data-lang="german"]').click();
  card.querySelector('.copy-btn').click();
  await new Promise((resolve) => win.setTimeout(resolve, 0));

  assert.strictEqual(writes.length, 2);
  assert.match(writes[0], /^--\nBest regards\nMaya Lindqvist\nCustomer Support at Alderpoint$/);
  assert.match(writes[1], /Viele Grüße/);
  assert.match(writes[1], /Kundenservice bei Alderpoint/);
});

test('preview copy writes rich clipboard data and skips empty panes', async () => {
  const items = [];
  const win = loadPreview(undefined, {
    clipboard: { write: async (data) => { items.push(data); } },
    hasClipboardItem: true
  });
  win.bindCopyButtons();
  const card = makeCard(win);

  card.querySelector('.copy-btn').click();
  await new Promise((resolve) => win.setTimeout(resolve, 0));

  assert.strictEqual(items.length, 1);
  const written = items[0][0].data;
  assert.ok(written['text/html'], 'writes a text/html blob');
  assert.ok(written['text/plain'], 'writes a text/plain blob');
  assert.strictEqual(written['text/html'].type, 'text/html');
  assert.strictEqual(written['text/plain'].type, 'text/plain');
  assert.ok(written['text/html'].size > written['text/plain'].size);

  const writes = [];
  const emptyWin = loadPreview(undefined, {
    clipboard: { writeText: async (value) => { writes.push(value); } },
    hasClipboardItem: false
  });
  emptyWin.bindCopyButtons();
  emptyWin.bindLanguageSwitching();
  const emptyCard = emptyWin.buildCard('Alderpoint', SAMPLE_CONFIG, 'company-card');
  emptyWin.document.body.appendChild(emptyCard);

  emptyCard.querySelector('.lang-tab[data-lang="french"]').click();
  emptyCard.querySelector('.copy-btn').click();
  await new Promise((resolve) => emptyWin.setTimeout(resolve, 0));

  assert.strictEqual(writes.length, 0);
});

test('preview cards render every language tab, and the new ones switch', async () => {
  const writes = [];
  const win = loadPreview(undefined, {
    clipboard: { writeText: async (value) => { writes.push(value); } },
    hasClipboardItem: false
  });
  win.bindCopyButtons();
  win.bindLanguageSwitching();
  const card = makeCard(win);

  const tabs = [...card.querySelectorAll('.lang-tab')].map((tab) => tab.textContent);
  assert.deepStrictEqual(Array.from(tabs), ['EN', 'DE', 'FR', 'IT', 'PT', 'ES', 'NL']);

  const expected = [
    ['portuguese', /Com os melhores cumprimentos/, /Apoio ao Cliente em Alderpoint/],
    ['spanish', /Atentamente/, /Atención al Cliente en Alderpoint/],
    ['dutch', /Met vriendelijke groet/, /Klantenservice van Alderpoint/]
  ];

  for (const [language, greeting, role] of expected) {
    card.querySelector(`.lang-tab[data-lang="${language}"]`).click();
    card.querySelector('.copy-btn').click();
    await new Promise((resolve) => win.setTimeout(resolve, 0));

    const written = writes[writes.length - 1];
    assert.match(written, greeting, language);
    assert.match(written, role, language);
  }

  assert.strictEqual(writes.length, expected.length);
});

function workspaceHtml() {
  return '<!doctype html><html><body>' +
    '<nav>' +
    '<a href="#signatures" data-section="signatures">Signatures</a>' +
    '<a href="#settings" data-section="settings">Settings</a>' +
    '<a href="#tools" data-section="tools">Tools</a>' +
    '</nav>' +
    '<section id="signatures" data-workspace-section><div id="status"></div><div id="errorMessage"></div>' +
    '<div id="content"><input id="searchInput"><span id="resultCount"></span><p id="searchEmpty" hidden></p>' +
    '<div id="companyGrid"></div><div id="teamGrid"></div>' +
    '<span id="companyCount"></span><span id="teamCount"></span></div>' +
    '<p id="copyStatus" aria-live="polite"></p></section>' +
    '<section id="settings" data-workspace-section><button id="settingsControl">Setting</button></section>' +
    '<section id="tools" data-workspace-section><button id="toolsControl">Tool</button></section>' +
    '</body></html>';
}

function initializeWorkspace(win, hash = '', data = { companies: {}, teamSignature: '' }) {
  win.history.replaceState(null, '', `/preview${hash}`);
  win.SIGNATURE_DATA = data;
  win.init();
}

test('workspace navigation normalizes routes, reuses mounted sections, and preserves scroll', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#unknown');

  const signatures = win.document.getElementById('signatures');
  const settings = win.document.getElementById('settings');
  const tools = win.document.getElementById('tools');
  const settingsLink = win.document.querySelector('[data-section="settings"]');

  const signaturesLink = win.document.querySelector('[data-section="signatures"]');
  assert.equal(win.location.hash, '#signatures');
  assert.equal(signatures.hidden, false);
  assert.equal(settings.hidden, true);
  assert.equal(settingsLink.getAttribute('aria-current'), null);
  assert.equal(signaturesLink.getAttribute('aria-current'), 'page');

  signatures.scrollTop = 18;
  settingsLink.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(win.location.hash, '#settings');
  assert.equal(settings.hidden, false);
  assert.equal(signatures.hidden, true);
  assert.equal(settingsLink.getAttribute('aria-current'), 'page');
  assert.equal(signaturesLink.getAttribute('aria-current'), null, 'the section that just went hidden loses its stale marker');
  settings.scrollTop = 27;

  win.document.querySelector('[data-section="tools"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  win.document.querySelector('[data-section="signatures"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(signatures.hidden, false);
  assert.equal(settings.hidden, true);
  assert.equal(signatures.scrollTop, 18);
  assert.equal(tools.querySelector('#toolsControl').isConnected, true);
});

test('workspace history events switch sections without rebuilding controls', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures');
  const control = win.document.getElementById('settingsControl');
  win.history.pushState(null, '', '#settings');
  win.dispatchEvent(new win.PopStateEvent('popstate'));
  assert.equal(win.document.getElementById('settings').hidden, false);
  assert.equal(win.document.getElementById('settingsControl'), control);

  win.history.replaceState(null, '', '#invalid');
  win.dispatchEvent(new win.PopStateEvent('popstate'));
  assert.equal(win.location.hash, '#signatures');
  assert.equal(win.document.getElementById('signatures').hidden, false);
});

test('deep links select their section and missing links default to signatures', () => {
  const deepLink = loadPreview(workspaceHtml());
  initializeWorkspace(deepLink, '#tools');
  assert.equal(deepLink.location.hash, '#tools');
  assert.equal(deepLink.document.getElementById('tools').hidden, false);
  assert.equal(deepLink.document.getElementById('signatures').hidden, true);

  const missing = loadPreview(workspaceHtml());
  initializeWorkspace(missing);
  assert.equal(missing.location.hash, '#signatures');
  assert.equal(missing.document.getElementById('signatures').hidden, false);
});

test('search, language, and hidden-section focus survive navigation', () => {
  const data = {
    companies: { 'Alderpoint': SAMPLE_CONFIG },
    teamSignature: SAMPLE_CONFIG
  };
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures', data);
  const search = win.document.getElementById('searchInput');
  search.value = 'alder';
  search.dispatchEvent(new win.Event('input', { bubbles: true }));
  const company = win.document.querySelector('.company-card');
  company.querySelector('[data-lang="german"]').click();
  const team = win.document.querySelector('.team-card');
  team.querySelector('[data-lang="french"]').click();
  const settingsLink = win.document.querySelector('[data-section="settings"]');
  search.focus();
  win.__isaWorkspaceNavigation.apply('settings');
  assert.equal(win.document.activeElement, settingsLink);
  win.__isaWorkspaceNavigation.apply('signatures');
  assert.equal(search.value, 'alder');
  assert.equal(company.querySelector('.lang-tab.active').dataset.lang, 'german');
  assert.equal(team.querySelector('.lang-tab.active').dataset.lang, 'french');
  assert.equal(win.document.querySelector('.company-card'), company);

  const settingsControl = win.document.getElementById('settingsControl');
  win.__isaWorkspaceNavigation.apply('settings');
  settingsControl.focus();
  assert.equal(win.document.activeElement, settingsControl);
  win.__isaWorkspaceNavigation.apply('signatures');
  assert.equal(win.document.activeElement, win.document.querySelector('[data-section="signatures"]'));
});

test('malformed signature data stays inside the signatures error state', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures', { companies: null });
  assert.match(win.document.getElementById('errorMessage').textContent, /Signatures could not load/);
  assert.equal(win.document.getElementById('content').hidden, true, 'the broken content pane must not stay visible');
  win.document.querySelector('[data-section="settings"]').click();
  assert.equal(win.document.getElementById('settings').hidden, false);
});

test('copy announces success and failure without changing card structure', async () => {
  const writes = [];
  const win = loadPreview(undefined, {
    clipboard: { writeText: async (value) => { writes.push(value); } },
    hasClipboardItem: false
  });
  win.bindCopyButtons();
  const card = makeCard(win);
  const status = win.document.createElement('p');
  status.id = 'copyStatus';
  win.document.body.appendChild(status);
  const initialCardHtml = card.innerHTML;
  card.querySelector('.copy-btn').click();
  await new Promise((resolve) => win.setTimeout(resolve, 0));
  assert.equal(writes.length, 1);
  assert.equal(status.textContent, 'Signature copied.');
  assert.ok(card.querySelector('.signature-preview'));
  assert.equal(card.querySelector('.card-top').parentNode, card);
  assert.notEqual(card.innerHTML, initialCardHtml);

  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
  card.querySelector('.copy-btn').click();
  await new Promise((resolve) => win.setTimeout(resolve, 0));
  assert.equal(status.textContent, 'Could not copy signature. Try again.');
});

test('the copy toast clears itself, and a newer announcement is never cut short by an older timer', () => {
  const win = loadPreview();
  const timers = [];
  win.setTimeout = (callback, delayMs) => { timers.push({ callback, delayMs }); return timers.length; };
  const status = win.document.createElement('p');
  status.id = 'copyStatus';
  win.document.body.appendChild(status);
  const runDue = delayMs => timers.splice(0).forEach(timer => {
    if (timer.delayMs === delayMs) timer.callback();
    else timers.push(timer);
  });

  win.announceCopy('Signature copied.');
  runDue(0);
  assert.equal(status.textContent, 'Signature copied.');
  const firstClear = timers.find(timer => timer.delayMs === 4000);
  assert.ok(firstClear, 'a clear is scheduled');

  win.announceCopy('Could not copy signature. Try again.');
  runDue(0);
  firstClear.callback();
  assert.equal(status.textContent, 'Could not copy signature. Try again.', 'the older timer leaves the newer toast');

  runDue(4000);
  assert.equal(status.textContent, '', 'the toast is emptied, so the fixed overlay collapses');
});

test('popup launch resets only the addressed workspace to the top without rebuilding signatures', () => {
  const win = loadPreview(workspaceHtml());
  let receive;
  win.requestAnimationFrame = callback => callback();
  win.chrome = {
    runtime: { onMessage: { addListener: listener => { receive = listener; } } },
    tabs: { getCurrent: callback => callback({ id: 42 }) }
  };
  initializeWorkspace(win);
  const navigation = win.__isaWorkspaceNavigation;
  const content = win.document.getElementById('content');
  const search = win.document.getElementById('searchInput');
  search.value = 'Harbor';
  navigation.viewportScrollPositions.set('signatures', 650);
  navigation.scrollPositions.set('signatures', 100);
  receive({ type: 'workspace-open', tabId: 99, section: 'signatures' });
  assert.equal(navigation.viewportScrollPositions.get('signatures'), 650);
  receive({ type: 'workspace-open', tabId: 42, section: 'signatures' });
  assert.equal(navigation.viewportScrollPositions.get('signatures'), 0);
  assert.equal(navigation.scrollPositions.get('signatures'), 0);
  assert.equal(win.document.getElementById('content'), content);
  assert.equal(search.value, 'Harbor');
  win.close();
});

test('a matching workspace-open message resets scroll immediately, not only via a later animation frame', () => {
  const win = loadPreview(workspaceHtml());
  let receive;
  const rafCallbacks = [];
  win.requestAnimationFrame = callback => { rafCallbacks.push(callback); return 1; };
  win.chrome = {
    runtime: { lastError: null, onMessage: { addListener: listener => { receive = listener; } } },
    tabs: { getCurrent: callback => callback({ id: 42 }) }
  };
  initializeWorkspace(win);
  const navigation = win.__isaWorkspaceNavigation;
  navigation.viewportScrollPositions.set('signatures', 650);
  navigation.scrollPositions.set('signatures', 100);
  receive({ type: 'workspace-open', tabId: 42, section: 'signatures' });
  assert.equal(navigation.viewportScrollPositions.get('signatures'), 0);
  assert.equal(navigation.scrollPositions.get('signatures'), 0);
  assert.equal(rafCallbacks.length, 1, 'the follow-up animation frame is still scheduled for the next paint');
});

test('a workspace-open message is ignored without throwing when chrome reports no current tab', () => {
  const win = loadPreview(workspaceHtml());
  let receive;
  win.chrome = {
    runtime: { lastError: null, onMessage: { addListener: listener => { receive = listener; } } },
    tabs: { getCurrent: callback => callback(undefined) }
  };
  initializeWorkspace(win);
  const navigation = win.__isaWorkspaceNavigation;
  navigation.viewportScrollPositions.set('signatures', 650);
  assert.doesNotThrow(() => receive({ type: 'workspace-open', tabId: 42, section: 'signatures' }));
  assert.equal(navigation.viewportScrollPositions.get('signatures'), 650);
});

test('reapplying the current section leaves an already-focused control alone', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures');
  const search = win.document.getElementById('searchInput');
  search.focus();
  win.__isaWorkspaceNavigation.apply('signatures');
  assert.equal(win.document.activeElement, search);
});

test('clicking the already-active section link only refocuses it, without a scroll jump', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures');
  const signaturesLink = win.document.querySelector('[data-section="signatures"]');
  const focusCalls = [];
  const originalFocus = signaturesLink.focus.bind(signaturesLink);
  signaturesLink.focus = (options) => { focusCalls.push(options); originalFocus(options); };
  signaturesLink.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(focusCalls.length, 1);
  assert.strictEqual(focusCalls[0].preventScroll, true);
});

test('switching sections calls window.scrollTo to restore the remembered viewport position', () => {
  const win = loadPreview(workspaceHtml());
  const calls = [];
  win.scrollTo = (x, y) => { calls.push(y); };
  Object.defineProperty(win, 'scrollY', { value: 999, configurable: true });
  initializeWorkspace(win, '#signatures');
  calls.length = 0;
  win.__isaWorkspaceNavigation.viewportScrollPositions.set('settings', 40);
  win.document.querySelector('[data-section="settings"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, [40]);
});

test('a signature card marks only the first language tab and pane active by default', () => {
  const win = loadPreview();
  const card = win.buildCard('Alderpoint', SAMPLE_CONFIG, 'company-card');
  const activeTabs = card.querySelectorAll('.lang-tab.active');
  const activePanes = card.querySelectorAll('.signature-content.active');
  assert.strictEqual(activeTabs.length, 1);
  assert.strictEqual(activeTabs[0].dataset.lang, 'english');
  assert.strictEqual(activePanes.length, 1);
  assert.strictEqual(activePanes[0].dataset.lang, 'english');
});

const OTHER_CONFIG = {
  emoji: '',
  english: '--<br>Cheers<br>Oskar Ferrant<br>Customer Support at <a href="https://brightwell.example">Brightwell</a>',
  german: '',
  french: '',
  italian: '',
  portuguese: '',
  spanish: '',
  dutch: ''
};

test('the empty-search state stays hidden until the user actually searches, even with nothing to show', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win);
  const empty = win.document.getElementById('searchEmpty');
  assert.equal(empty.hidden, true);
  assert.equal(empty.classList.contains('hidden'), true);
});

test('search filters signature cards and updates the result-count text', () => {
  const data = {
    companies: { 'Alderpoint': SAMPLE_CONFIG, Brightwell: OTHER_CONFIG },
    teamSignature: ''
  };
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures', data);
  const search = win.document.getElementById('searchInput');
  const resultCount = win.document.getElementById('resultCount');
  const empty = win.document.getElementById('searchEmpty');

  assert.equal(resultCount.textContent, '2 signatures');
  assert.equal(empty.hidden, true);

  search.value = 'alder';
  search.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(resultCount.textContent, '1 of 2 signatures');
  assert.equal(win.document.querySelector('.preview-card[data-name="alderpoint"]').classList.contains('hidden'), false);
  assert.equal(win.document.querySelector('.preview-card[data-name="brightwell"]').classList.contains('hidden'), true);
  assert.equal(empty.hidden, true);

  search.value = '  ALDER  ';
  search.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(resultCount.textContent, '1 of 2 signatures', 'surrounding spaces and case do not change the match');

  search.value = 'nonexistent';
  search.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(resultCount.textContent, '0 of 2 signatures');
  assert.equal(empty.hidden, false);
  assert.equal(empty.classList.contains('hidden'), false);
});

test('a configured team signature renders its own card', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures', {
    companies: {},
    teamSignature: SAMPLE_CONFIG
  });
  const grid = win.document.getElementById('teamGrid');
  assert.strictEqual(grid.children.length, 1);
  assert.strictEqual(win.document.getElementById('teamCount').textContent, '1');
});

test('signatures still render when teamSignature is left out of the data entirely', () => {
  const win = loadPreview(workspaceHtml());
  initializeWorkspace(win, '#signatures', { companies: { 'Alderpoint': SAMPLE_CONFIG } });
  assert.equal(win.document.getElementById('content').hidden, false);
  assert.strictEqual(win.document.querySelectorAll('.company-card').length, 1);
});
