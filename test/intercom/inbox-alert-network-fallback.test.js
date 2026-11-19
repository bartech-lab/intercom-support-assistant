'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const SETTLE_MS = 1500;
const TEAM = '90075970';
const ADMIN = '9008884';
const WS = 'demo1234';
const URL_WS = `${ORIGIN}/a/inbox/${WS}/inbox/team/123/conversation/456`;
const URL_OTHER_WS = `${ORIGIN}/a/inbox/othersp4/inbox/team/123/conversation/456`;

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

const teamLink = count => fx.inboxNavLink({ teamId: TEAM, label: 'Urgent Northside', count });

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
  if (window.ISA_ALERT_SOUNDS) window.ISA_ALERT_SOUNDS.play = () => {};
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

function removeNav(win) {
  const nav = win.document.querySelector('nav');
  if (nav) nav.remove();
}

test('networkAssigneeCount returns the id count, 0 for a missing id only when the flag is true, else null', () => {
  const { window } = build();
  frame(window, [['all', 10], [TEAM, 7]], { missingAsZero: true });
  assert.equal(window.networkAssigneeCount(TEAM), 7);
  assert.equal(window.networkAssigneeCount('999'), 0);
  frame(window, [['all', 10], [TEAM, 7]], { missingAsZero: false });
  assert.equal(window.networkAssigneeCount(TEAM), 7);
  assert.equal(window.networkAssigneeCount('999'), null);
});

test('networkAssigneeCount accepts string ids and skips malformed entries without losing valid ones', () => {
  const { window } = build();
  frame(window, [
    [TEAM, 3], ['555', 4], [666], [777, -1], [888, 1.5], [999, '4'], 'junk', [111, 2, 9], [222, 6]
  ], { missingAsZero: false });
  assert.equal(window.networkAssigneeCount(TEAM), 3);
  assert.equal(window.networkAssigneeCount(555), 4);
  assert.equal(window.networkAssigneeCount('222'), 6);
  ['666', '777', '888', '999'].forEach(id => {
    assert.equal(window.networkAssigneeCount(id), null, `malformed entry for ${id} must not yield a count`);
  });
});

test('networkAssigneeCount is null with no frame and when the frame is older than 10 s or in the future', () => {
  const { window } = build();
  assert.equal(window.networkAssigneeCount(TEAM), null);
  const t = Date.now();
  frame(window, [[TEAM, 5]], { observedAt: t });
  assert.equal(window.networkAssigneeCount(TEAM, t + 10000), 5, 'exactly 10 s old is still fresh');
  assert.equal(window.networkAssigneeCount(TEAM, t + 22993), null);
  assert.equal(window.networkAssigneeCount(TEAM, t - 1), null, 'a frame from the future is not fresh');
});

test('an older frame arriving after a newer one is ignored', () => {
  const { window } = build();
  const t = Date.now();
  frame(window, [[TEAM, 9]], { observedAt: t });
  frame(window, [[TEAM, 2]], { observedAt: t - 500 });
  assert.equal(window.networkAssigneeCount(TEAM, t), 9);
});

test('a frame that is not CountersUpdated does not feed the counts', () => {
  const { window } = build();
  window.dispatchEvent(new window.MessageEvent('message', {
    source: window,
    origin: ORIGIN,
    data: {
      __isaic: true, version: 1, kind: 'nexus-frame', url: 'wss://nexus-websocket-a.intercom.io/x', observedAt: Date.now(),
      data: JSON.stringify({ eventName: 'SomethingElse', eventData: { counters: [[TEAM, 5]], treat_missing_assignees_as_zero: true } })
    }
  }));
  assert.equal(window.networkAssigneeCount(TEAM), null);
});

test('sidebar hidden: baseline frame then a higher frame sends exactly one alert for that team', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] } });
  frame(ctx.window, [[TEAM, 4]]);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0, 'the first readable value is a silent baseline');
  frame(ctx.window, [[TEAM, 6]]);
  settle(ctx);
  settle(ctx);
  const sent = alerts(ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].teamId, TEAM);
  assert.equal(sent[0].count, 6);
});

test('a rising frame alone triggers evaluation, with no DOM mutation and no manual evaluate call before the settle', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] } });
  frame(ctx.window, [[TEAM, 1]]);
  ctx.clock.now += SETTLE_MS + 1;
  frame(ctx.window, [[TEAM, 1]]);
  frame(ctx.window, [[TEAM, 3]]);
  ctx.clock.now += SETTLE_MS + 1;
  frame(ctx.window, [[TEAM, 3]]);
  assert.equal(alerts(ctx).length, 1, 'only frames drove the evaluations');
  assert.equal(alerts(ctx)[0].count, 3);
});

test('a falling or equal frame count sends no alert', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] } });
  frame(ctx.window, [[TEAM, 5]]);
  settle(ctx);
  frame(ctx.window, [[TEAM, 5]]);
  settle(ctx);
  frame(ctx.window, [[TEAM, 2]]);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
});

test('sidebar present: the sidebar count wins over a higher network count', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] }, links: [teamLink(3)] });
  frame(ctx.window, [[TEAM, 20]]);
  settle(ctx);
  frame(ctx.window, [[TEAM, 30]]);
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
});

test('sidebar present: a rise in the sidebar still alerts while the network disagrees', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] }, links: [teamLink(3)] });
  frame(ctx.window, [[TEAM, 0]]);
  const badge = ctx.window.document.querySelector('a[href*="/inbox/team/"] .count');
  badge.textContent = '5';
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(alerts(ctx)[0].count, 5);
});

test('a frame older than 10 s leaves the hidden inbox unreadable: no alert, and the later value is a silent baseline', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] } });
  const realNow = ctx.window.Date.now;
  const wall = { offset: 0 };
  ctx.window.Date.now = () => realNow() + wall.offset;
  frame(ctx.window, [[TEAM, 2]], { observedAt: ctx.window.Date.now() });
  settle(ctx);
  wall.offset = 20000;
  settle(ctx);
  settle(ctx);
  assert.equal(ctx.window.networkAssigneeCount(TEAM), null, 'the old frame is stale');
  assert.equal(alerts(ctx).length, 0, 'a stale frame is not a reading');
  frame(ctx.window, [[TEAM, 12]], { observedAt: ctx.window.Date.now() });
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0, 'the first value after being unreadable is a silent baseline');
  frame(ctx.window, [[TEAM, 13]], { observedAt: ctx.window.Date.now() });
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 1, 'alerts resume from the new baseline');
});

test('no frame at all with the sidebar hidden never alerts', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] } });
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
});

test('moving from sidebar to network with the same count makes no phantom alert', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] }, links: [teamLink(4)] });
  settle(ctx);
  removeNav(ctx.window);
  frame(ctx.window, [[TEAM, 4]]);
  settle(ctx);
  settle(ctx);
  frame(ctx.window, [[TEAM, 4]]);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
});

test('moving from sidebar to network, a real rise after the move alerts once', () => {
  const ctx = build({ store: { isaAlertEnabledInboxes: [TEAM] }, links: [teamLink(4)] });
  settle(ctx);
  removeNav(ctx.window);
  frame(ctx.window, [[TEAM, 4]]);
  settle(ctx);
  settle(ctx);
  frame(ctx.window, [[TEAM, 7]]);
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 1);
  assert.equal(alerts(ctx)[0].count, 7);
});

test('Your inbox: admin id learned from the sidebar, then the sidebar is hidden and frames for that admin alert', () => {
  const ctx = build({ links: [fx.yourInboxNavLink({ adminId: ADMIN, count: 2 })] });
  settle(ctx);
  removeNav(ctx.window);
  frame(ctx.window, [['all', 50], [ADMIN, 2]]);
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0, 'same count as the sidebar showed');
  frame(ctx.window, [['all', 51], [ADMIN, 3]]);
  settle(ctx);
  settle(ctx);
  const sent = alerts(ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].teamId, 'your-inbox');
  assert.equal(sent[0].count, 3);
});

test('Your inbox: frames for a different admin id never alert', () => {
  const ctx = build({ links: [fx.yourInboxNavLink({ adminId: ADMIN, count: 2 })] });
  settle(ctx);
  removeNav(ctx.window);
  frame(ctx.window, [[ADMIN, 2], ['111', 1]], { missingAsZero: false });
  settle(ctx);
  frame(ctx.window, [[ADMIN, 2], ['111', 40]], { missingAsZero: false });
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
});

test('Your inbox: the learned admin id is persisted with the page workspace', () => {
  const ctx = build({ links: [fx.yourInboxNavLink({ adminId: ADMIN, count: 1 })] });
  settle(ctx);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.chrome.__store.isaAlertYourInboxAdmin)),
    { workspace: WS, adminId: ADMIN }
  );
});

test('Your inbox: a stored admin id for the same workspace is used when the sidebar is hidden from load', () => {
  const ctx = build({ store: { isaAlertYourInboxAdmin: { workspace: WS, adminId: ADMIN } } });
  frame(ctx.window, [[ADMIN, 1]]);
  settle(ctx);
  frame(ctx.window, [[ADMIN, 4]]);
  settle(ctx);
  settle(ctx);
  const sent = alerts(ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].teamId, 'your-inbox');
  assert.equal(sent[0].count, 4);
});

test('Your inbox: a stored admin id for a different workspace is not used', () => {
  const ctx = build({
    store: { isaAlertYourInboxAdmin: { workspace: WS, adminId: ADMIN } },
    url: URL_OTHER_WS
  });
  frame(ctx.window, [[ADMIN, 1]], { missingAsZero: false });
  settle(ctx);
  frame(ctx.window, [[ADMIN, 6]], { missingAsZero: false });
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
});

test('Your inbox: turning it off in storage stops network alerts for it', () => {
  const ctx = build({ store: { isaAlertYourInbox: false, isaAlertYourInboxAdmin: { workspace: WS, adminId: ADMIN } } });
  frame(ctx.window, [[ADMIN, 1]]);
  settle(ctx);
  frame(ctx.window, [[ADMIN, 5]]);
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
});

function selfAdmin(win, adminId) {
  win.dispatchEvent(new win.MessageEvent('message', {
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'self-admin', adminId }
  }));
}

test('Your inbox: the admin id relayed from the page load is used and stored when the sidebar was never visible', () => {
  const ctx = build();
  selfAdmin(ctx.window, ADMIN);
  frame(ctx.window, [[ADMIN, 2]]);
  settle(ctx);
  frame(ctx.window, [[ADMIN, 3]]);
  settle(ctx);
  settle(ctx);
  const sent = alerts(ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].teamId, 'your-inbox');
  assert.equal(sent[0].count, 3);
  assert.deepEqual({ ...ctx.chrome.__store.isaAlertYourInboxAdmin }, { workspace: WS, adminId: ADMIN });
});

test('Your inbox: a malformed relayed admin id is ignored', () => {
  const ctx = build();
  selfAdmin(ctx.window, '79319x78');
  frame(ctx.window, [['79319x78', 2]], { missingAsZero: false });
  settle(ctx);
  frame(ctx.window, [['79319x78', 5]], { missingAsZero: false });
  settle(ctx);
  settle(ctx);
  assert.equal(alerts(ctx).length, 0);
  assert.equal(ctx.chrome.__store.isaAlertYourInboxAdmin, undefined);
});

test('the page hook relays the admin id from the teammate settings GET and nothing from other requests', async () => {
  const { hookWith, relayed } = require('../support/intercom-page-hook-harness');
  const selfUrl = `${ORIGIN}/ember/admins/teammate_app_settings/${ADMIN}`;
  const ctx = hookWith({});
  const { envelopes } = await relayed(ctx, selfUrl);
  assert.deepEqual(envelopes.filter(e => e.kind === 'self-admin').map(e => e.adminId), [ADMIN]);
  const other = hookWith({});
  const posted = await relayed(other, `${ORIGIN}/ember/admins/notification_settings`);
  const put = await relayed(other, selfUrl, { method: 'PUT' });
  assert.equal(posted.envelopes.concat(put.envelopes).filter(e => e.kind === 'self-admin').length, 0);
});
