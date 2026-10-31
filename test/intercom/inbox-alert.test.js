'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const NORTHSIDE = '900101';
const ALDERPOINT = '900102';
const ORIGIN = 'https://app.intercom.com';
const UNWATCHED_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/999/conversation/1';
const ADMIN_ID = '9003960';
const YOUR_INBOX = 'your-inbox';
const folderUrl = teamId => `https://app.intercom.com/a/inbox/demo1234/inbox/team/${teamId}?view=List`;
const adminUrl = adminId => `https://app.intercom.com/a/inbox/demo1234/inbox/admin/${adminId}?view=List`;

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

function build({ store = {}, links = [], pinned = [], nav = null, url = UNWATCHED_URL } = {}) {
  const chrome = makeChrome(store);
  const played = [];
  const html = fx.inboxHtml({ nav: nav || fx.inboxNav(links, pinned) });
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
  if (window.ISA_ALERT_SOUNDS) window.ISA_ALERT_SOUNDS.play = id => { played.push(id); };
  const clock = { now: Date.now() };
  window.alertClock = () => clock.now;
  clock.now += SETTLE_MS + 1;
  window.evaluateInboxAlerts();
  return { window, chrome, played, clock };
}

const SETTLE_MS = 1500;

function advance(ctx, ms) {
  ctx.clock.now += ms;
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

function stepWithoutSettling(ctx, mutate) {
  ctx.chrome.__sent.length = 0;
  ctx.played.length = 0;
  if (typeof mutate === 'function') mutate();
  ctx.window.evaluateInboxAlerts();
  return { sent: ctx.chrome.__sent.slice(), played: ctx.played.slice() };
}

function step(ctx, mutate) {
  ctx.chrome.__sent.length = 0;
  ctx.played.length = 0;
  if (typeof mutate === 'function') mutate();
  ctx.window.evaluateInboxAlerts();
  advance(ctx, SETTLE_MS + 1);
  ctx.window.evaluateInboxAlerts();
  return { sent: ctx.chrome.__sent.slice(), played: ctx.played.slice() };
}

function setYourInboxCount(window, count, adminId = ADMIN_ID) {
  const link = window.document.querySelector(`a[href*="/inbox/admin/${adminId}?"]`);
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

function postBridge(window, envelope) {
  window.dispatchEvent(new window.MessageEvent('message', {
    source: window,
    origin: ORIGIN,
    data: envelope
  }));
}

const northsideLink = count => fx.inboxNavLink({ teamId: NORTHSIDE, label: 'Urgent Northside', count });
const isaLink = count => fx.inboxNavLink({ teamId: ALDERPOINT, label: 'Urgent Alderpoint', count });

const faviconHref = window => {
  const link = window.document.querySelector('link[rel~="icon"]');
  return link ? link.getAttribute('href') : null;
};

test('default off: nothing fires even with unread', () => {
  const ctx = build({ store: {}, links: [northsideLink(3), isaLink(2)] });
  const r = step(ctx);
  assert.equal(ctx.chrome.__sent.length, 0);
  assert.equal(r.played.length, 0);
  assert.equal(ctx.window.document.title, '');
  assert.equal(faviconHref(ctx.window), null);
});

test('enabled with no stored inbox selection, a Urgent arrival stays silent', () => {
  const ctx = build({ store: { isaAlertEnabled: true }, links: [northsideLink(0), isaLink(0)] });
  const r = step(ctx, () => { setCount(ctx.window, NORTHSIDE, 3); setCount(ctx.window, ALDERPOINT, 2); });
  assert.equal(r.sent.length, 0);
  assert.equal(r.played.length, 0);
});

test('new arrival fires; only-Northside-selected keeps an unread Alderpoint silent', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0), isaLink(2)]
  });
  const r = step(ctx, () => setCount(ctx.window, NORTHSIDE, 3));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].teamId, NORTHSIDE);
  assert.equal(r.sent[0].count, 3);
  assert.equal(r.played.length, 1);
  assert.match(ctx.window.document.title, /Northside \(3\)/);
  assert.equal(faviconHref(ctx.window), 'data:image/png;base64,BADGE');
  assert.ok(!r.sent.some(m => m.teamId === ALDERPOINT));
});

test('network comparison uses the actual Your inbox admin id', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [], isaDebug: true },
    links: [fx.yourInboxNavLink({ adminId: ADMIN_ID, count: 0 })]
  });
  const logs = [];
  ctx.window.console.log = (...args) => logs.push(args.join(' '));
  postBridge(ctx.window, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    counts: [{ inboxType: 'admin', inboxId: ADMIN_ID, count: 7 }]
  });
  const identity = ctx.window.alertNetworkInboxIdentity(YOUR_INBOX);
  assert.equal(identity.inboxType, 'admin');
  assert.equal(identity.inboxId, ADMIN_ID);
  assert.equal(ctx.window.resolveAlertInboxCount(YOUR_INBOX), 0, 'the nav count still decides');
  assert.ok(logs.some(line => line.includes(`inbox admin/${ADMIN_ID}: nav count 0 differs from network count 7`)),
    logs.join('\n'));
});

test('ambiguous Your inbox links fail closed for network comparison', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [
      fx.yourInboxNavLink({ adminId: ADMIN_ID, count: 0 }),
      fx.yourInboxNavLink({ adminId: '9004204', count: 0 })
    ]
  });
  assert.equal(ctx.window.alertNetworkInboxIdentity(YOUR_INBOX), null);
  assert.equal(ctx.window.resolveAlertInboxCount(YOUR_INBOX), 0);
});

test('team and admin counts with the same id remain separate keys', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [ADMIN_ID] },
    links: [
      fx.inboxNavLink({ teamId: ADMIN_ID, label: 'Urgent Shared', count: 0 }),
      fx.yourInboxNavLink({ adminId: ADMIN_ID, count: 0 })
    ]
  });
  const teamIdentity = ctx.window.alertNetworkInboxIdentity(ADMIN_ID);
  const adminIdentity = ctx.window.alertNetworkInboxIdentity(YOUR_INBOX);
  assert.equal(teamIdentity.inboxType, 'team');
  assert.equal(teamIdentity.inboxId, ADMIN_ID);
  assert.equal(adminIdentity.inboxType, 'admin');
  assert.equal(adminIdentity.inboxId, ADMIN_ID);
  postBridge(ctx.window, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    counts: [
      { inboxType: 'team', inboxId: ADMIN_ID, count: 3 },
      { inboxType: 'admin', inboxId: ADMIN_ID, count: 4 }
    ]
  });
  assert.equal(ctx.window.networkInboxObservation('team', ADMIN_ID).count, 3);
  assert.equal(ctx.window.networkInboxObservation('admin', ADMIN_ID).count, 4);
});

test('network mismatches and reconnect updates do not alter settled sidebar alerts', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  const firstObservedAt = Date.now();
  postBridge(ctx.window, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    observedAt: firstObservedAt,
    counts: [{ inboxType: 'team', inboxId: NORTHSIDE, count: 99 }]
  });
  const first = step(ctx, () => setCount(ctx.window, NORTHSIDE, 1));
  assert.equal(first.sent.length, 1);
  assert.equal(first.sent[0].count, 1);
  assert.match(ctx.window.document.title, /Northside \(1\)/);
  assert.equal(faviconHref(ctx.window), 'data:image/png;base64,BADGE');

  postBridge(ctx.window, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    observedAt: firstObservedAt - 1,
    counts: [{ inboxType: 'team', inboxId: NORTHSIDE, count: 8 }]
  });
  assert.equal(ctx.window.networkInboxObservation('team', NORTHSIDE).count, 99);

  postBridge(ctx.window, {
    __isaic: true,
    version: 1,
    kind: 'nexus-frame',
    observedAt: Date.now(),
    data: JSON.stringify({ id: NORTHSIDE, inbox_type: 'team', unread_count: 1 })
  });
  const second = step(ctx);
  assert.equal(second.sent.length, 0);
  assert.equal(second.played.length, 0);
  assert.match(ctx.window.document.title, /Northside \(1\)/);
  assert.equal(faviconHref(ctx.window), 'data:image/png;base64,BADGE');
});

test('multi-message burst (0->5) is a single fire, and does not re-fire while standing', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  const first = step(ctx, () => setCount(ctx.window, NORTHSIDE, 5));
  assert.equal(first.sent.length, 1);
  assert.equal(first.sent[0].count, 5);
  assert.equal(first.played.length, 1);
  assert.match(ctx.window.document.title, /Northside \(5\)/);
  const again = step(ctx);
  assert.equal(again.sent.length, 0);
  assert.equal(again.played.length, 0);
});

test('baseline tracks down: 1 -> 0 -> 1 fires again on the second arrival', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  assert.equal(step(ctx, () => setCount(ctx.window, NORTHSIDE, 1)).sent.length, 1);
  assert.equal(step(ctx, () => setCount(ctx.window, NORTHSIDE, 0)).sent.length, 0);
  const back = step(ctx, () => setCount(ctx.window, NORTHSIDE, 1));
  assert.equal(back.sent.length, 1, 'a fresh arrival after clearing must fire again');
  assert.equal(back.played.length, 1);
});

test('count returning to zero clears the blinking title', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  step(ctx, () => setCount(ctx.window, NORTHSIDE, 2));
  assert.match(ctx.window.document.title, /Northside \(2\)/);
  step(ctx, () => setCount(ctx.window, NORTHSIDE, 0));
  assert.equal(ctx.window.document.title, '', 'title restored once the inbox is clear');
});

test('blink pulse self-heals: count clears with no evaluate re-run → title restored', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  step(ctx, () => setCount(ctx.window, NORTHSIDE, 2));
  assert.match(ctx.window.document.title, /Northside \(2\)/);
  setCount(ctx.window, NORTHSIDE, 0);
  ctx.window.alertBlinkPulse();
  assert.equal(ctx.window.document.title, '', 'the blink pulse restored the title on its own');
});

test('blink pulse self-heals when the nav row disappears (count null)', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  step(ctx, () => setCount(ctx.window, NORTHSIDE, 2));
  assert.match(ctx.window.document.title, /Northside \(2\)/);
  const link = ctx.window.document.querySelector(`a[href*="/inbox/team/${NORTHSIDE}?"]`);
  link.remove();
  ctx.window.alertBlinkPulse();
  assert.equal(ctx.window.document.title, '', 'a vanished nav row still clears the stuck title');
});

test('teardown strips a stuck badge marker even if the title was rewritten', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  step(ctx, () => setCount(ctx.window, NORTHSIDE, 2));
  ctx.window.document.title = '🔴 Intercom took over';
  setCount(ctx.window, NORTHSIDE, 0);
  ctx.window.alertBlinkPulse();
  assert.equal(ctx.window.document.title, 'Intercom took over', 'stuck badge marker stripped on teardown');
});

test('reload with an already-seen standing item does NOT re-notify', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE], isaAlertLastSeen: { [NORTHSIDE]: 3 } },
    links: [northsideLink(3)]
  });
  assert.equal(ctx.chrome.__sent.length, 0);
});

test('reload where the count grew while away DOES notify for the new items', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE], isaAlertLastSeen: { [NORTHSIDE]: 3 } },
    links: [northsideLink(5)]
  });
  assert.equal(ctx.chrome.__sent.length, 1);
  assert.equal(ctx.chrome.__sent[0].teamId, NORTHSIDE);
  assert.equal(ctx.chrome.__sent[0].count, 5);
});

test('viewing the NORTHSIDE inbox still notifies on a new arrival but does not blink', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)],
    url: folderUrl(NORTHSIDE)
  });
  const r = step(ctx, () => setCount(ctx.window, NORTHSIDE, 3));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].teamId, NORTHSIDE);
  assert.equal(r.played.length, 1);
  assert.equal(ctx.window.document.title, '');
});

test('viewing one inbox: both still notify, only the non-viewed one blinks', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE, ALDERPOINT] },
    links: [northsideLink(0), isaLink(0)],
    url: folderUrl(ALDERPOINT)
  });
  const r = step(ctx, () => { setCount(ctx.window, NORTHSIDE, 3); setCount(ctx.window, ALDERPOINT, 2); });
  const teamIds = Array.from(r.sent, m => m.teamId).sort();
  assert.deepEqual(teamIds, [NORTHSIDE, ALDERPOINT].sort());
  assert.match(ctx.window.document.title, /Northside \(3\)/);
  assert.doesNotMatch(ctx.window.document.title, /alderpoint/);
});

test('both selected + active: aggregate title, two notifications, single sound', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE, ALDERPOINT] },
    links: [northsideLink(0), isaLink(0)]
  });
  const r = step(ctx, () => { setCount(ctx.window, NORTHSIDE, 3); setCount(ctx.window, ALDERPOINT, 2); });
  assert.equal(r.sent.length, 2);
  assert.deepEqual(Array.from(r.sent, m => m.teamId).sort(), [ALDERPOINT, NORTHSIDE].sort());
  assert.equal(r.played.length, 1);
  assert.equal(ctx.window.document.title, '🔴 Northside (3) · Alderpoint (2)');
});

test('master toggle off clears visuals but preserves last-seen (no re-ding on re-enable)', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  assert.equal(step(ctx, () => setCount(ctx.window, NORTHSIDE, 3)).sent.length, 1);
  assert.match(ctx.window.document.title, /Northside \(3\)/);

  ctx.chrome.storage.local.set({ isaAlertEnabled: false });
  assert.equal(ctx.window.document.title, '');
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[NORTHSIDE], 3);

  ctx.chrome.__sent.length = 0;
  ctx.played.length = 0;
  ctx.chrome.storage.local.set({ isaAlertEnabled: true });
  assert.equal(ctx.chrome.__sent.length, 0, 're-enabling must not re-notify a standing item');
});

test('selecting a new brand baselines it (no immediate ding for a standing item)', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0), isaLink(4)]
  });
  ctx.chrome.__sent.length = 0;
  ctx.played.length = 0;
  ctx.chrome.storage.local.set({ isaAlertEnabledInboxes: [NORTHSIDE, ALDERPOINT] });
  assert.equal(ctx.chrome.__sent.length, 0, 'toggling a brand on must not ding its standing items');
  const r = step(ctx, () => setCount(ctx.window, ALDERPOINT, 5));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].teamId, ALDERPOINT);
});

test('roster discovery persists seed union discovered Urgent inboxes', () => {
  const ctx = build({
    store: {},
    links: [
      northsideLink(0),
      isaLink(0),
      fx.inboxNavLink({ teamId: '900206', label: 'Support Quayside Fashion', count: 4 }),
      fx.inboxNavLink({ teamId: '111', label: 'Urgent Saltmarsh Crafts', count: 0 })
    ]
  });
  ctx.window.evaluateInboxAlerts();
  const roster = ctx.chrome.__store.isaAlertRoster || [];
  const teamIds = Array.from(roster, r => r.teamId);
  assert.ok(teamIds.includes(NORTHSIDE) && teamIds.includes(ALDERPOINT), 'seed primaries kept');
  assert.ok(teamIds.includes('111'), 'newly-discovered Urgent inbox added');
  assert.ok(!teamIds.includes('900206'), 'a non-Urgent inbox is excluded from the roster');
});

test('roster is monotonic: a load rendering fewer folders keeps the persisted ones', () => {
  const ctx = build({
    store: {
      isaAlertRoster: [
        { teamId: NORTHSIDE, label: 'Urgent Alderpoint' },
        { teamId: ALDERPOINT, label: 'Urgent Alderpoint' },
        { teamId: '111', label: 'Urgent Saltmarsh Crafts' }
      ]
    },
    links: [northsideLink(0), isaLink(0)]
  });
  ctx.window.evaluateInboxAlerts();
  const roster = ctx.chrome.__store.isaAlertRoster || [];
  const teamIds = Array.from(roster, r => r.teamId).sort();
  assert.deepEqual(teamIds, [NORTHSIDE, ALDERPOINT, '111', '900103'].sort(),
    'previously-discovered inbox is retained even though the nav no longer renders it');
  assert.equal(ctx.window.alertRosterLabel('111'), 'Urgent Saltmarsh Crafts',
    'the persisted inbox is merged into the live roster, not only left in storage');
});

test('a retired inbox never re-enters the roster, from storage or from the nav', () => {
  const RETIRED = '900199';
  const ctx = build({
    store: {
      isaAlertRoster: [
        { teamId: NORTHSIDE, label: 'Urgent Alderpoint' },
        { teamId: RETIRED, label: 'Urgent Saltmarsh Crafts' }
      ]
    },
    links: [
      northsideLink(0),
      fx.inboxNavLink({ teamId: RETIRED, label: 'Urgent Saltmarsh Crafts', count: 0 }),
      fx.inboxNavLink({ teamId: '111', label: 'Urgent Newbrand', count: 0 })
    ]
  });
  ctx.window.evaluateInboxAlerts();
  assert.equal(ctx.window.alertRosterLabel(RETIRED), RETIRED);
  const teamIds = Array.from(ctx.chrome.__store.isaAlertRoster || [], r => r.teamId);
  assert.ok(teamIds.includes('111'), 'a new Urgent inbox is still discovered');
  assert.ok(teamIds.includes(NORTHSIDE));
  assert.ok(!teamIds.includes(RETIRED), 'the retired inbox is dropped from the persisted roster');
});

test('unread count is read from the digits-only badge, never label digits', () => {
  const ctx = build({
    links: [
      fx.inboxNavLink({ teamId: ALDERPOINT, label: 'Urgent Northwind', count: 5 }),
      fx.inboxNavLink({ teamId: '900201', label: 'Support Alderpoint', count: 53 })
    ]
  });
  assert.equal(ctx.window.readInboxUnreadCount(ALDERPOINT), 5);
  assert.equal(ctx.window.readInboxUnreadCount('900201'), 53);
});

test('a badge that vanishes mid-render reads as unreadable, never as zero', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(5)]
  });
  setCount(ctx.window, NORTHSIDE, null);
  assert.equal(ctx.window.readInboxUnreadCount(NORTHSIDE), null,
    'the anchor is still rendered but carries no count, which is not the same as 0');
});

test('closing a ticket cannot ding: a dip to an unreadable badge and back is silent', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(5)]
  });

  const dip = stepWithoutSettling(ctx, () => setCount(ctx.window, NORTHSIDE, null));
  assert.equal(dip.sent.length, 0);

  const restore = step(ctx, () => setCount(ctx.window, NORTHSIDE, 5));
  assert.equal(restore.sent.length, 0, 'the restored count is not a new arrival');
  assert.equal(restore.played.length, 0);
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[NORTHSIDE], 5, 'the watermark never dropped to 0');
});

test('closing a ticket cannot ding: a transient dip to a lower count and back is silent', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(5)]
  });

  stepWithoutSettling(ctx, () => setCount(ctx.window, NORTHSIDE, 4));
  const restore = step(ctx, () => setCount(ctx.window, NORTHSIDE, 5));

  assert.equal(restore.sent.length, 0, 'an optimistic re-render that snaps back is not an arrival');
  assert.equal(restore.played.length, 0);
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[NORTHSIDE], 5);
});

test('an unsettled count never rewrites the watermark', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(5)]
  });
  stepWithoutSettling(ctx, () => setCount(ctx.window, NORTHSIDE, 0));
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[NORTHSIDE], 5);
});

test('a genuine arrival still fires once its count settles', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)]
  });
  const r = step(ctx, () => setCount(ctx.window, NORTHSIDE, 1));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].count, 1);
  assert.equal(r.played.length, 1);
});

test('the first settled count after an unreadable stretch baselines silently', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(1)]
  });

  step(ctx, () => setCount(ctx.window, NORTHSIDE, null));
  const recovered = step(ctx, () => setCount(ctx.window, NORTHSIDE, 4));

  assert.equal(recovered.sent.length, 0,
    'the nav was unreadable long enough to settle, so the returning count is a baseline not a rise');
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[NORTHSIDE], 4);

  const next = step(ctx, () => setCount(ctx.window, NORTHSIDE, 5));
  assert.equal(next.sent.length, 1, 'the next genuine rise off that baseline still fires');
});

test('a thousands-separated badge parses as its full value, not as zero', () => {
  const ctx = build({ links: [northsideLink(0)] });
  const badge = ctx.window.document.querySelector(`a[href*="/inbox/team/${NORTHSIDE}?"] .count`);
  badge.textContent = '1,234';
  assert.equal(ctx.window.readInboxUnreadCount(NORTHSIDE), 1234);
  badge.textContent = '4 511';
  assert.equal(ctx.window.readInboxUnreadCount(NORTHSIDE), 4511);
});

test('two nav anchors for one inbox are used only while they agree', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(3), northsideLink(3)]
  });
  assert.equal(ctx.window.readInboxUnreadCount(NORTHSIDE), 3, 'agreeing duplicates read as that count');

  const badges = ctx.window.document.querySelectorAll(`a[href*="/inbox/team/${NORTHSIDE}?"] .count`);
  assert.equal(badges.length, 2, 'the pinned nav really does render the folder twice');
  badges[1].textContent = '9';
  assert.equal(ctx.window.readInboxUnreadCount(NORTHSIDE), null,
    'disagreeing duplicates are a half-applied re-render, not a reading');
});

test('a disagreeing duplicate anchor fires nothing and preserves the watermark', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(3), northsideLink(3)]
  });
  const r = step(ctx, () => {
    ctx.window.document.querySelectorAll(`a[href*="/inbox/team/${NORTHSIDE}?"] .count`)[1].textContent = '9';
  });
  assert.equal(r.sent.length, 0);
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[NORTHSIDE], 3);
});

test('the blink still tracks an unsettled count so the visual stays live', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE] },
    links: [northsideLink(0)],
    url: UNWATCHED_URL
  });
  stepWithoutSettling(ctx, () => setCount(ctx.window, NORTHSIDE, 4));
  assert.equal(ctx.window.document.title.indexOf('🔴 '), 0,
    'the title badge does not wait for the settle window');
});

test('Your inbox is watched by default once the master toggle is on', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 0 })]
  });
  const r = step(ctx, () => setYourInboxCount(ctx.window, 2));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].teamId, YOUR_INBOX);
  assert.equal(r.sent[0].label, 'Your inbox');
  assert.equal(r.sent[0].count, 2);
  assert.equal(r.played.length, 1);
});

test('Your inbox stays silent while the master toggle is off', () => {
  const ctx = build({
    store: {},
    links: [fx.yourInboxNavLink({ count: 0 })]
  });
  const r = step(ctx, () => setYourInboxCount(ctx.window, 4));
  assert.equal(r.sent.length, 0);
  assert.equal(r.played.length, 0);
});

test('Your inbox can be turned off on its own without touching the brands', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [NORTHSIDE], isaAlertYourInbox: false },
    links: [fx.yourInboxNavLink({ count: 0 }), northsideLink(0)]
  });
  const r = step(ctx, () => {
    setYourInboxCount(ctx.window, 3);
    setCount(ctx.window, NORTHSIDE, 1);
  });
  assert.equal(r.sent.length, 1, 'only the brand fires');
  assert.equal(r.sent[0].teamId, NORTHSIDE);
});

test('a first read of Your inbox baselines silently', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 6 })]
  });
  const r = step(ctx);
  assert.equal(r.sent.length, 0, 'an existing backlog is not an arrival');
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[YOUR_INBOX], 6);
});

test('Your inbox watermark tracks down: 1 -> 0 -> 1 fires again', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 0 })]
  });
  assert.equal(step(ctx, () => setYourInboxCount(ctx.window, 1)).sent.length, 1);
  assert.equal(step(ctx, () => setYourInboxCount(ctx.window, 0)).sent.length, 0);
  assert.equal(step(ctx, () => setYourInboxCount(ctx.window, 1)).sent.length, 1);
});

test('a missing Your inbox nav link is unreadable, not zero', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 3 })]
  });
  step(ctx);
  const r = step(ctx, () => setYourInboxCount(ctx.window, null));
  assert.equal(r.sent.length, 0);
  assert.equal(ctx.window.document.title, '', 'an unreadable badge must not blink');
  assert.equal(ctx.chrome.__store.isaAlertLastSeen[YOUR_INBOX], 3, 'the watermark is kept, not dropped to 0');

  const restore = step(ctx, () => setYourInboxCount(ctx.window, 3));
  assert.equal(restore.sent.length, 0, 'the badge coming back at 3 is not a new arrival');
});

test('pinned teammates with different ids and counts cannot poison Your inbox', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 0 })],
    pinned: [
      fx.pinnedTeammateNavLink({ adminId: '9003093', count: 17 }),
      fx.pinnedTeammateNavLink({ adminId: '9004204', count: 42 })
    ]
  });
  const r = step(ctx, () => setYourInboxCount(ctx.window, 2));
  assert.equal(r.sent.length, 1, 'a pinned teammate must not make the count unreadable');
  assert.equal(r.sent[0].teamId, YOUR_INBOX);
  assert.equal(r.sent[0].count, 2, 'the count must be our own, not a teammate count');
});

test('pinning your own inbox to yourself does not make it unreadable', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 0 })],
    pinned: [fx.pinnedTeammateNavLink({ adminId: ADMIN_ID, count: 0 })]
  });
  const r = step(ctx, () => setYourInboxCount(ctx.window, 5));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].count, 5);
});

test('the fallback finds Your inbox without the your-inbox attribute, still ignoring pinned teammates', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 0, tagged: false })],
    pinned: [fx.pinnedTeammateNavLink({ adminId: '9004729', count: 99 })]
  });
  const r = step(ctx, () => setYourInboxCount(ctx.window, 4));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].teamId, YOUR_INBOX);
  assert.equal(r.sent[0].count, 4);
});

test('the 2026-09 nav, with the your-inbox target on the link and no nav containers, still alerts for Your inbox', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    nav: fx.inboxNavRows([
      fx.inboxNavLink({ teamId: ALDERPOINT, label: 'Urgent Alderpoint', count: 0 }),
      fx.pinnedTeammateNavLink({ adminId: '9004729', count: 99 }),
      fx.yourInboxNavLink({ count: 0, onAnchor: true })
    ])
  });
  const r = step(ctx, () => setYourInboxCount(ctx.window, 4));
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].teamId, YOUR_INBOX);
  assert.equal(r.sent[0].count, 4);
});

test('a conversation deep link under an admin inbox is not a folder link', () => {
  const ctx = build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [`<a href="/a/inbox/demo1234/inbox/admin/${ADMIN_ID}/conversation/55?view=List"><span class="count">8</span></a>`]
  });
  const r = step(ctx);
  assert.equal(r.sent.length, 0);
  assert.equal(ctx.chrome.__store.isaAlertLastSeen, undefined,
    'a deep link must not be mistaken for the Your inbox folder');
});

test('no blink while viewing Your inbox in a visible tab', () => {
  const load = (url) => build({
    store: { isaAlertEnabled: true, isaAlertEnabledInboxes: [] },
    links: [fx.yourInboxNavLink({ count: 0 })],
    url
  });

  const elsewhere = load(UNWATCHED_URL);
  step(elsewhere, () => setYourInboxCount(elsewhere.window, 3));
  assert.equal(elsewhere.window.document.title.indexOf('🔴 '), 0, 'Your inbox blinks while another inbox is open');

  const viewing = load(adminUrl(ADMIN_ID));
  step(viewing, () => setYourInboxCount(viewing.window, 3));
  assert.equal(viewing.window.document.title, '',
    'the inbox you are already looking at must not blink');
});

test('no per-agent or per-workspace id is hardcoded in src', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', '..', 'src');
  fs.readdirSync(dir)
    .filter(name => name.endsWith('.js'))
    .forEach((name) => {
      const body = fs.readFileSync(path.join(dir, name), 'utf8');
      assert.ok(!/9003960|demo1234/.test(body),
        `${name} must not hardcode an admin id or a workspace id`);
    });
});

for (const [label, head] of [
  ['no icon link', ''],
  ['an icon link without an href', '<link rel="icon">']
]) {
  test(`a page with ${label} gets its favicon back when the alert stops`, () => {
    const win = loadExtension(`<!doctype html><html><head>${head}</head><body></body></html>`, {
      beforeScripts(target) {
        target.setInterval = () => 1;
        target.clearInterval = () => {};
        target.HTMLCanvasElement.prototype.getContext = () => ({
          clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}
        });
        target.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,BADGE';
      }
    });
    const visuals = win.createAlertVisuals({
      titleMarker: '(!) ',
      blinkMs: 1000,
      runSafe: fn => fn(),
      collectActive: () => [1],
      summarize: () => ({ text: 'Northside (1)', total: 1 })
    });
    visuals.updateSummary([1]);
    visuals.start();
    const icon = () => win.document.querySelector('link[rel~="icon"]');
    assert.equal(icon().getAttribute('href'), 'data:image/png;base64,BADGE', 'the badge is showing');

    visuals.stop();
    assert.equal(icon() ? icon().getAttribute('href') : null, null, 'no badge is left behind');
    if (!head) assert.equal(icon(), null, 'the link the alert created is removed');
  });
}

test('a page title change during the alert becomes the base title the blink and stop restore', () => {
  const win = loadExtension('<!doctype html><html><head><title>Old page</title></head><body></body></html>', {
    beforeScripts(target) {
      target.setInterval = () => 1;
      target.clearInterval = () => {};
      target.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}
      });
      target.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,BADGE';
    }
  });
  const visuals = win.createAlertVisuals({
    titleMarker: '(!) ',
    blinkMs: 1000,
    runSafe: fn => fn(),
    collectActive: () => [1],
    summarize: () => ({ text: 'Northside (1)', total: 1 })
  });
  visuals.updateSummary([1]);
  visuals.start();
  assert.equal(win.document.title, '(!) Northside (1)');

  win.document.title = 'New page';
  visuals.pulse();
  assert.equal(win.document.title, 'New page', 'the quiet phase shows the renamed title');
  visuals.pulse();
  assert.equal(win.document.title, '(!) Northside (1)');
  visuals.pulse();
  assert.equal(win.document.title, 'New page');

  visuals.stop();
  assert.equal(win.document.title, 'New page', 'stopping restores the renamed title, not the old one');
});

test('stopping an alert that never started leaves the page favicon alone', () => {
  const win = loadExtension('<!doctype html><html><head><link rel="icon" href="/favicon.ico"></head><body></body></html>', {
    beforeScripts(target) {
      target.setInterval = () => 1;
      target.clearInterval = () => {};
      target.HTMLCanvasElement.prototype.getContext = () => ({
        clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {}
      });
      target.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,BADGE';
    }
  });
  const visuals = win.createAlertVisuals({
    titleMarker: '(!) ',
    blinkMs: 1000,
    runSafe: fn => fn(),
    collectActive: () => [1],
    summarize: () => ({ text: 'Northside (1)', total: 1 })
  });
  const href = () => win.document.querySelector('link[rel~="icon"]').getAttribute('href');

  visuals.stop();
  assert.equal(href(), '/favicon.ico', 'a stop with no alert running keeps the page icon');

  visuals.updateSummary([1]);
  visuals.start();
  assert.equal(href(), 'data:image/png;base64,BADGE');
  visuals.stop();
  assert.equal(href(), '/favicon.ico', 'the next real alert still restores the page icon');
});
