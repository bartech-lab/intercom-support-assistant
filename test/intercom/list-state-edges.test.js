'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const { inboxUrl, TAMSIN, row, rowFor } = require('../support/duplicate-conversations-harness');

const GRACE_MS = 2000;

test('a row inside nested list containers is listed once', () => {
  const win = loadExtension(fx.inboxHtml({
    list: fx.conversationList([row('1', TAMSIN), row('2', TAMSIN)], { state: 'Open', count: '2' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: inboxUrl });
  const outer = win.document.querySelector('[data-intercom-target-conversation-list], [data-intercom-target="conversation-list"], [data-testid="conversation-listbox"]');
  assert.ok(outer, 'the fixture renders a list container');
  const inner = win.document.createElement('div');
  inner.setAttribute('data-testid', 'conversation-listbox');
  while (outer.firstChild) inner.appendChild(outer.firstChild);
  outer.appendChild(inner);
  const ids = Array.from(win.computeConversationListRows()).map(element => element.getAttribute('data-conversation-id'));
  assert.deepEqual(ids, ['1', '2']);
});

test('the settled redraw of an unknown list also draws the support marker', () => {
  const timers = [];
  const win = loadExtension(fx.inboxHtml({
    list: fx.conversationList([row('1', TAMSIN)], { state: null, count: '27' }),
    composer: fx.composer({ mode: 'email' })
  }), {
    url: inboxUrl,
    beforeScripts(w) {
      w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
      w.clearTimeout = () => {};
    }
  });
  let now = Date.now();
  win.listStateClock = () => now;
  win.eval('listStateUnknownSince.clear()');
  win.rememberInboundAddresses('1', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  assert.equal(rowFor(win, '1').classList.contains('isa-support-origin-row'), false);

  now += GRACE_MS;
  timers.filter(timer => timer.ms === GRACE_MS).at(-1).fn();

  assert.equal(rowFor(win, '1').classList.contains('isa-support-origin-row'), true);
});
