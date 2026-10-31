'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ALDER = '90005450';
const SETTLE_MS = 1500;

function makeChrome(initialStore = {}) {
  const store = { ...initialStore };
  const changedListeners = [];
  const sent = [];
  return {
    __store: store,
    __sent: sent,
    runtime: {
      id: 'test-ext',
      sendMessage: msg => { sent.push(msg); }
    },
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
          changedListeners.forEach(fn => fn(changes, 'local'));
          if (typeof cb === 'function') cb();
        }
      },
      onChanged: { addListener: fn => changedListeners.push(fn) }
    }
  };
}

function setCount(window, teamId, count) {
  const link = window.document.querySelector(`a[href*="/inbox/team/${teamId}?"]`);
  if (!link) return;
  let badge = link.querySelector('.count');
  if (count === null || count === undefined) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = window.document.createElement('span');
    badge.className = 'count';
    link.appendChild(badge);
  }
  badge.textContent = String(count);
}

const alderLink = count => fx.inboxNavLink({ teamId: ALDER, label: 'Urgent Alderpoint', count });

function buildFakeClock({ store = {}, links = [] } = {}) {
  const chrome = makeChrome(store);
  const played = [];
  const logs = [];
  const html = fx.inboxHtml({ nav: fx.inboxNav(links, []) });
  const window = loadExtension(html, {
    beforeScripts(win) {
      win.chrome = chrome;
      win.setInterval = () => 1;
      win.clearInterval = () => {};
      win.setTimeout = () => 1;
      win.clearTimeout = () => {};
      win.console.log = (...args) => logs.push(args.join(' '));
      const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
      if (proto) {
        proto.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {} });
        proto.toDataURL = () => 'data:image/png;base64,BADGE';
      }
    }
  });
  if (window.ISA_ALERT_SOUNDS) window.ISA_ALERT_SOUNDS.play = id => { played.push(id); };
  const clock = { now: Date.now() };
  window.alertClock = () => clock.now;
  clock.now += SETTLE_MS + 1;
  window.evaluateInboxAlerts();
  return { window, chrome, played, logs, clock };
}

function step(ctx, mutate) {
  ctx.chrome.__sent.length = 0;
  ctx.played.length = 0;
  if (typeof mutate === 'function') mutate();
  ctx.window.evaluateInboxAlerts();
  ctx.clock.now += SETTLE_MS + 1;
  ctx.window.evaluateInboxAlerts();
  return { sent: ctx.chrome.__sent.slice(), played: ctx.played.slice() };
}

test('mergeRoster drops an entry with no usable team id instead of stringifying null or undefined', () => {
  const ctx = buildFakeClock({ links: [alderLink(0)] });
  const result = ctx.window.mergeRoster([{ label: 'Bogus, no id' }, { teamId: '123', label: 'Real' }]);
  assert.deepEqual(Array.from(result, r => r.teamId), ['123']);
});

test('the alert debug trace is off by default, matching the opt-in diagnostic', () => {
  const ctx = buildFakeClock({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [ALDER] },
    links: [alderLink(0)]
  });
  ctx.window.evaluateInboxAlerts();
  assert.ok(!ctx.logs.some(line => line.includes('[isa-alert]')),
    'nothing is traced until isaAlertDebug is explicitly turned on');
});

test('the sound chosen in settings is what actually plays on a rising alert', () => {
  const ctx = buildFakeClock({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [ALDER] },
    links: [alderLink(0)]
  });
  ctx.chrome.storage.local.set({ isaAlertSound: 'marimba' });
  const r = step(ctx, () => setCount(ctx.window, ALDER, 2));
  assert.equal(r.played[0], 'marimba', 'the chosen sound must play, not always the default');
});

test('the settle-recheck timer itself re-evaluates a rising count, not just a manual re-call', () => {
  const chrome = makeChrome({
    isaAlertEnabled: true,
    isaAlertEnabledInboxes: [ALDER],
    isaAlertLastSeen: { [ALDER]: 0 }
  });
  const html = fx.inboxHtml({ nav: fx.inboxNav([alderLink(0)], []) });
  const timers = [];
  const runSettleTimers = () => {
    const due = timers.filter(t => t.ms === SETTLE_MS);
    timers.length = 0;
    due.forEach(t => t.fn());
    return due.length;
  };
  const window = loadExtension(html, {
    beforeScripts(win) {
      win.chrome = chrome;
      win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
      win.clearTimeout = () => {};
      win.MutationObserver = class {
        observe() {}
        disconnect() {}
      };
      const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
      if (proto) {
        proto.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {} });
        proto.toDataURL = () => 'data:image/png;base64,BADGE';
      }
    }
  });

  const clock = { now: Date.now() + SETTLE_MS + 1 };
  window.alertClock = () => clock.now;
  runSettleTimers();
  assert.equal(chrome.__sent.length, 0, 'the stable baseline settles quietly');

  setCount(window, ALDER, 3);
  window.evaluateInboxAlerts();
  assert.equal(chrome.__sent.length, 0, 'the rise is not yet settled on the first read');

  clock.now += SETTLE_MS + 1;
  assert.equal(runSettleTimers(), 1, 'the rise schedules exactly one settle recheck');
  assert.equal(chrome.__sent.length, 1,
    'the settle-recheck timer must fire evaluateInboxAlerts on its own, with no further manual call');
  assert.equal(chrome.__sent[0].teamId, ALDER);
  assert.equal(chrome.__sent[0].count, 3);
  window.close();
});
