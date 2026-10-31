'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPreview } = require('../support/helpers');

const SAMPLE_CONFIG = {
  emoji: '',
  english: '--<br>Best regards<br>Maya Lindqvist<br>Customer Support at <a href="https://alderpoint.example">Alderpoint</a>',
  german: '', french: '', italian: '', portuguese: '', spanish: '', dutch: ''
};
const ERROR_TEXT = 'Signatures could not load. Reload the extension and try again.';

function pageHtml(contentVisible) {
  return '<!doctype html><html><body>' +
    '<nav>' +
    '<a href="#signatures" data-section="signatures">Signatures</a>' +
    '<a href="#settings" data-section="settings">Settings</a>' +
    '</nav>' +
    '<section id="signatures" data-workspace-section><div id="status"></div><div id="errorMessage" class="hidden" hidden></div>' +
    '<div id="content"' + (contentVisible ? '' : ' class="hidden" hidden') + '><input id="searchInput"><span id="resultCount"></span><p id="searchEmpty" hidden></p>' +
    '<div id="companyGrid"></div><div id="teamGrid"></div>' +
    '<span id="companyCount"></span><span id="teamCount"></span></div>' +
    '<p id="copyStatus" aria-live="polite"></p></section>' +
    '<section id="settings" data-workspace-section><button id="settingsControl">Setting</button></section>' +
    '</body></html>';
}

function start(data, setup, contentVisible = false) {
  const win = loadPreview(pageHtml(contentVisible));
  if (setup) setup(win);
  win.history.replaceState(null, '', '/preview#signatures');
  win.SIGNATURE_DATA = data;
  win.init();
  return win;
}

function startOnError(data) {
  return start(data, null, true);
}

function assertErrorScreen(win, label) {
  const d = win.document;
  assert.ok(d.getElementById('status').classList.contains('hidden'), `${label}: status hidden`);
  const err = d.getElementById('errorMessage');
  assert.equal(err.textContent, ERROR_TEXT, `${label}: error text`);
  assert.equal(err.classList.contains('hidden'), false, `${label}: error class`);
  assert.equal(err.hidden, false, `${label}: error hidden prop`);
  const content = d.getElementById('content');
  assert.ok(content.classList.contains('hidden'), `${label}: content class hidden`);
  assert.equal(content.hidden, true, `${label}: content hidden prop`);
}

test('a missing or invalid SIGNATURE_DATA shows the error screen', () => {
  assertErrorScreen(startOnError(undefined), 'missing');
  assertErrorScreen(startOnError(null), 'null');
});

test('SIGNATURE_DATA validation: bad shapes show the error, an absent team signature is valid', () => {
  const cases = {
    'data is an array': [],
    'companies missing': { teamSignature: SAMPLE_CONFIG },
    'companies is an array': { companies: [], teamSignature: SAMPLE_CONFIG },
    'teamSignature is an array': { companies: {}, teamSignature: [] },
    'teamSignature is a string': { companies: {}, teamSignature: 'x' }
  };
  for (const [name, data] of Object.entries(cases)) {
    assertErrorScreen(startOnError(data), name);
  }
  const ok = start({ companies: { 'Alderpoint': SAMPLE_CONFIG } });
  assert.equal(ok.document.getElementById('content').hidden, false, 'absent teamSignature renders');
  assert.equal(ok.document.getElementById('errorMessage').textContent, '', 'no error text when valid');
});

test('the success screen shows content and the card counts', () => {
  const data = {
    companies: { 'Alderpoint': SAMPLE_CONFIG, Brightwell: SAMPLE_CONFIG, Third: SAMPLE_CONFIG },
    teamSignature: SAMPLE_CONFIG
  };
  const win = start(data);
  const d = win.document;
  assert.ok(d.getElementById('status').classList.contains('hidden'));
  const content = d.getElementById('content');
  assert.equal(content.classList.contains('hidden'), false);
  assert.equal(content.hidden, false);
  assert.equal(d.getElementById('companyGrid').children.length, 3);
  assert.equal(d.getElementById('companyCount').textContent, '3');
  assert.equal(d.getElementById('teamCount').textContent, '1');
  assert.equal(d.getElementById('teamGrid').children.length, 1);

  const without = start({ companies: { A: SAMPLE_CONFIG } });
  assert.equal(without.document.getElementById('teamGrid').children.length, 0);
  assert.equal(without.document.getElementById('companyGrid').children.length, 1);
  assert.equal(without.document.getElementById('companyCount').textContent, '1');
  assert.equal(without.document.getElementById('teamCount').textContent, '0');
});

test('init runs once: a second call does not render the cards again', () => {
  const win = start({ companies: { A: SAMPLE_CONFIG, B: SAMPLE_CONFIG }, teamSignature: SAMPLE_CONFIG });
  const d = win.document;
  assert.equal(d.getElementById('companyGrid').children.length, 2);
  win.init();
  assert.equal(d.getElementById('companyGrid').children.length, 2);
  assert.equal(d.getElementById('teamGrid').children.length, 1);
  assert.equal(d.querySelectorAll('.preview-card').length, 3);
});

test('workspace-open message opens settings at the top for the matching tab only', () => {
  const data = { companies: {}, teamSignature: '' };

  function setupWin(opts = {}) {
    const lastError = 'lastError' in opts ? opts.lastError : null;
    const tab = 'tab' in opts ? opts.tab : { id: 42 };
    let receive;
    const rafs = [];
    const win = start(data, (w) => {
      w.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
      w.chrome = {
        runtime: { lastError, onMessage: { addListener: (l) => { receive = l; } } },
        tabs: { getCurrent: (cb) => cb(tab) }
      };
    });
    return { win, receive, rafs, nav: win.__isaWorkspaceNavigation };
  }

  {
    const { win, receive, rafs, nav } = setupWin();
    const settings = win.document.getElementById('settings');
    settings.scrollTop = 80;
    nav.scrollPositions.set('settings', 80);
    nav.viewportScrollPositions.set('settings', 300);
    receive({ type: 'workspace-open', tabId: 42, section: 'settings' });
    assert.equal(settings.hidden, false, 'settings visible');
    assert.equal(win.document.getElementById('signatures').hidden, true, 'signatures hidden');
    assert.equal(settings.scrollTop, 0, 'settings scrollTop reset');
    assert.equal(nav.scrollPositions.get('settings'), 0, 'stored settings scroll reset');
    assert.equal(nav.viewportScrollPositions.get('settings'), 0, 'viewport scroll reset');
    assert.ok(rafs.length >= 1, 'a frame is scheduled');
    settings.scrollTop = 55;
    nav.scrollPositions.set('settings', 55);
    nav.viewportScrollPositions.set('settings', 200);
    rafs.forEach((cb) => cb());
    assert.equal(settings.scrollTop, 0, 'frame resets settings scrollTop');
    assert.equal(nav.scrollPositions.get('settings'), 0, 'frame resets stored scroll');
    assert.equal(nav.viewportScrollPositions.get('settings'), 0, 'frame resets viewport scroll');
  }

  const ignored = {
    'another tabId': { message: { type: 'workspace-open', tabId: 7, section: 'settings' } },
    'another type': { message: { type: 'other', tabId: 42, section: 'settings' } },
    'null message': { message: null },
    'lastError set': { message: { type: 'workspace-open', tabId: 42, section: 'settings' }, lastError: { message: 'boom' } },
    'no current tab': { message: { type: 'workspace-open', tabId: 42, section: 'settings' }, tab: undefined }
  };
  for (const [name, c] of Object.entries(ignored)) {
    const opts = {};
    if ('lastError' in c) opts.lastError = c.lastError;
    if ('tab' in c) opts.tab = c.tab;
    const { win, receive, rafs, nav } = setupWin(opts);
    const settings = win.document.getElementById('settings');
    settings.scrollTop = 80;
    nav.scrollPositions.set('settings', 80);
    nav.viewportScrollPositions.set('settings', 300);
    receive(c.message);
    rafs.forEach((cb) => cb());
    assert.equal(settings.hidden, true, `${name}: settings stays hidden`);
    assert.equal(win.document.getElementById('signatures').hidden, false, `${name}: signatures stays`);
    assert.equal(settings.scrollTop, 80, `${name}: scrollTop untouched`);
    assert.equal(nav.scrollPositions.get('settings'), 80, `${name}: stored scroll untouched`);
    assert.equal(nav.viewportScrollPositions.get('settings'), 300, `${name}: viewport untouched`);
  }
});
