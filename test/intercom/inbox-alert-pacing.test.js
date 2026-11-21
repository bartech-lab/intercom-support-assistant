'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const SETTLE_MS = 1500;
const TEAM = '900101';
const WS = 'demo1234';
const URL_WS = `${ORIGIN}/a/inbox/${WS}/inbox/team/123/conversation/456`;

function makeChrome(initialStore = {}) {
  const store = { ...initialStore };
  const listeners = [];
  const sent = [];
  return {
    __store: store,
    __sent: sent,
    runtime: { id: 'test-ext', sendMessage: msg => { sent.push(msg); } },
    storage: {
      local: {
        get(defaults, cb) {
          const result = {};
          if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
            Object.keys(defaults).forEach(k => { result[k] = (k in store) ? store[k] : defaults[k]; });
          }
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

const teamLink = count => fx.inboxNavLink({ teamId: TEAM, label: 'Urgent Alderpoint', count });

function build({ store = {}, links = [], url = URL_WS } = {}) {
  const chrome = makeChrome({ isaAlertEnabled: true, ...store });
  const html = fx.inboxHtml({ nav: links.length ? fx.inboxNav(links, []) : '' });
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
  window.__played = 0;
  if (window.ISA_ALERT_SOUNDS) window.ISA_ALERT_SOUNDS.play = () => { window.__played += 1; };
  const clock = { now: Date.now() };
  window.alertClock = () => clock.now;
  clock.now += SETTLE_MS + 1;
  window.evaluateInboxAlerts();
  return { window, chrome, clock };
}

function frame(win, counters, { observedAt = Date.now(), missingAsZero = true } = {}) {
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
        eventData: {
          counters,
          source: 'es',
          valid_for: null,
          treat_missing_assignees_as_zero: missingAsZero
        }
      }),
      observedAt
    }
  }));
}

function settle(ctx) {
  ctx.clock.now += SETTLE_MS + 1;
  ctx.window.evaluateInboxAlerts();
}

const alerts = ctx => ctx.chrome.__sent.filter(m => m && m.type === 'inbox-alert');


const WAIT = 3 * 60 * 1000;

function ring(ctx, from = 2, to = 5) {
  frame(ctx.window, [[TEAM, from]]);
  settle(ctx);
  frame(ctx.window, [[TEAM, to]]);
  settle(ctx);
  settle(ctx);
}

function advance(ctx, ms, count) {
  ctx.clock.now += ms;
  frame(ctx.window, [[TEAM, count]]);
  ctx.window.evaluateInboxAlerts();
}

function base(extra = {}) {
  return build({ store: { isaAlertEnabledInboxes: [TEAM], ...extra } });
}

const plain = value => JSON.parse(JSON.stringify(value));

test('an unmuted ring with repeat off plays the sound once and sends a plain message', () => {
  const ctx = base();
  ring(ctx);
  assert.equal(ctx.window.__played, 1);
  assert.equal(alerts(ctx).length, 1);
  const msg = plain(alerts(ctx)[0]);
  assert.equal(msg.teamId, TEAM);
  assert.equal(msg.label, 'Urgent Alderpoint');
  assert.equal(msg.count, 5);
  assert.equal('muted' in msg, false);
  assert.equal('repeat' in msg, false);
});

test('repeat off: nothing more is sent however much time passes with the count still up', () => {
  const ctx = base();
  ring(ctx);
  for (let i = 0; i < 6; i += 1) advance(ctx, WAIT, 5);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(ctx.window.__played, 1);
});

test('a ring while the mute timer runs plays no sound and is sent with muted true', () => {
  const ctx = base({ isaAlertMuteUntil: Date.now() + 3600000 });
  ring(ctx);
  assert.equal(ctx.window.__played, 0);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(alerts(ctx)[0].muted, true);
});

test('a ring after the mute timer has passed is not muted', () => {
  const ctx = base({ isaAlertMuteUntil: Date.now() - 1000 });
  ring(ctx);
  assert.equal(ctx.window.__played, 1);
  assert.equal('muted' in plain(alerts(ctx)[0]), false);
});

test('a ring in quiet hours plays no sound and is sent with muted true', () => {
  const hour = new Date(Date.now()).getHours();
  const start = `${String((hour + 23) % 24).padStart(2, '0')}:00`;
  const end = `${String((hour + 2) % 24).padStart(2, '0')}:00`;
  const ctx = base({ isaAlertQuietEnabled: true, isaAlertQuietStart: start, isaAlertQuietEnd: end });
  ring(ctx);
  assert.equal(ctx.window.__played, 0);
  assert.equal(alerts(ctx)[0].muted, true);
});

test('quiet hours that do not cover the current time leave the ring audible', () => {
  const hour = new Date(Date.now()).getHours();
  const start = `${String((hour + 3) % 24).padStart(2, '0')}:00`;
  const end = `${String((hour + 5) % 24).padStart(2, '0')}:00`;
  const ctx = base({ isaAlertQuietEnabled: true, isaAlertQuietStart: start, isaAlertQuietEnd: end });
  ring(ctx);
  assert.equal(ctx.window.__played, 1);
  assert.equal('muted' in plain(alerts(ctx)[0]), false);
});

test('a muted ring still shows in the sent list exactly once', () => {
  const ctx = base({ isaAlertMuteUntil: Date.now() + 3600000 });
  ring(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 1);
});

test('repeat on: three repeats follow every 3 minutes with the current count, then nothing', () => {
  const ctx = base({ isaAlertRepeat: true });
  ring(ctx, 2, 9);
  assert.equal(alerts(ctx).length, 1);
  advance(ctx, WAIT, 8);
  assert.equal(alerts(ctx).length, 2);
  assert.equal(alerts(ctx)[1].repeat, 1);
  assert.equal(alerts(ctx)[1].teamId, TEAM);
  assert.equal(alerts(ctx)[1].count, 8);
  assert.equal(ctx.window.__played, 2);
  advance(ctx, WAIT, 7);
  assert.equal(alerts(ctx)[2].repeat, 2);
  assert.equal(alerts(ctx)[2].count, 7);
  advance(ctx, WAIT, 6);
  assert.equal(alerts(ctx)[3].repeat, 3);
  assert.equal(alerts(ctx)[3].count, 6);
  assert.equal(ctx.window.__played, 4);
  advance(ctx, WAIT, 6);
  advance(ctx, WAIT, 6);
  assert.equal(alerts(ctx).length, 4);
  assert.equal(ctx.window.__played, 4);
});

test('repeat on: no repeat is sent before 3 minutes have passed', () => {
  const ctx = base({ isaAlertRepeat: true });
  ring(ctx);
  advance(ctx, WAIT - 5000, 5);
  assert.equal(alerts(ctx).length, 1);
});

test('repeat on: the count dropping to 0 before 3 minutes means no repeat', () => {
  const ctx = base({ isaAlertRepeat: true });
  ring(ctx);
  advance(ctx, 60000, 0);
  advance(ctx, WAIT, 0);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(ctx.window.__played, 1);
});

test('repeat on: a second genuine rise sends a normal ring and restarts the 3-minute wait', () => {
  const ctx = base({ isaAlertRepeat: true });
  ring(ctx);
  advance(ctx, 120000, 5);
  advance(ctx, 1500, 9);
  advance(ctx, 1500, 9);
  const sent = alerts(ctx);
  assert.equal(sent.length, 2);
  assert.equal('repeat' in plain(sent[1]), false);
  assert.equal(sent[1].count, 9);
  advance(ctx, WAIT - 5000, 9);
  assert.equal(alerts(ctx).length, 2, 'the old wait no longer applies');
  advance(ctx, 5000, 9);
  assert.equal(alerts(ctx).length, 3);
  assert.equal(alerts(ctx)[2].repeat, 1);
});

test('repeat on while muted when the repeat is due: no sound and no message', () => {
  const ctx = base({ isaAlertRepeat: true, isaAlertMuteUntil: Date.now() + 3600000 * 24 });
  ring(ctx);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(alerts(ctx)[0].muted, true);
  advance(ctx, WAIT, 5);
  advance(ctx, WAIT, 5);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(ctx.window.__played, 0);
});

test('repeat on, mute started after the ring: the due repeat is dropped silently', () => {
  const ctx = base({ isaAlertRepeat: true });
  ring(ctx);
  ctx.chrome.storage.local.set({ isaAlertMuteUntil: ctx.clock.now + 3600000 * 24 });
  advance(ctx, WAIT, 5);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(ctx.window.__played, 1);
});
