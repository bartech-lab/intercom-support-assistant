'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const CONVERSATION_ID = '900401386132981';
const UNKNOWN_TEAM = '900999';
const BAR = '<div data-testid="composer-actions-bar"><div class="bar-first"></div><div class="bar-second"></div></div>';
const SETTLE_MS = 2000;
const START = 1000000;
const UNCLEAR = { teamInbox: 'Support Brightwell', brand: 'Alderpoint' };

function conversationUrl(teamId, conversationId = CONVERSATION_ID) {
  return `${ORIGIN}/a/inbox/demo1234/inbox/team/${teamId}/conversation/${conversationId}`;
}

function html({
  mode = 'email',
  bar = BAR,
  teamInbox = UNCLEAR.teamInbox,
  brand = UNCLEAR.brand,
  customerText = 'Hello',
  react = null
} = {}) {
  const composer = fx.composer({ mode })
    .replace('<button>Send</button>', `${bar}<button>Send</button>`)
    .replace('role="textbox"', 'role="textbox" tabindex="0"');
  const sidebar = react
    ? fx.reactSidebarSection({
      teamInbox,
      conversationId: react.sidebarConversationId,
      conversationAttrs: brand ? [fx.reactConversationAttrRow('9006910', 'Brand', brand)] : []
    })
    : fx.sidebarSection({
      teamInbox,
      conversationAttrs: brand ? [fx.conversationAttrRow('9006910', 'Brand', brand)] : []
    });
  return fx.inboxHtml({
    sidebar,
    conversation: fx.conversationSpace({ customerText }),
    composer
  });
}

function load(options = {}, teamId = UNKNOWN_TEAM) {
  const chrome = makeChromeStub();
  const calls = { warn: [] };
  const win = loadExtension(html(options), {
    url: conversationUrl(teamId),
    chromeStub: chrome,
    beforeScripts(w) {
      w.console = {
        log: () => {},
        error: () => {},
        debug: () => {},
        warn: (...args) => calls.warn.push(args.join(' '))
      };
    }
  });
  const clock = { now: START };
  win.Date.now = () => clock.now;
  win.handleConversationChange();
  return { win, chrome, clock, calls };
}

function setBody(win, options) {
  win.document.body.innerHTML = html(options);
}

function holders(win) {
  return [...win.document.querySelectorAll('.isa-signature-status')];
}

function refresh(win) {
  assert.equal(typeof win.refreshSignatureStatus, 'function');
  win.refreshSignatureStatus();
  return holders(win);
}

function settle(ctx) {
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS;
  return refresh(ctx.win);
}

function recordTimers(win) {
  const timers = [];
  win.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };
  return {
    settle: () => timers.filter(timer => timer.delay > 0 && timer.delay <= SETTLE_MS)
  };
}

test('the chip appears on its own when the single settle timer fires, without another refresh', () => {
  const ctx = load();
  const timers = recordTimers(ctx.win);
  assert.equal(refresh(ctx.win).length, 0);
  const scheduled = timers.settle();
  assert.equal(scheduled.length, 1);
  ctx.clock.now += SETTLE_MS;
  scheduled[0].callback();
  assert.equal(holders(ctx.win).length, 1);
  assert.equal(holders(ctx.win)[0].getAttribute('data-isa-signature-status'), 'brand-unclear');
});

test('a second refresh during the same settle wait does not schedule another timer', () => {
  const ctx = load();
  const timers = recordTimers(ctx.win);
  refresh(ctx.win);
  ctx.clock.now += 500;
  assert.equal(refresh(ctx.win).length, 0);
  assert.equal(timers.settle().length, 1);
});

test('a later settle wait schedules a new timer after the first one fired', () => {
  const ctx = load();
  const timers = recordTimers(ctx.win);
  refresh(ctx.win);
  ctx.clock.now += SETTLE_MS;
  timers.settle()[0].callback();
  assert.equal(holders(ctx.win).length, 1);
  setBody(ctx.win, { teamInbox: 'Support Alderpoint', brand: 'Alderpoint' });
  assert.equal(refresh(ctx.win).length, 0);
  const before = timers.settle().length;
  setBody(ctx.win, {});
  assert.equal(refresh(ctx.win).length, 0);
  assert.equal(timers.settle().length, before + 1);
});

test('a holder left outside the composer after a re-render is replaced by exactly one holder inside it', () => {
  const ctx = load();
  const [stale] = settle(ctx);
  assert.ok(stale);
  ctx.win.document.body.appendChild(stale);
  assert.equal(stale.parentElement, ctx.win.document.body);
  const found = refresh(ctx.win);
  assert.equal(found.length, 1);
  assert.equal(found[0].parentElement, ctx.win.document.querySelector('.bar-first'));
});
