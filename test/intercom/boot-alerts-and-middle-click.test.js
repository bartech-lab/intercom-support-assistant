'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ALDER = '90005450';
const SETTLE_MS = 1500;
const UNWATCHED_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/999/conversation/1';

function makeChrome(initialStore = {}) {
  const store = { ...initialStore };
  const changedListeners = [];
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
          changedListeners.forEach(fn => fn(changes, 'local'));
          if (typeof cb === 'function') cb();
        }
      },
      onChanged: { addListener: fn => changedListeners.push(fn) }
    }
  };
}

function buildAlertPage() {
  const chrome = makeChrome({ isaAlertEnabled: true, isaAlertEnabledInboxes: [ALDER] });
  const link = fx.inboxNavLink({ teamId: ALDER, label: 'Urgent Alderpoint', count: 0 });
  const win = loadExtension(fx.inboxHtml({ nav: fx.inboxNav([link], []) }), {
    url: UNWATCHED_URL,
    beforeScripts(w) {
      w.chrome = chrome;
      w.setInterval = () => 1;
      w.clearInterval = () => {};
      const proto = w.HTMLCanvasElement && w.HTMLCanvasElement.prototype;
      if (proto) {
        proto.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {} });
        proto.toDataURL = () => 'data:image/png;base64,BADGE';
      }
    }
  });
  const clock = { now: Date.now() };
  win.alertClock = () => clock.now;
  clock.now += SETTLE_MS + 1;
  win.evaluateInboxAlerts();
  return { win, chrome, clock };
}

function setCount(win, count) {
  const link = win.document.querySelector(`a[href*="/inbox/team/${ALDER}?"]`);
  let badge = link.querySelector('.count');
  if (!badge) {
    badge = win.document.createElement('span');
    badge.className = 'count';
    link.appendChild(badge);
  }
  badge.textContent = String(count);
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a mutation landing inside the throttle window still gets a trailing inbox-alert evaluation', async () => {
  const { win, chrome, clock } = buildAlertPage();
  const throttleMs = 100;
  const frozen = Date.now() + 60000;
  win.Date.now = () => frozen;
  const host = win.document.body;

  setCount(win, 3);
  win.evaluateInboxAlerts();
  await pause(throttleMs * 3);
  chrome.__sent.length = 0;

  host.appendChild(win.document.createElement('div'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chrome.__sent.length, 0, 'the settle window has not elapsed yet');

  clock.now += SETTLE_MS + 1;
  host.appendChild(win.document.createElement('div'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chrome.__sent.length, 0, 'the second mutation is postponed by the throttle');

  await pause(throttleMs * 4);

  assert.equal(chrome.__sent.length, 1, 'the trailing evaluation raised the alert without another change');
  assert.equal(chrome.__sent[0].teamId, ALDER);
  assert.equal(chrome.__sent[0].count, 3);
});

function userIdPage() {
  const win = loadExtension(fx.inboxHtml({}));
  const host = win.document.createElement('div');
  host.innerHTML = '<span data-original-user-id="42"><a id="inside" href="https://example.test/customers/42">Profile</a></span>'
    + '<div id="elsewhere"><a id="outside" href="https://example.test/other">Other</a></div>';
  win.document.body.appendChild(host);
  const opened = [];
  win.open = (url, target) => { opened.push([url, target]); return null; };
  return { win, opened };
}

function auxclick(win, link, button) {
  const event = new win.MouseEvent('auxclick', { button, bubbles: true, composed: true, cancelable: true });
  link.dispatchEvent(event);
  return event;
}

test('a middle click on a link inside the user-id area opens it in a new tab and prevents default', () => {
  const { win, opened } = userIdPage();
  const event = auxclick(win, win.document.getElementById('inside'), 1);

  assert.deepEqual(opened, [['https://example.test/customers/42', '_blank']]);
  assert.equal(event.defaultPrevented, true);
});

for (const button of [2, 3, 4]) {
  test(`auxclick with button ${button} on a user-id link is left to the browser`, () => {
    const { win, opened } = userIdPage();
    const event = auxclick(win, win.document.getElementById('inside'), button);

    assert.deepEqual(opened, []);
    assert.equal(event.defaultPrevented, false);
  });
}

test('a middle click on a link outside any user-id area is left to the browser', () => {
  const { win, opened } = userIdPage();
  const event = auxclick(win, win.document.getElementById('outside'), 1);

  assert.deepEqual(opened, []);
  assert.equal(event.defaultPrevented, false);
});
