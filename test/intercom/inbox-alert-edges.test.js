'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ALDER = '123';
const OTHER = '1234';
const SETTLE_MS = 1500;
const LAST_SEEN = 'isaAlertLastSeen';
const UNWATCHED_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/999/conversation/1';
const folderUrl = teamId => `https://app.intercom.com/a/inbox/demo1234/inbox/team/${teamId}?view=List`;

function makeChrome(initialStore = {}) {
  const store = { ...initialStore };
  const changedListeners = [];
  const sent = [];
  const writes = [];
  return {
    __store: store,
    __sent: sent,
    __writes: writes,
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
            writes.push(k);
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

function textLink(teamId, innerHtml, query = '?view=List') {
  return `<a href="https://app.intercom.com/a/inbox/demo1234/inbox/team/${teamId}${query}">${innerHtml}</a>`;
}

const countLink = (teamId, count, query) =>
  textLink(teamId, `<span class="label">Urgent Test</span><span class="count">${count}</span>`, query);

function build({ store = {}, links = [], url = UNWATCHED_URL, hidden = false } = {}) {
  const chrome = makeChrome(store);
  const played = [];
  const html = fx.inboxHtml({ nav: fx.inboxNav(links, []) });
  const window = loadExtension(html, {
    url,
    beforeScripts(win) {
      win.chrome = chrome;
      win.setInterval = () => 1;
      win.clearInterval = () => {};
      win.setTimeout = () => 1;
      win.clearTimeout = () => {};
      if (hidden) Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => true });
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
  return { window, chrome, played, clock };
}

function evaluate(ctx, mutate) {
  ctx.chrome.__sent.length = 0;
  ctx.played.length = 0;
  if (typeof mutate === 'function') mutate();
  ctx.window.evaluateInboxAlerts();
  return { sent: ctx.chrome.__sent.slice(), played: ctx.played.slice() };
}

function advanceAndEvaluate(ctx, ms, mutate) {
  ctx.clock.now += ms;
  return evaluate(ctx, mutate);
}

function setBadge(window, teamId, value) {
  const link = window.document.querySelector(`a[href*="/inbox/team/${teamId}?"]`);
  link.querySelector('.count').textContent = String(value);
}

const enabled = (extra = {}) => ({ isaAlertEnabled: true, isaAlertEnabledInboxes: [ALDER], ...extra });

test('settle window: a rise re-evaluated 1499 ms later stays silent, then alerts at 1500 ms', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 0)] });
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 3));
  const early = advanceAndEvaluate(ctx, SETTLE_MS - 1);
  assert.equal(early.sent.length, 0);
  assert.equal(early.played.length, 0);
  assert.equal(ctx.chrome.__store[LAST_SEEN][ALDER], 0);
  const onTime = advanceAndEvaluate(ctx, 1);
  assert.equal(onTime.sent.length, 1);
  assert.equal(onTime.sent[0].count, 3);
  assert.equal(onTime.played.length, 1);
});

test('settle window control: a rise re-evaluated exactly 1500 ms later alerts once', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 0)] });
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 3));
  const r = advanceAndEvaluate(ctx, SETTLE_MS);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].teamId, ALDER);
});

test('settle window restarts when the count changes again: 3 then 4 at +1000 is silent at +2000 and alerts for 4 at +2500', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 0)] });
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 3));
  const mid = advanceAndEvaluate(ctx, 1000, () => setBadge(ctx.window, ALDER, 4));
  assert.equal(mid.sent.length, 0);
  const stillWaiting = advanceAndEvaluate(ctx, 1000);
  assert.equal(stillWaiting.sent.length, 0, 'only 1000 ms since the count became 4');
  assert.equal(stillWaiting.played.length, 0);
  const settled = advanceAndEvaluate(ctx, 500);
  assert.equal(settled.sent.length, 1);
  assert.equal(settled.sent[0].count, 4);
});

test('team matching is exact: only a /inbox/team/1234 link with a rising count never alerts team 123', () => {
  const ctx = build({ store: enabled(), links: [countLink(OTHER, 0)] });
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), null);
  evaluate(ctx, () => setBadge(ctx.window, OTHER, 5));
  const r = advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.equal(r.sent.length, 0);
  assert.equal(r.played.length, 0);
});

test('team matching control: a /inbox/team/123 link beside a /inbox/team/1234 link reads only its own count', () => {
  const ctx = build({ store: enabled(), links: [countLink(OTHER, 9), countLink(ALDER, 2)] });
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), 2);
  evaluate(ctx, () => setBadge(ctx.window, OTHER, 12));
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), 2);
});

test('team matching accepts a bare /inbox/team/123 href with no query', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 7, '')] });
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), 7);
});

const separators = [
  ['dot', '.'],
  ['comma', ','],
  ['space', ' '],
  ['NBSP U+00A0', ' '],
  ['narrow NBSP U+202F', ' '],
  ['thin space U+2009', ' ']
];

for (const [name, sep] of separators) {
  test(`count parsing: 1${name === 'dot' ? '.' : sep}234 with ${name} separator is the count 1234`, () => {
    const ctx = build({ store: enabled(), links: [countLink(ALDER, `1${sep}234`)] });
    assert.equal(ctx.window.readInboxUnreadCount(ALDER), 1234);
  });
}

test('count parsing: a plain integer piece is the count', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 42)] });
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), 42);
});

test('count parsing: 1234.567 has a leading group longer than 3 so it is label text, not a count', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, '1234.567')] });
  assert.notEqual(ctx.window.readInboxUnreadCount(ALDER), 9005963);
  assert.notEqual(ctx.window.readInboxUnreadCount(ALDER), 1234.567);
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), null);
});

test('count parsing: a group that is not exactly 3 digits (1.23) is not a grouped count', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, '1.23')] });
  assert.notEqual(ctx.window.readInboxUnreadCount(ALDER), 123);
});

test('count parsing: with several numeric pieces the LAST piece is the count', () => {
  const html = textLink(ALDER, '<span>Desk 7</span><span class="a">5</span><span class="b">9</span>');
  const ctx = build({ store: enabled(), links: [html] });
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), 9);
});

test('count parsing: the last numeric piece wins even when it is smaller than an earlier one', () => {
  const html = textLink(ALDER, '<span>Queue</span><span>40</span><span>3</span>');
  const ctx = build({ store: enabled(), links: [html] });
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), 3);
});

test('count parsing: a trailing unparseable piece after a number leaves the last numeric piece as the count', () => {
  const html = textLink(ALDER, '<span>Queue</span><span>40</span><span>1234.567</span>');
  const ctx = build({ store: enabled(), links: [html] });
  assert.equal(ctx.window.readInboxUnreadCount(ALDER), 40);
});

test('corrupt lastSeen "abc" is ignored: the first settled count is a silent baseline', () => {
  const ctx = build({ store: enabled({ [LAST_SEEN]: { [ALDER]: 'abc' } }), links: [countLink(ALDER, 5)] });
  const r = advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.equal(r.sent.length, 0);
  assert.equal(ctx.chrome.__sent.length, 0);
  assert.equal(ctx.chrome.__store[LAST_SEEN][ALDER], 5);
});

test('corrupt lastSeen null is ignored: the first settled count is a silent baseline', () => {
  const ctx = build({ store: enabled({ [LAST_SEEN]: { [ALDER]: null } }), links: [countLink(ALDER, 5)] });
  advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.equal(ctx.chrome.__sent.length, 0);
  assert.equal(ctx.played.length, 0);
  assert.equal(ctx.chrome.__store[LAST_SEEN][ALDER], 5);
});

test('valid stored lastSeen control: a numeric baseline below the count does alert on load', () => {
  const ctx = build({ store: enabled({ [LAST_SEEN]: { [ALDER]: 2 } }), links: [countLink(ALDER, 5)] });
  assert.equal(ctx.chrome.__sent.length, 1);
  assert.equal(ctx.chrome.__sent[0].count, 5);
});

test('after a corrupt lastSeen baselines silently, the next rise still alerts', () => {
  const ctx = build({ store: enabled({ [LAST_SEEN]: { [ALDER]: 'abc' } }), links: [countLink(ALDER, 5)] });
  advanceAndEvaluate(ctx, SETTLE_MS + 1);
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 6));
  const r = advanceAndEvaluate(ctx, SETTLE_MS);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].count, 6);
});

test('viewing a visible inbox with unread excludes it from the attention title', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 0)], url: folderUrl(ALDER) });
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 3));
  advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.equal(ctx.window.document.title, '');
});

test('viewing the inbox in a hidden document still includes it in the attention title', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 0)], url: folderUrl(ALDER), hidden: true });
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 3));
  advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.equal(ctx.window.document.title.indexOf('🔴 '), 0);
});

test('a visible tab on another inbox includes the unread inbox in the attention title', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 0)] });
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 3));
  advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.equal(ctx.window.document.title.indexOf('🔴 '), 0);
});

test('enabling alerts baselines present counts silently and writes the new lastSeen', () => {
  const ctx = build({
    store: { isaAlertEnabled: false, isaAlertEnabledInboxes: [ALDER, OTHER], [LAST_SEEN]: { [ALDER]: 1 } },
    links: [countLink(ALDER, 4), countLink(OTHER, 6)]
  });
  ctx.chrome.__writes.length = 0;
  evaluate(ctx);
  ctx.chrome.storage.local.set({ isaAlertEnabled: true });
  advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.equal(ctx.chrome.__sent.length, 0);
  assert.equal(ctx.played.length, 0);
  assert.equal(ctx.chrome.__store[LAST_SEEN][ALDER], 4);
  assert.equal(ctx.chrome.__store[LAST_SEEN][OTHER], 6);
  assert.ok(ctx.chrome.__writes.includes(LAST_SEEN));
});

test('re-enabling with counts identical to lastSeen writes nothing to the lastSeen key', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [ALDER], [LAST_SEEN]: { [ALDER]: 4 } },
    links: [countLink(ALDER, 4)]
  });
  ctx.chrome.storage.local.set({ isaAlertEnabled: false });
  ctx.chrome.__writes.length = 0;
  ctx.chrome.storage.local.set({ isaAlertEnabled: true });
  advanceAndEvaluate(ctx, SETTLE_MS + 1);
  assert.ok(!ctx.chrome.__writes.includes(LAST_SEEN));
  assert.equal(ctx.chrome.__sent.length, 0);
});

test('re-enabling when one inbox count differs from lastSeen writes lastSeen for the changed value', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [ALDER], [LAST_SEEN]: { [ALDER]: 4 } },
    links: [countLink(ALDER, 4)]
  });
  ctx.chrome.storage.local.set({ isaAlertEnabled: false });
  setBadge(ctx.window, ALDER, 9);
  ctx.chrome.__writes.length = 0;
  ctx.chrome.storage.local.set({ isaAlertEnabled: true });
  assert.ok(ctx.chrome.__writes.includes(LAST_SEEN));
  assert.equal(ctx.chrome.__store[LAST_SEEN][ALDER], 9);
  assert.equal(ctx.chrome.__sent.length, 0);
});

test('disabling control: a rise that settles while enabled alerts', () => {
  const ctx = build({ store: enabled(), links: [countLink(ALDER, 0)] });
  evaluate(ctx, () => setBadge(ctx.window, ALDER, 3));
  const r = advanceAndEvaluate(ctx, SETTLE_MS);
  assert.equal(r.sent.length, 1);
});
