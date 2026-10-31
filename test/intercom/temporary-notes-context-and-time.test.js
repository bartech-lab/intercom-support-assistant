'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, makeChromeStub } = require('../support/helpers');
const {
  ORIGIN,
  WORKSPACE,
  CONTACT,
  loadSidebar,
  controlsOf,
  enable,
  choose,
} = require('../support/temporary-notes-harness');

const KEY = `${WORKSPACE}:${CONTACT}`;
const ASIDE = 'aside data-test-conversation-details-sidebar="true"';

function link(href, attrs = '') {
  return `<a data-test-user-profile-link="true" href="${href}" ${attrs}>Customer</a>`;
}

function sidebar(inner, attrs = '') {
  return `<${ASIDE} ${attrs}>${inner}</aside>`;
}

function contextOf({ path = `/a/inbox/${WORKSPACE}/inbox/team/1/conversation/2`, body }) {
  const win = loadExtension(`<!doctype html><html><body>${body}</body></html>`, {
    url: `${ORIGIN}${path}`,
    chromeStub: makeChromeStub()
  });
  return win.temporaryNoteContext();
}

const GOOD = link(`/a/apps/${WORKSPACE}/users/${CONTACT}`);

test('control: a valid path, sidebar and profile link give the context', () => {
  const ctx = contextOf({ body: sidebar(GOOD) });
  assert.equal(ctx.workspace, WORKSPACE);
  assert.equal(ctx.contact, CONTACT);
  assert.equal(ctx.key, KEY);
  assert.ok(ctx.sidebar);
});

test('workspace path: 64 chars pass, 65 chars fail', () => {
  const ws64 = 'a'.repeat(63) + '-';
  const ws65 = 'a'.repeat(65);
  const ok = contextOf({
    path: `/a/inbox/${ws64}/inbox/team/1`,
    body: sidebar(link(`/a/apps/${ws64}/users/${CONTACT}`))
  });
  assert.equal(ok.workspace, ws64);
  const bad = contextOf({
    path: `/a/inbox/${ws65}/inbox/team/1`,
    body: sidebar(link(`/a/apps/${ws65}/users/${CONTACT}`))
  });
  assert.equal(bad, null);
});

test('workspace path: allows underscore and hyphen, rejects a dot', () => {
  const ok = contextOf({
    path: '/a/inbox/ws_1-x/inbox/team/1',
    body: sidebar(link(`/a/apps/ws_1-x/users/${CONTACT}`))
  });
  assert.equal(ok.workspace, 'ws_1-x');
  const bad = contextOf({
    path: '/a/inbox/ws.1/inbox/team/1',
    body: sidebar(link(`/a/apps/ws.1/users/${CONTACT}`))
  });
  assert.equal(bad, null);
});

test('workspace path must start at the beginning of the path', () => {
  const ok = contextOf({ path: `/a/inbox/ws1/x`, body: sidebar(link(`/a/apps/ws1/users/${CONTACT}`)) });
  assert.equal(ok.workspace, 'ws1');
  const prefixed = contextOf({ path: `/x/a/inbox/ws1/x`, body: sidebar(link(`/a/apps/ws1/users/${CONTACT}`)) });
  assert.equal(prefixed, null);
  const missing = contextOf({ path: `/a/apps/ws1/x`, body: sidebar(link(`/a/apps/ws1/users/${CONTACT}`)) });
  assert.equal(missing, null);
});

test('sidebar count: zero gives null, one visible gives a context', () => {
  assert.equal(contextOf({ body: GOOD }), null);
  assert.ok(contextOf({ body: sidebar(GOOD) }));
});

test('sidebar count: two visible give null', () => {
  assert.equal(contextOf({ body: sidebar(GOOD) + sidebar(GOOD) }), null);
});

for (const [label, attrs] of [
  ['a hidden attribute', 'hidden'],
  ['display none', 'style="display:none"'],
  ['visibility hidden', 'style="visibility:hidden"']
]) {
  test(`sidebar count: a second sidebar with ${label} does not count`, () => {
    const ctx = contextOf({ body: sidebar(GOOD) + sidebar(GOOD, attrs) });
    assert.ok(ctx, 'the visible sidebar is the only one');
    assert.equal(ctx.contact, CONTACT);
  });
}

test('sidebar count: a hidden sidebar alone gives null', () => {
  assert.equal(contextOf({ body: sidebar(GOOD, 'hidden') }), null);
});

test('profile link count: zero gives null', () => {
  assert.equal(contextOf({ body: sidebar('<span>none</span>') }), null);
});

test('profile link count: two visible give null', () => {
  const other = link(`/a/apps/${WORKSPACE}/users/aaaaaaaaaaaaaaaaaaaaaaaa`);
  assert.equal(contextOf({ body: sidebar(GOOD + other) }), null);
});

for (const [label, attrs] of [
  ['a hidden attribute', 'hidden'],
  ['display none', 'style="display:none"']
]) {
  test(`profile link count: a second link with ${label} does not count`, () => {
    const other = link(`/a/apps/${WORKSPACE}/users/aaaaaaaaaaaaaaaaaaaaaaaa`, attrs);
    const ctx = contextOf({ body: sidebar(GOOD + other) });
    assert.ok(ctx);
    assert.equal(ctx.contact, CONTACT);
  });
}

test('a profile link outside the sidebar does not count', () => {
  const ctx = contextOf({ body: sidebar(GOOD) + link(`/a/apps/${WORKSPACE}/users/aaaaaaaaaaaaaaaaaaaaaaaa`) });
  assert.equal(ctx.contact, CONTACT);
});

test('profile link: 24 lowercase hex pass, 23 and 25 fail', () => {
  assert.ok(contextOf({ body: sidebar(link(`/a/apps/${WORKSPACE}/users/90082c8540bd056969e78865`)) }));
  assert.equal(contextOf({ body: sidebar(link(`/a/apps/${WORKSPACE}/users/${CONTACT.slice(0, 23)}`)) }), null);
  assert.equal(contextOf({ body: sidebar(link(`/a/apps/${WORKSPACE}/users/${CONTACT}a`)) }), null);
});

test('profile link: uppercase hex and non-hex letters fail', () => {
  assert.equal(contextOf({ body: sidebar(link(`/a/apps/${WORKSPACE}/users/${CONTACT.toUpperCase()}`)) }), null);
  assert.equal(contextOf({ body: sidebar(link(`/a/apps/${WORKSPACE}/users/${CONTACT.slice(0, 23)}g`)) }), null);
});

test('profile link: extra path after the id fails', () => {
  assert.equal(contextOf({ body: sidebar(link(`/a/apps/${WORKSPACE}/users/${CONTACT}/notes`)) }), null);
  assert.equal(contextOf({ body: sidebar(link(`/a/apps/${WORKSPACE}/users/${CONTACT}/`)) }), null);
});

test('profile link: a different workspace fails', () => {
  assert.equal(contextOf({ body: sidebar(link(`/a/apps/other/users/${CONTACT}`)) }), null);
});

test('profile link: a different origin fails, the same origin absolute URL passes', () => {
  assert.equal(contextOf({ body: sidebar(link(`https://evil.example/a/apps/${WORKSPACE}/users/${CONTACT}`)) }), null);
  const ctx = contextOf({ body: sidebar(link(`${ORIGIN}/a/apps/${WORKSPACE}/users/${CONTACT}`)) });
  assert.equal(ctx.contact, CONTACT);
});

test('profile link: a path not under /a/apps/ fails', () => {
  assert.equal(contextOf({ body: sidebar(link(`/a/inbox/${WORKSPACE}/users/${CONTACT}`)) }), null);
  assert.equal(contextOf({ body: sidebar(link(`/x/a/apps/${WORKSPACE}/users/${CONTACT}`)) }), null);
});

function armSetup() {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const posted = [];
  const nativePostMessage = win.postMessage.bind(win);
  win.postMessage = (message, targetOrigin) => {
    posted.push(message);
    nativePostMessage(message, targetOrigin);
  };
  enable(win, panel);
  choose(win, panel, 'custom-date');
  const pad = value => String(value).padStart(2, '0');
  const chosen = new win.Date(Date.now() + 3 * 86400000);
  const day = `${chosen.getFullYear()}-${pad(chosen.getMonth() + 1)}-${pad(chosen.getDate())}`;
  const fire = (field, value) => {
    field.value = value;
    field.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const last = () => posted.filter(m => m && m.__isaTempNote === true).at(-1);
  return { win, panel, posted, day, fire, last, chosen };
}

function lifetimeFor(time, day) {
  const s = armSetup();
  s.fire(s.panel.date, day === undefined ? s.day : day);
  s.posted.length = 0;
  s.fire(s.panel.time, time);
  return { s, message: s.last() };
}

for (const time of ['9:05', '09:05', ' 09 . 05 ', '09.05', '23:59', '0:00', '00:00', ' 9 : 05 ']) {
  test(`custom time ${JSON.stringify(time)} arms an absolute lifetime`, () => {
    const { s, message } = lifetimeFor(time);
    assert.ok(message, 'a message is posted');
    assert.equal(message.kind, 'arm');
    assert.equal(message.lifetime.mode, 'absolute');
    const [h, m] = time.split(/\s*[:.]\s*/).map(part => Number(part.trim()));
    const local = new s.win.Date(`${s.day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    assert.equal(message.lifetime.expiresAt, local.toISOString());
  });
}

for (const time of ['24:00', '23:60', '9:5', '', '9']) {
  test(`custom time ${JSON.stringify(time)} is rejected and disarms`, () => {
    const control = armSetup();
    control.fire(control.panel.date, control.day);
    control.fire(control.panel.time, '09:05');
    assert.equal(control.last().kind, 'arm', 'control: the valid time arms');
    control.fire(control.panel.time, time);
    const message = control.last();
    assert.equal(message.kind, 'disarm');
    assert.equal(message.lifetime, undefined);
  });
}

test('custom time boundary: 23:59 arms while 24:00 disarms on the same day', () => {
  assert.equal(lifetimeFor('23:59').message.kind, 'arm');
  assert.equal(lifetimeFor('24:00').message.kind, 'disarm');
  assert.equal(lifetimeFor('23:59').message.lifetime.expiresAt.length, 24);
});

for (const day of ['2026-1-05', '2026-01-05x', 'x2026-01-05', '26-01-05', '']) {
  test(`custom day ${JSON.stringify(day)} gives no valid lifetime`, () => {
    const s = armSetup();
    s.fire(s.panel.time, '09:05');
    s.fire(s.panel.date, s.day);
    assert.equal(s.last().kind, 'arm', 'control: a valid day arms');
    s.panel.date.value = day;
    s.panel.date.dispatchEvent(new s.win.Event('input', { bubbles: true }));
    assert.equal(s.last().kind, 'disarm');
  });
}

function pendingSetup() {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const ui = win.ISA_TEMPORARY_NOTES_UI;
  const posted = [];
  const nativePostMessage = win.postMessage.bind(win);
  win.postMessage = (message, targetOrigin) => {
    posted.push(message);
    nativePostMessage(message, targetOrigin);
  };
  enable(win, panel);
  const textarea = win.document.querySelector('textarea[data-testid="note-input"]');
  const type = (value) => {
    textarea.value = value;
    textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const draft = () => ui.getDraft(KEY);
  const reply = (status, extra = {}) => win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-save', token: draft().token, revision: draft().revision, status, ...extra }
  });
  const count = () => posted.filter(m => m && m.__isaTempNote === true && (m.kind === 'arm' || m.kind === 'disarm')).length;
  return { type, draft, reply, count, posted };
}

for (const status of ['pending', 'uncertain']) {
  test(`while a save is ${status}, edits post nothing and keep the revision`, () => {
    const t = pendingSetup();
    t.type('first');
    t.reply(status);
    assert.equal(t.draft().status, status);
    const revision = t.draft().revision;
    const posts = t.count();
    t.type('second');
    t.type('');
    t.type('third');
    assert.equal(t.count(), posts, 'no arm or disarm is posted');
    assert.equal(t.draft().revision, revision, 'the revision is unchanged');
  });
}

test('after a failed reply the next edit arms again with a bumped revision', () => {
  const t = pendingSetup();
  t.type('first');
  t.reply('pending');
  const revision = t.draft().revision;
  t.type('blocked edit');
  assert.equal(t.draft().revision, revision);
  t.reply('failed', { reason: 'http-422' });
  const posts = t.count();
  t.type('after failure');
  assert.equal(t.count(), posts + 1);
  const last = t.posted.filter(m => m && m.__isaTempNote === true).at(-1);
  assert.equal(last.kind, 'arm');
  assert.equal(last.draft, 'after failure');
  assert.ok(t.draft().revision > revision);
});
