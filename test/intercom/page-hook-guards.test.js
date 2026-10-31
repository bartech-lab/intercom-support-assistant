'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, WORKSPACE, CONTACT, CONVERSATION_URL, CREATE_URL } = require('../support/temporary-notes-harness');

const ASSIGNEES_URL = `${ORIGIN}/ember/inbox/assignees?app_id=demo1234`;
const LIST_QUERY = 'app_id=demo1234&inbox_type=team&inbox_id=900202&state=open';
const LIST_PATH = '/ember/inbox/conversations/list';

async function armedUnreadable(makeBody) {
  const requests = [];
  const posted = [];
  const hook = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: (input, init) => {
      requests.push({ input, init });
      return Promise.resolve(makeIntercomResponse('{}', { url: CREATE_URL }));
    }
  });
  hook.window.addEventListener('message', event => posted.push(event.data));
  hook.sendReady();
  hook.window.dispatchEvent(new hook.window.MessageEvent('message', {
    data: { __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'temporary note',
      lifetime: { mode: 'relative', delayMs: 30 * 86400000 }, token: 'submission-token-guard', revision: 1 },
    source: hook.window,
    origin: ORIGIN
  }));
  const request = {
    url: CREATE_URL,
    method: 'POST',
    headers: { get: () => null },
    clone: () => ({ text: makeBody })
  };
  let outcome;
  try {
    outcome = { value: await hook.window.fetch(request) };
  } catch (error) {
    outcome = { error };
  }
  await delay(0);
  await delay(0);
  await delay(0);
  const saves = posted.filter(message => message && message.kind === 'temporary-note-save');
  return { requests, saves, outcome };
}

for (const [label, makeBody] of [
  ['resolves to a non-string', () => Promise.resolve({ not: 'a string' })],
  ['rejects', () => Promise.reject(new Error('unreadable'))]
]) {
  test(`an armed note save whose request body text() ${label} is blocked once and never sent`, async () => {
    const { requests, saves, outcome } = await armedUnreadable(makeBody);
    assert.ok(outcome.error, 'the fetch promise must reject');
    assert.equal(requests.length, 0);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].status, 'blocked');
    assert.equal(saves[0].reason, 'request-body-unreadable');
  });
}

function assigneesBody(teams) {
  return JSON.stringify({
    admins: { total: 0, results: [] },
    teams: { total: teams.length, results: teams },
    version: 3
  });
}

async function relayTeams(teams) {
  const fetchImpl = (input) => {
    const url = typeof input === 'string' ? input : input.url;
    return Promise.resolve(makeIntercomResponse(assigneesBody(teams), { url }));
  };
  const ctx = loadIntercomPageHook({ fetchImpl });
  ctx.sendReady();
  await ctx.window.fetch(ASSIGNEES_URL);
  await delay(0);
  await delay(0);
  return ctx.posted.filter(m => m && m.__isaic === true && m.kind === 'team-directory');
}

const teamsOf = envelope => JSON.parse(JSON.stringify(envelope.teams));

test('null and non-object team entries are skipped and the valid teams around them still relay', async () => {
  for (const junk of [5, 'x']) {
    const envelopes = await relayTeams([
      { id: 101, name: 'Before', icon: '', is_redacted: false },
      null,
      junk,
      { id: 102, name: 'After', icon: '', is_redacted: false }
    ]);
    assert.equal(envelopes.length, 1, String(junk));
    assert.deepEqual(teamsOf(envelopes[0]), [
      { id: '101', name: 'Before' },
      { id: '102', name: 'After' }
    ]);
  }
});

test('a team whose name is not a string is skipped and the valid team after it still relays', async () => {
  const envelopes = await relayTeams([
    { id: 201, name: 42, icon: '', is_redacted: false },
    { id: 202, name: {}, icon: '', is_redacted: false },
    { id: 203, name: 'Valid', icon: '', is_redacted: false }
  ]);
  assert.equal(envelopes.length, 1);
  assert.deepEqual(teamsOf(envelopes[0]), [{ id: '203', name: 'Valid' }]);
});

test('conversation list state is relayed for the page origin only', async () => {
  const foreignUrl = `https://cdn.example.net${LIST_PATH}?${LIST_QUERY}`;
  const ownUrl = `${ORIGIN}${LIST_PATH}?${LIST_QUERY}`;
  const ctx = loadIntercomPageHook({
    fetchImpl: (input) => {
      const url = typeof input === 'string' ? input : input.url;
      return Promise.resolve(makeIntercomResponse('{}', { url }));
    }
  });
  const listStates = () => ctx.posted.filter(m => m && m.__isaic === true && m.kind === 'inbox-list-state');
  ctx.sendReady();
  await ctx.window.fetch(foreignUrl);
  await delay(0);
  await delay(0);
  assert.equal(listStates().length, 0);
  await ctx.window.fetch(ownUrl);
  await delay(0);
  await delay(0);
  assert.equal(listStates().length, 1);
  assert.equal(listStates()[0].inboxKey, 'team:900202');
});
