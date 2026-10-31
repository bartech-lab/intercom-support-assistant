'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { JSDOM } = require('jsdom');
const { loadIntercomPageHook, makeIntercomResponse, loadExtension, makeChromeStub } = require('../support/helpers');
const fx = require('../support/fixtures');

const ROOT = path.join(__dirname, '..', '..');
const READ_CAPTURE = path.join(ROOT, 'tools', 'read-capture.js');

const ORIGIN = 'https://app.intercom.com';
const ASSIGNEES_URL = `${ORIGIN}/ember/inbox/assignees?app_id=demo1234`;
const ADMINS_URL = `${ORIGIN}/ember/inbox/assignees/admins?app_id=demo1234`;
const ADMIN_EMAIL = 'hidden.agent.mailbox@example.test';
const ADMIN_NAME = 'Zyxwv Hiddenadmin';


const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isa-team-directory-'));
  tempDirs.push(dir);
  return dir;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function byId(list) {
  return plain(list).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function assigneesBody(teams, admins) {
  return JSON.stringify({
    admins: {
      total: 1,
      results: admins || [{ id: 9003216, name: ADMIN_NAME, email: ADMIN_EMAIL, avatar: null }]
    },
    teams: { total: teams.length, results: teams },
    version: 3
  });
}

function hookWith(bodyByUrl) {
  const fetchImpl = function (input) {
    const url = typeof input === 'string' ? input : input.url;
    const entry = bodyByUrl[url];
    if (entry === undefined) return Promise.resolve(makeIntercomResponse('{}', { url }));
    return Promise.resolve(entry);
  };
  const ctx = loadIntercomPageHook({ fetchImpl });
  return ctx;
}

function directoryEnvelopes(ctx) {
  return ctx.posted.filter(m => m && m.__isaic === true && m.kind === 'team-directory');
}

async function fetchAfterReady(ctx, url, init) {
  ctx.sendReady();
  await ctx.window.fetch(url, init);
  await delay(0);
  await delay(0);
  return directoryEnvelopes(ctx);
}

test('the assignees response relays only valid, trimmed teams and never an admin', async () => {
  const longValid = 'L'.repeat(120);
  const body = assigneesBody([
    { id: 900202, name: '  Support Alpha  ', icon: '🙂', is_redacted: false },
    { id: 9009864, name: 'Support Redacted', icon: '', is_redacted: true },
    { id: 'abc', name: 'Support Letters', icon: '', is_redacted: false },
    { id: 900203, name: '', icon: '', is_redacted: false },
    { id: 9009866, name: '    ', icon: '', is_redacted: false },
    { id: 9009867, name: 'M'.repeat(121), icon: '', is_redacted: false },
    { id: 9009868, name: 'Bad\u0007Bell', icon: '', is_redacted: false },
    { id: 9009869, name: 'Line\nBreak', icon: '', is_redacted: false },
    { id: 99, name: longValid, icon: '', is_redacted: false }
  ]);
  const ctx = hookWith({ [ASSIGNEES_URL]: makeIntercomResponse(body, { url: ASSIGNEES_URL }) });
  const envelopes = await fetchAfterReady(ctx, ASSIGNEES_URL);
  assert.equal(envelopes.length, 1);
  const envelope = envelopes[0];
  assert.equal(envelope.__isaic, true);
  assert.equal(envelope.version, 1);
  assert.equal(typeof envelope.observedAt, 'number');
  assert.deepEqual(byId(envelope.teams), byId([
    { id: '900202', name: 'Support Alpha' },
    { id: '99', name: longValid }
  ]));
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(ADMIN_EMAIL), false, 'admin email leaked');
  assert.equal(serialized.includes(ADMIN_NAME), false, 'admin name leaked');
  assert.equal(serialized.includes('9003216'), false, 'admin id leaked');
});

test('the relayed team list is capped at 2000 entries', async () => {
  const teams = Array.from({ length: 2005 }, (_, i) => ({ id: 1000000 + i, name: `Team ${i}`, icon: '', is_redacted: false }));
  const ctx = hookWith({ [ASSIGNEES_URL]: makeIntercomResponse(assigneesBody(teams), { url: ASSIGNEES_URL }) });
  const envelopes = await fetchAfterReady(ctx, ASSIGNEES_URL);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].teams.length, 2000);
});

test('a response with no valid team posts nothing', async () => {
  const body = assigneesBody([
    { id: 1, name: 'Support Hidden', icon: '', is_redacted: true },
    { id: 'x1', name: 'Support Letters', icon: '', is_redacted: false }
  ]);
  const ctx = hookWith({ [ASSIGNEES_URL]: makeIntercomResponse(body, { url: ASSIGNEES_URL }) });
  assert.equal((await fetchAfterReady(ctx, ASSIGNEES_URL)).length, 0);
});

test('a non-200 assignees response posts nothing', async () => {
  const body = assigneesBody([{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }]);
  const ctx = hookWith({ [ASSIGNEES_URL]: makeIntercomResponse(body, { url: ASSIGNEES_URL, status: 500 }) });
  assert.equal((await fetchAfterReady(ctx, ASSIGNEES_URL)).length, 0);
});

test('a non-JSON assignees response posts nothing', async () => {
  const body = assigneesBody([{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }]);
  const ctx = hookWith({ [ASSIGNEES_URL]: makeIntercomResponse(body, { url: ASSIGNEES_URL, contentType: 'text/html; charset=utf-8' }) });
  assert.equal((await fetchAfterReady(ctx, ASSIGNEES_URL)).length, 0);
});

test('a POST to the assignees path posts nothing', async () => {
  const body = assigneesBody([{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }]);
  const ctx = hookWith({ [ASSIGNEES_URL]: makeIntercomResponse(body, { url: ASSIGNEES_URL }) });
  assert.equal((await fetchAfterReady(ctx, ASSIGNEES_URL, { method: 'POST' })).length, 0);
});

test('a longer path under assignees posts nothing', async () => {
  const body = assigneesBody([{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }]);
  const ctx = hookWith({ [ADMINS_URL]: makeIntercomResponse(body, { url: ADMINS_URL }) });
  assert.equal((await fetchAfterReady(ctx, ADMINS_URL)).length, 0);
});

test('a team directory seen before the handshake is buffered and the latest one wins', async () => {
  const bodies = {
    [ASSIGNEES_URL]: makeIntercomResponse(
      assigneesBody([{ id: 111, name: 'Support First', icon: '', is_redacted: false }]), { url: ASSIGNEES_URL })
  };
  const ctx = hookWith(bodies);
  await ctx.window.fetch(ASSIGNEES_URL);
  await delay(0);
  bodies[ASSIGNEES_URL] = makeIntercomResponse(
    assigneesBody([{ id: 222, name: 'Support Second', icon: '', is_redacted: false }]), { url: ASSIGNEES_URL });
  await ctx.window.fetch(ASSIGNEES_URL);
  await delay(0);
  assert.equal(directoryEnvelopes(ctx).length, 0, 'nothing posts before the handshake');

  ctx.sendReady();
  await delay(0);
  const envelopes = directoryEnvelopes(ctx);
  assert.equal(envelopes.length, 1);
  assert.deepEqual(plain(envelopes[0].teams), [{ id: '222', name: 'Support Second' }]);

  ctx.sendReady();
  await delay(0);
  assert.equal(directoryEnvelopes(ctx).length, 1, 'a second handshake replays nothing');
});

function post(win, envelope) {
  win.dispatchEvent(new win.MessageEvent('message', { source: win, origin: ORIGIN, data: envelope }));
}

function directoryEnvelope(teams, observedAt) {
  return { __isaic: true, version: 1, kind: 'team-directory', teams, observedAt };
}

function bridgeWindow(options = {}) {
  const win = loadExtension(fx.inboxHtml(), options);
  return win;
}

test('the bridge snapshot is null before any team directory arrives', () => {
  const win = bridgeWindow();
  assert.equal(win.teamDirectorySnapshot(), null);
});

test('the bridge keeps the latest list and returns a copy', () => {
  const win = bridgeWindow();
  const first = Date.now() - 5000;
  post(win, directoryEnvelope([{ id: '1', name: 'Support One' }], first));
  const second = Date.now() - 4000;
  post(win, directoryEnvelope([{ id: '2', name: 'Support Two' }, { id: '3', name: 'Support Three' }], second));

  const snapshot = win.teamDirectorySnapshot();
  assert.equal(snapshot.observedAt, new Date(second).toISOString());
  assert.deepEqual(plain(snapshot.teams), [{ id: '2', name: 'Support Two' }, { id: '3', name: 'Support Three' }]);

  snapshot.teams.push({ id: '9', name: 'Support Injected' });
  snapshot.teams[0].name = 'Mutated';
  assert.deepEqual(plain(win.teamDirectorySnapshot().teams), [{ id: '2', name: 'Support Two' }, { id: '3', name: 'Support Three' }]);
});

test('invalid team-directory envelopes are ignored and keep the previous list', () => {
  const win = bridgeWindow();
  const base = Date.now() - 60000;
  post(win, directoryEnvelope([{ id: '42', name: 'Support Kept' }], base));
  const kept = plain(win.teamDirectorySnapshot());
  assert.deepEqual(kept.teams, [{ id: '42', name: 'Support Kept' }]);

  const tooMany = Array.from({ length: 2001 }, (_, i) => ({ id: String(1000 + i), name: `Team ${i}` }));
  const invalid = [
    ['empty teams', directoryEnvelope([], base + 1000)],
    ['more than 2000 teams', directoryEnvelope(tooMany, base + 2000)],
    ['numeric id', directoryEnvelope([{ id: 43, name: 'Support Number' }], base + 3000)],
    ['non-digit id', directoryEnvelope([{ id: '4x3', name: 'Support Letters' }], base + 4000)],
    ['empty name', directoryEnvelope([{ id: '44', name: '' }], base + 5000)],
    ['121-char name', directoryEnvelope([{ id: '45', name: 'N'.repeat(121) }], base + 6000)],
    ['future observedAt', directoryEnvelope([{ id: '46', name: 'Support Future' }], Date.now() + 60000)]
  ];
  for (const [label, envelope] of invalid) {
    post(win, envelope);
    assert.deepEqual(plain(win.teamDirectorySnapshot()), kept, `${label} replaced the stored list`);
  }
});

function captureMeta(html) {
  const dom = new JSDOM(html);
  const meta = JSON.parse(dom.window.document.getElementById('isa-capture-meta').textContent);
  dom.window.close();
  return meta;
}

function intercomCapture(win, chrome) {
  const { responses } = chrome.runtime.onMessage.__emit({ type: 'isa-dom-capture' });
  const capture = responses.find(entry => entry && entry.html);
  assert.ok(capture, 'a capture payload was returned');
  return capture;
}

const SHADOW_PAGE = '<!doctype html><html><head><title>Intercom</title></head><body><div id="teammate-app-react"></div></body></html>';

test('an Intercom capture without a team list records teamDirectory as null', () => {
  const chrome = makeChromeStub();
  const win = bridgeWindow({ chromeStub: chrome });
  const meta = captureMeta(intercomCapture(win, chrome).html);
  assert.ok(Object.prototype.hasOwnProperty.call(meta, 'teamDirectory'), 'teamDirectory key present');
  assert.equal(meta.teamDirectory, null);
});

test('an Intercom capture records the team directory snapshot in its metadata', () => {
  const chrome = makeChromeStub();
  const win = loadExtension(SHADOW_PAGE, { chromeStub: chrome });
  const observedAt = Date.now() - 3000;
  post(win, directoryEnvelope([{ id: '900202', name: 'Support <Alpha>' }, { id: '90005391', name: 'Urgent kestrel' }], observedAt));
  const meta = captureMeta(intercomCapture(win, chrome).html);
  assert.deepEqual(meta.teamDirectory, plain(win.teamDirectorySnapshot()));
  assert.equal(meta.teamDirectory.observedAt, new Date(observedAt).toISOString());
  assert.deepEqual(meta.teamDirectory.teams, [{ id: '900202', name: 'Support <Alpha>' }, { id: '90005391', name: 'Urgent kestrel' }]);
});

function writeCaptureFile(meta) {
  const dir = tempDir();
  const file = path.join(dir, 'intercom-20260926T101500-456.html');
  const json = JSON.stringify(meta, null, 2).replace(/</g, '\\u003c');
  fs.writeFileSync(file, `<!doctype html>\n<html><head><script type="application/json" id="isa-capture-meta">\n${json}\n</script></head><body></body></html>\n`, 'utf8');
  return file;
}

const CAPTURE_META_BASE = {
  surface: 'intercom',
  url: 'https://app.intercom.com/a/inbox/team/123/conversation/456',
  conversationId: '456',
  view: 'conversation'
};

const DIRECTORY = {
  observedAt: '2026-09-26T10:15:00.000Z',
  teams: [
    { id: '300', name: 'Charlie Desk' },
    { id: '100', name: 'Alpha Desk' },
    { id: '200', name: 'Bravo <Desk>' }
  ]
};

function readCaptureCli(args) {
  return spawnSync(process.execPath, [READ_CAPTURE, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('read-capture --teams prints the count and one sorted id-tab-name line per team', () => {
  const file = writeCaptureFile({ ...CAPTURE_META_BASE, teamDirectory: DIRECTORY });
  const result = readCaptureCli([file, '--teams']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = result.stdout.split('\n').filter(line => line.trim() !== '');
  assert.match(lines[0], /^# 3 teams/);
  assert.deepEqual(lines.slice(1), ['100\tAlpha Desk', '200\tBravo <Desk>', '300\tCharlie Desk']);
});

test('read-capture --teams on a capture without a team list asks for a reload and fails', () => {
  const file = writeCaptureFile({ ...CAPTURE_META_BASE, teamDirectory: null });
  const result = readCaptureCli([file, '--teams']);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /reload/i);
  assert.match(`${result.stdout}\n${result.stderr}`, /Intercom/);
});
