'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const SETTLE_MS = 1500;
const WS = 'demo1234';
const TEAM = '90082875';
const OTHER_TEAM = '900202';
const CONV_A = '900827357995625';
const CONV_B = '900889801391141';
const INTERVAL = 60000;
const START_URL = `${ORIGIN}/a/inbox/${WS}/inbox/admin/9007768`;

const teamUrl = `${ORIGIN}/a/inbox/${WS}/inbox/team/${TEAM}`;
const sharedConv = id => `${ORIGIN}/a/inbox/${WS}/inbox/shared/all/conversation/${id}`;
const searchConv = id => `${ORIGIN}/a/inbox/${WS}/search/conversation/${id}`;

function makeChrome(initialStore) {
  const store = { ...initialStore };
  const listeners = [];
  const sent = [];
  return {
    __sent: sent,
    runtime: { id: 'test-ext', sendMessage: msg => { sent.push(msg); } },
    storage: {
      local: {
        get(defaults, cb) {
          const result = {};
          Object.keys(defaults).forEach(k => { result[k] = (k in store) ? store[k] : defaults[k]; });
          cb(result);
        },
        set(items, cb) {
          const changes = {};
          Object.keys(items).forEach(k => {
            changes[k] = { oldValue: store[k], newValue: items[k] };
            store[k] = items[k];
          });
          listeners.forEach(fn => fn(changes, 'local'));
          if (typeof cb === 'function') cb();
        }
      },
      onChanged: { addListener: fn => listeners.push(fn) }
    }
  };
}

function build(url = START_URL) {
  const chrome = makeChrome({
    isaAlertEnabled: true,
    isaAlertEnabledInboxes: [TEAM],
    isaAlertRepeat: true,
    isaAlertRepeatMinutes: 1
  });
  const html = fx.inboxHtml({ nav: '' });
  const window = loadExtension(html, {
    url,
    beforeScripts(win) {
      win.chrome = chrome;
      win.setInterval = () => 1;
      win.clearInterval = () => {};
      win.setTimeout = () => 1;
      win.clearTimeout = () => {};
      const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
      if (proto) {
        proto.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {} });
        proto.toDataURL = () => 'data:image/png;base64,BADGE';
      }
    }
  });
  const clock = { now: Date.now() };
  window.alertClock = () => clock.now;
  clock.now += SETTLE_MS + 1;
  window.evaluateInboxAlerts();
  return { window, chrome, clock };
}

function frame(win, counters) {
  win.dispatchEvent(new win.MessageEvent('message', {
    source: win,
    origin: ORIGIN,
    data: {
      __isaic: true,
      version: 1,
      kind: 'nexus-frame',
      url: 'wss://nexus-websocket-a.intercom.io/pubsub/abc',
      data: JSON.stringify({
        eventName: 'CountersUpdated',
        eventData: { counters, source: 'es', valid_for: null, treat_missing_assignees_as_zero: true }
      }),
      observedAt: Date.now()
    }
  }));
}

function teach(win, conversationId, teamId) {
  win.dispatchEvent(new win.MessageEvent('message', {
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'conversation-team', conversationId, teamId, source: 'summary' }
  }));
}

function settle(ctx) {
  ctx.clock.now += SETTLE_MS + 1;
  ctx.window.evaluateInboxAlerts();
}

function ring(ctx) {
  frame(ctx.window, [[TEAM, 0]]);
  settle(ctx);
  frame(ctx.window, [[TEAM, 1]]);
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 1);
}

function navigate(ctx, url) {
  const u = new URL(url);
  ctx.window.history.pushState({}, '', u.pathname + u.search);
}

function setHidden(win, hidden) {
  Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
}

function waitInterval(ctx, steps = 4) {
  for (let i = 0; i < steps; i += 1) {
    ctx.clock.now += INTERVAL;
    frame(ctx.window, [[TEAM, 1]]);
    ctx.window.evaluateInboxAlerts();
  }
}

const alerts = ctx => ctx.chrome.__sent.filter(m => m && m.type === 'inbox-alert');
const repeats = ctx => alerts(ctx).filter(m => m.repeat);

function ringed(url) {
  const ctx = build(url);
  setHidden(ctx.window, false);
  return ctx;
}

test('control: staying away from the inbox and its chats lets the repeat fire', () => {
  const ctx = ringed();
  ring(ctx);
  waitInterval(ctx);
  assert.equal(repeats(ctx).length >= 1, true);
});

test('opening the inbox by its team URL with the tab visible stops the repeat', () => {
  const ctx = ringed();
  ring(ctx);
  navigate(ctx, teamUrl);
  waitInterval(ctx);
  assert.equal(repeats(ctx).length, 0);
});

test('opening a chat of the team through another route stops the repeat', () => {
  const ctx = ringed();
  teach(ctx.window, CONV_A, TEAM);
  ring(ctx);
  navigate(ctx, sharedConv(CONV_A));
  waitInterval(ctx);
  assert.equal(repeats(ctx).length, 0);
});

test('opening a team chat from a search URL also stops the repeat', () => {
  const ctx = ringed();
  teach(ctx.window, CONV_A, TEAM);
  ring(ctx);
  navigate(ctx, searchConv(CONV_A));
  waitInterval(ctx);
  assert.equal(repeats(ctx).length, 0);
});

test('learning the chat team after opening it still stops the repeat', () => {
  const ctx = ringed();
  ring(ctx);
  navigate(ctx, sharedConv(CONV_A));
  teach(ctx.window, CONV_A, TEAM);
  waitInterval(ctx);
  assert.equal(repeats(ctx).length, 0);
});

test('a team chat already open at the ring, kept open, still repeats', () => {
  const ctx = ringed(sharedConv(CONV_A));
  teach(ctx.window, CONV_A, TEAM);
  ring(ctx);
  waitInterval(ctx);
  assert.equal(repeats(ctx).length >= 1, true);
});

test('switching from the already-open team chat to another chat of the team stops the repeat', () => {
  const ctx = ringed(sharedConv(CONV_A));
  teach(ctx.window, CONV_A, TEAM);
  teach(ctx.window, CONV_B, TEAM);
  ring(ctx);
  navigate(ctx, sharedConv(CONV_B));
  waitInterval(ctx);
  assert.equal(repeats(ctx).length, 0);
});

test('opening a chat of a different team leaves the repeat running', () => {
  const ctx = ringed();
  teach(ctx.window, CONV_A, OTHER_TEAM);
  ring(ctx);
  navigate(ctx, sharedConv(CONV_A));
  waitInterval(ctx);
  assert.equal(repeats(ctx).length >= 1, true);
});

test('opening a chat of the team while the tab is hidden leaves the repeat running', () => {
  const ctx = ringed();
  teach(ctx.window, CONV_A, TEAM);
  ring(ctx);
  setHidden(ctx.window, true);
  navigate(ctx, sharedConv(CONV_A));
  waitInterval(ctx);
  assert.equal(repeats(ctx).length >= 1, true);
});

test('opening a chat whose team is unknown leaves the repeat running', () => {
  const ctx = ringed();
  ring(ctx);
  navigate(ctx, sharedConv(CONV_A));
  waitInterval(ctx);
  assert.equal(repeats(ctx).length >= 1, true);
});
