'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/team/900201/conversation/900476928560574';
const INBOX_LIST_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900201?view=List';

function loadShadow(markup = '<div id="inside"></div>', options = {}) {
  return loadExtension('<!doctype html><html><head></head><body><div id="teammate-app-react"></div></body></html>', {
    url: CONVERSATION_URL,
    ...options,
    beforeScripts(w) {
      w.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' }).innerHTML = markup;
    }
  });
}

test('a style is injected once per root, marked as ours, with the shadow root getting its own css', () => {
  const win = loadShadow();
  const shadow = win.document.getElementById('teammate-app-react').shadowRoot;

  win.injectStyleOnce('isa-test-style', 'a { color: red; }', 'b { color: blue; }');
  win.injectStyleOnce('isa-test-style', 'a { color: red; }', 'b { color: blue; }');

  const documentStyles = win.document.querySelectorAll('#isa-test-style');
  const shadowStyles = shadow.querySelectorAll('#isa-test-style');
  assert.equal(documentStyles.length, 1);
  assert.equal(shadowStyles.length, 1);
  assert.equal(documentStyles[0].textContent, 'a { color: red; }');
  assert.equal(shadowStyles[0].textContent, 'b { color: blue; }');
  assert.ok(documentStyles[0].hasAttribute('data-isa-own'));
  assert.ok(shadowStyles[0].hasAttribute('data-isa-own'));
});

test('a remounted Intercom shadow host is queried, not the detached old one', () => {
  const win = loadShadow('<div id="inside">old</div>');
  assert.equal(win.queryIntercom('#inside')?.textContent, 'old');

  win.document.getElementById('teammate-app-react').remove();
  const host = win.document.createElement('div');
  host.id = 'teammate-app-react';
  host.attachShadow({ mode: 'open' }).innerHTML = '<div id="inside">new</div>';
  win.document.body.appendChild(host);

  assert.equal(win.queryIntercom('#inside')?.textContent, 'new');
});

test('the conversation stream is found through its fallback attribute', () => {
  const win = loadExtension(fx.inboxHtml({
    conversation: '<div id="stream" data-intercom-target-conversation-stream=""></div>'
  }), { url: CONVERSATION_URL });
  assert.equal(win.getConversationStream()?.id, 'stream');
});

test('an invalid selector is reported invalid, not as zero matches', () => {
  const win = loadShadow();
  win.eval("SELECTORS.isaBrokenForTest = 'div['");
  const report = win.anchorSelectorReport('isaBrokenForTest');
  assert.equal(report.valid, false);
  assert.equal(win.anchorSelectorReport('isaMissingForTest').valid, false);
});

test('views decide which anchors apply, and no anchor applies outside the inbox', () => {
  const win = loadShadow();
  assert.equal(win.anchorAppliesToView({ views: 'any' }, 'other'), false);
  assert.equal(win.anchorAppliesToView({ views: 'any' }, 'inbox-list'), true);
  assert.equal(win.anchorAppliesToView({ views: ['conversation', 'inbox-list'] }, 'inbox-list'), true);
  assert.equal(win.anchorAppliesToView({ views: ['conversation'] }, 'inbox-list'), false);
  assert.equal(win.anchorAppliesToView({ views: 'conversation' }, 'conversation'), true);
});

test('an inbox list page is its own view, and an anchor found outside its view still reads ok', () => {
  const win = loadExtension(fx.inboxHtml({
    toolbar: fx.conversationToolbar({ close: true })
  }), { url: INBOX_LIST_URL });
  const report = win.buildAnchorHealthReport();
  assert.equal(report.view, 'inbox-list');
  const closeGuard = report.anchors.find(anchor => anchor.selectors.some(s => s.key === 'closeConversationIcon'));
  assert.equal(closeGuard.expected, false);
  assert.equal(closeGuard.status, 'ok');
});

test('a field is hidden behind See all only when a See all control is present', () => {
  const win = loadExtension(fx.inboxHtml({ sidebar: fx.sidebarSection({ conversationAttrs: [] }) }), { url: CONVERSATION_URL });
  const panel = win.buildTruncatedPanelReport().find(entry => entry.id === 'conversationAttributes');
  assert.equal(panel.seeAllPresent, false);
  assert.ok(panel.fields.length > 0);
  assert.ok(panel.fields.every(field => field.rendered === false && field.hiddenBehindSeeAll === false));
});
