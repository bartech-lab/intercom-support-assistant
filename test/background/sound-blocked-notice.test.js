'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ALERT_SOUNDS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'alert-sounds.js'), 'utf8');
const NOTICE_ID = 'isa-sound-blocked-notice';
const NOTICE_TEXT = 'A new message alert had no sound. Click anywhere on this page to turn the sound on.';
const ALERT_TEAM = '900101';

function installAudio(win, audio) {
  win.__contexts = [];
  if (audio === 'unsupported') return;
  win.AudioContext = function FakeAudioContext() {
    win.__contexts.push(this);
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
    this.resume = () => {
      this.state = 'running';
      return Promise.resolve();
    };
  };
  Object.defineProperty(win.navigator, 'userActivation', { value: { isActive: true, hasBeenActive: true }, configurable: true });
}

function setAudioState(win, audio) {
  if (audio === 'unsupported' || audio === 'none') return;
  win.dispatchEvent(new win.Event('pointerdown'));
  assert.equal(win.__contexts.length, 1);
  win.__contexts[0].state = audio;
}

function loadSounds(audio) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;
  installAudio(win, audio);
  vm.runInContext(ALERT_SOUNDS_SRC, dom.getInternalVMContext(), { filename: 'alert-sounds.js' });
  return win;
}

function blockedOf(win, sound) {
  assert.equal(typeof win.ISA_ALERT_SOUNDS.blocked, 'function');
  return win.ISA_ALERT_SOUNDS.blocked(sound);
}

function notices(win) {
  return [...win.document.querySelectorAll(`#${NOTICE_ID}`)];
}

function showNotice(win) {
  assert.equal(typeof win.showSoundBlockedNotice, 'function');
  win.showSoundBlockedNotice();
  return notices(win);
}

function gesture(win, type) {
  const Ctor = type === 'keydown' ? win.KeyboardEvent : win.Event;
  win.document.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }));
}

function loadPlain() {
  return loadExtension('<!doctype html><html><body><main></main></body></html>');
}

test('blocked() is true when audio is supported and no context has been created yet', () => {
  const win = loadSounds('none');
  assert.equal(win.__contexts.length, 0);
  assert.equal(blockedOf(win), true);
});

test('blocked() is true while the context is suspended', () => {
  const win = loadSounds('suspended');
  setAudioState(win, 'suspended');
  assert.equal(win.__contexts[0].state, 'suspended');
  assert.equal(blockedOf(win), true);
});

test('blocked() is false while the context is running', () => {
  const win = loadSounds('running');
  setAudioState(win, 'running');
  assert.equal(win.__contexts[0].state, 'running');
  assert.equal(blockedOf(win), false);
});

test('blocked() follows the context state when it changes', () => {
  const win = loadSounds('running');
  setAudioState(win, 'running');
  assert.equal(blockedOf(win), false);
  win.__contexts[0].state = 'suspended';
  assert.equal(blockedOf(win), true);
});

test('blocked() is false when the browser has no AudioContext at all', () => {
  const win = loadSounds('unsupported');
  assert.equal(win.AudioContext, undefined);
  assert.equal(blockedOf(win), false);
});

for (const audio of ['none', 'suspended']) {
  test(`blocked() is false for the Silent preset, which has nothing to play (${audio})`, () => {
    const win = loadSounds(audio);
    setAudioState(win, audio);
    assert.equal(blockedOf(win, 'silent'), false);
    assert.equal(blockedOf(win, 'blink-blink'), true);
    assert.equal(blockedOf(win, 'no-such-preset'), true);
  });
}

test('showSoundBlockedNotice appends one status element with the exact text and the own marker', () => {
  const win = loadPlain();
  const found = showNotice(win);
  assert.equal(found.length, 1);
  assert.equal(found[0].getAttribute('role'), 'status');
  assert.equal(found[0].hasAttribute('data-isa-own'), true);
  assert.equal(found[0].textContent, NOTICE_TEXT);
  assert.equal(win.document.body.contains(found[0]), true);
});

test('calling it again while the notice is present adds nothing', () => {
  const win = loadPlain();
  const [first] = showNotice(win);
  const again = showNotice(win);
  assert.equal(again.length, 1);
  assert.equal(again[0], first);
});

test('an element with the same id from another install is left untouched and nothing is added', () => {
  const win = loadPlain();
  const foreign = win.document.createElement('div');
  foreign.id = NOTICE_ID;
  foreign.textContent = 'foreign';
  win.document.body.appendChild(foreign);
  const before = win.document.body.innerHTML;
  const found = showNotice(win);
  assert.equal(found.length, 1);
  assert.equal(found[0], foreign);
  assert.equal(foreign.textContent, 'foreign');
  assert.equal(foreign.hasAttribute('role'), false);
  assert.equal(foreign.hasAttribute('data-isa-own'), false);
  assert.equal(win.document.body.innerHTML, before);
});

for (const type of ['pointerdown', 'keydown']) {
  test(`the notice removes itself on the first ${type} on the document`, () => {
    const win = loadPlain();
    assert.equal(showNotice(win).length, 1);
    gesture(win, type);
    assert.equal(notices(win).length, 0);
  });
}

function noticeColours(win) {
  const [notice] = showNotice(win);
  const style = win.getComputedStyle(notice);
  return [style.backgroundColor, style.color];
}

test('on a light page the notice is light with dark text', () => {
  const win = loadPlain();
  win.document.body.style.backgroundColor = 'rgb(255, 255, 255)';
  assert.deepEqual(noticeColours(win), ['rgb(255, 255, 255)', 'rgb(17, 24, 39)']);
});

test('on a dark page the notice is dark with light text', () => {
  const win = loadPlain();
  win.document.body.style.backgroundColor = 'rgb(22, 23, 28)';
  assert.deepEqual(noticeColours(win), ['rgb(31, 41, 55)', 'rgb(255, 255, 255)']);
});

test('a transparent body takes the theme from the page root background', () => {
  const win = loadPlain();
  win.document.documentElement.style.backgroundColor = 'rgb(250, 250, 250)';
  assert.deepEqual(noticeColours(win), ['rgb(255, 255, 255)', 'rgb(17, 24, 39)']);
});

test('the theme comes from what sits behind the notice corner, not from the body, when they differ', () => {
  const win = loadPlain();
  win.document.body.style.backgroundColor = 'rgb(22, 23, 28)';
  const panel = win.document.createElement('div');
  panel.style.backgroundColor = 'rgb(255, 255, 255)';
  const inner = win.document.createElement('span');
  panel.appendChild(inner);
  win.document.querySelector('main').appendChild(panel);
  const asked = [];
  win.document.elementFromPoint = (x, y) => { asked.push([x, y]); return inner; };
  assert.deepEqual(noticeColours(win), ['rgb(255, 255, 255)', 'rgb(17, 24, 39)']);
  assert.deepEqual(asked, [[24, win.innerHeight - 24]]);
});

test('a page with no background colour at all gets the dark notice', () => {
  const win = loadPlain();
  assert.deepEqual(noticeColours(win), ['rgb(31, 41, 55)', 'rgb(255, 255, 255)']);
});

test('the notice stays until a gesture happens', () => {
  const win = loadPlain();
  showNotice(win);
  win.document.dispatchEvent(new win.Event('click', { bubbles: true }));
  win.document.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true }));
  assert.equal(notices(win).length, 1);
});

test('after removal a later call shows the notice again and a new gesture removes it again', () => {
  const win = loadPlain();
  showNotice(win);
  gesture(win, 'pointerdown');
  assert.equal(notices(win).length, 0);
  assert.equal(showNotice(win).length, 1);
  assert.equal(notices(win)[0].textContent, NOTICE_TEXT);
  gesture(win, 'keydown');
  assert.equal(notices(win).length, 0);
});

test('a gesture after the notice is gone does not remove a foreign element with the same id', () => {
  const win = loadPlain();
  showNotice(win);
  gesture(win, 'pointerdown');
  const foreign = win.document.createElement('div');
  foreign.id = NOTICE_ID;
  win.document.body.appendChild(foreign);
  gesture(win, 'keydown');
  assert.equal(notices(win).length, 1);
  assert.equal(notices(win)[0], foreign);
});

function makeIntercomChrome(initialStore) {
  const store = { ...initialStore };
  const sent = [];
  return {
    __store: store,
    __sent: sent,
    runtime: { id: 'test-ext', sendMessage: message => { sent.push(message); } },
    storage: {
      local: {
        get(defaults, callback) {
          const result = {};
          Object.keys(defaults).forEach(key => { result[key] = (key in store) ? store[key] : defaults[key]; });
          callback(result);
        },
        set(items, callback) {
          Object.assign(store, items);
          if (typeof callback === 'function') callback();
        }
      },
      onChanged: { addListener: () => {} }
    }
  };
}

function buildIntercom({ audio, sound }) {
  const chrome = makeIntercomChrome({ isaAlertEnabled: true, isaAlertEnabledInboxes: [ALERT_TEAM], ...(sound ? { isaAlertSound: sound } : {}) });
  const played = [];
  const clock = { now: Date.now() };
  const html = fx.inboxHtml({
    nav: fx.inboxNav([fx.inboxNavLink({ teamId: ALERT_TEAM, label: 'Urgent Alderpoint', count: 0 })], [])
  });
  const win = loadExtension(html, {
    url: 'https://app.intercom.com/a/inbox/demo1234/inbox/team/999/conversation/1',
    chromeStub: chrome,
    beforeScripts(w) {
      installAudio(w, audio);
      w.setInterval = () => 1;
      w.clearInterval = () => {};
      w.setTimeout = () => 1;
      w.clearTimeout = () => {};
      const proto = w.HTMLCanvasElement && w.HTMLCanvasElement.prototype;
      if (proto) {
        proto.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {} });
        proto.toDataURL = () => 'data:image/png;base64,BADGE';
      }
    }
  });
  setAudioState(win, audio);
  win.ISA_ALERT_SOUNDS.play = id => { played.push(id); };
  win.alertClock = () => clock.now;
  clock.now = Date.now() + 1501;
  win.evaluateInboxAlerts();
  clock.now += 1501;
  win.evaluateInboxAlerts();
  chrome.__sent.length = 0;
  const setCount = count => {
    const link = win.document.querySelector(`a[href*="/inbox/team/${ALERT_TEAM}?"]`);
    let badge = link.querySelector('.count');
    if (!badge) {
      badge = win.document.createElement('span');
      badge.className = 'count';
      link.appendChild(badge);
    }
    badge.textContent = String(count);
  };
  const evaluate = () => {
    win.evaluateInboxAlerts();
    clock.now += 1501;
    win.evaluateInboxAlerts();
  };
  const alertsSent = () => chrome.__sent.filter(message => message && message.type === 'inbox-alert');
  return { win, setCount, evaluate, alertsSent, played };
}

for (const audio of ['none', 'suspended']) {
  test(`intercom: a new-message alert shows the notice when the sound is blocked (${audio})`, () => {
    const ctx = buildIntercom({ audio });
    assert.equal(blockedOf(ctx.win), true);
    ctx.setCount(3);
    ctx.evaluate();
    assert.equal(ctx.alertsSent().length, 1);
    assert.equal(ctx.played.length, 1);
    assert.equal(notices(ctx.win).length, 1);
    assert.equal(notices(ctx.win)[0].textContent, NOTICE_TEXT);
  });
}

test('intercom: an alert with the Silent preset shows no notice while the sound is blocked', () => {
  const ctx = buildIntercom({ audio: 'suspended', sound: 'silent' });
  assert.equal(blockedOf(ctx.win), true);
  ctx.setCount(3);
  ctx.evaluate();
  assert.equal(ctx.alertsSent().length, 1);
  assert.deepEqual(ctx.played, ['silent']);
  assert.equal(notices(ctx.win).length, 0);
});

test('intercom: a new-message alert shows no notice when the sound can play', () => {
  const ctx = buildIntercom({ audio: 'running' });
  assert.equal(blockedOf(ctx.win), false);
  ctx.setCount(3);
  ctx.evaluate();
  assert.equal(ctx.alertsSent().length, 1);
  assert.equal(ctx.played.length, 1);
  assert.equal(notices(ctx.win).length, 0);
});

test('intercom: with no alert firing there is no notice even though the sound is blocked', () => {
  const ctx = buildIntercom({ audio: 'none' });
  assert.equal(blockedOf(ctx.win), true);
  ctx.evaluate();
  assert.equal(ctx.alertsSent().length, 0);
  assert.equal(notices(ctx.win).length, 0);
});

test('intercom: an alert with no AudioContext in the browser shows no notice', () => {
  const ctx = buildIntercom({ audio: 'unsupported' });
  assert.equal(blockedOf(ctx.win), false);
  ctx.setCount(3);
  ctx.evaluate();
  assert.equal(ctx.alertsSent().length, 1);
  assert.equal(notices(ctx.win).length, 0);
});
