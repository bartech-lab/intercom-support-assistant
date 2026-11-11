'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { JSDOM } = require('jsdom');
const { makeIntercomResponse, loadExtension, makeChromeStub } = require('../support/helpers');

const ROOT = path.join(__dirname, '..', '..');
const READ_CAPTURE = path.join(ROOT, 'tools', 'read-capture.js');

const ORIGIN = 'https://app.intercom.com';
const WORKSPACE = 'demo1234';
const CSRF = 'csrf-sample-token';
const CAPTURE_URL = `${ORIGIN}/a/inbox/${WORKSPACE}/inbox/team/123/conversation/456`;
const PAGE = `<!doctype html><html><head><title>Intercom</title><meta name="csrf-token" content="${CSRF}"></head><body><div id="teammate-app-react"></div></body></html>`;

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

function teamsBody(teams) {
  return JSON.stringify({ teams });
}

function captureMeta(html) {
  const dom = new JSDOM(html);
  const meta = JSON.parse(dom.window.document.getElementById('isa-capture-meta').textContent);
  dom.window.close();
  return meta;
}

async function captureWith(respond, { url = CAPTURE_URL } = {}) {
  const chrome = makeChromeStub();
  const requests = [];
  loadExtension(PAGE, {
    url,
    chromeStub: chrome,
    beforeScripts: (win) => {
      win.fetch = (input, init) => {
        requests.push({ url: String(input), init });
        return respond(String(input), init);
      };
    }
  });
  const { responses, returned } = chrome.runtime.onMessage.__emit({ type: 'isa-dom-capture' });
  assert.ok(returned.includes(true), 'the capture listener keeps the channel open for an async reply');
  for (let i = 0; i < 50 && !responses.some(entry => entry && entry.html); i += 1) await delay(0);
  const capture = responses.find(entry => entry && entry.html);
  assert.ok(capture, 'a capture payload was returned');
  return { requests, meta: captureMeta(capture.html) };
}

const okTeams = teams => () => Promise.resolve(makeIntercomResponse(teamsBody(teams), { url: CAPTURE_URL }));

test('a capture requests the Intercom team list for the page workspace with the page CSRF token', async () => {
  const { requests, meta } = await captureWith(okTeams([{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }]));
  assert.equal(requests.length, 1);
  const requested = new URL(requests[0].url);
  assert.equal(requested.origin, ORIGIN);
  assert.equal(requested.pathname, '/ember/inbox/assignees/teams');
  assert.equal(requested.searchParams.get('app_id'), WORKSPACE);
  assert.equal(requests[0].init.method === undefined || requests[0].init.method === 'GET', true);
  assert.equal(requests[0].init.credentials, 'same-origin');
  assert.equal(requests[0].init.headers['X-CSRF-Token'], CSRF);
  assert.deepEqual(meta.teamDirectory.teams, [{ id: '900202', name: 'Support Alpha' }]);
  assert.match(meta.teamDirectory.observedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a capture records only valid, trimmed, unredacted teams with their ids as strings', async () => {
  const longValid = 'L'.repeat(120);
  const { meta } = await captureWith(okTeams([
    { id: 900202, name: '  Support <Alpha>  ', icon: '', is_redacted: false },
    { id: 900204, name: 'Support Redacted', icon: '', is_redacted: true },
    { id: 'abc', name: 'Support Letters', icon: '', is_redacted: false },
    { id: 900203, name: '', icon: '', is_redacted: false },
    { id: 900205, name: '    ', icon: '', is_redacted: false },
    { id: 900206, name: 'M'.repeat(121), icon: '', is_redacted: false },
    { id: 900207, name: 'Bad\u0007Bell', icon: '', is_redacted: false },
    { id: 900208, name: 'Line\nBreak', icon: '', is_redacted: false },
    null,
    5,
    { id: 900946, name: 42, icon: '', is_redacted: false },
    { id: 99, name: longValid, icon: '', is_redacted: false }
  ]));
  assert.deepEqual(byId(meta.teamDirectory.teams), byId([
    { id: '900202', name: 'Support <Alpha>' },
    { id: '99', name: longValid }
  ]));
});

test('a capture keeps at most 2000 teams', async () => {
  const teams = Array.from({ length: 2005 }, (_, i) => ({ id: 1000000 + i, name: `Team ${i}`, icon: '', is_redacted: false }));
  const { meta } = await captureWith(okTeams(teams));
  assert.equal(meta.teamDirectory.teams.length, 2000);
});

test('a refused team list request still returns the capture and records the status', async () => {
  const { meta } = await captureWith(() => Promise.resolve(makeIntercomResponse('{}', { url: CAPTURE_URL, status: 401 })));
  assert.deepEqual(meta.teamDirectory, { error: 'http-401' });
  assert.equal(meta.surface, 'intercom');
});

test('a failed team list request still returns the capture and records the failure', async () => {
  const { meta } = await captureWith(() => Promise.reject(new TypeError('network down')));
  assert.deepEqual(meta.teamDirectory, { error: 'request-failed' });
});

test('a timed out team list request is recorded as a timeout', async () => {
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  const { meta } = await captureWith(() => Promise.reject(timeout));
  assert.deepEqual(meta.teamDirectory, { error: 'timeout' });
});

test('a team list response that is not JSON is recorded as a failure', async () => {
  const { meta } = await captureWith(() => Promise.resolve(makeIntercomResponse('<html>sign in</html>', { url: CAPTURE_URL })));
  assert.deepEqual(meta.teamDirectory, { error: 'request-failed' });
});

test('a team list response with no valid team is recorded as no-teams', async () => {
  const { meta } = await captureWith(okTeams([{ id: 1, name: 'Support Hidden', icon: '', is_redacted: true }]));
  assert.deepEqual(meta.teamDirectory, { error: 'no-teams' });
});

test('the old teams.results shape is not read as a team list', async () => {
  const body = JSON.stringify({ teams: { total: 1, results: [{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }] } });
  const { meta } = await captureWith(() => Promise.resolve(makeIntercomResponse(body, { url: CAPTURE_URL })));
  assert.deepEqual(meta.teamDirectory, { error: 'no-teams' });
});

test('a settings page URL requests the team list for its workspace', async () => {
  const { requests } = await captureWith(okTeams([{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }]),
    { url: `${ORIGIN}/a/apps/${WORKSPACE}/settings/teammates` });
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).searchParams.get('app_id'), WORKSPACE);
});

test('a page URL without a workspace skips the request', async () => {
  const { requests, meta } = await captureWith(okTeams([{ id: 900202, name: 'Support Alpha', icon: '', is_redacted: false }]),
    { url: `${ORIGIN}/a/inbox/team/123/conversation/456` });
  assert.equal(requests.length, 0);
  assert.deepEqual(meta.teamDirectory, { error: 'no-workspace' });
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

test('read-capture --teams on a capture from an older build says to capture again and fails', () => {
  const file = writeCaptureFile({ ...CAPTURE_META_BASE, teamDirectory: null });
  const result = readCaptureCli([file, '--teams']);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /capture again with the current build/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /reload/i);
});

test('read-capture --teams on a capture whose team list request failed names the failure and fails', () => {
  const file = writeCaptureFile({ ...CAPTURE_META_BASE, teamDirectory: { error: 'http-401' } });
  const result = readCaptureCli([file, '--teams']);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /team list request failed \(http-401\)/);
});
