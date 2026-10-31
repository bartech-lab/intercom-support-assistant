'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { makeIntercomResponse } = require('../support/helpers');
const {
  CONVERSATION_ID,
  ORIGIN,
  hookWith,
  relayed,
  INBOXES_URL
} = require('../support/intercom-page-hook-harness');

const CONTACT_ID = '900ebe0ce50a2b5bcd53165e';
const LIST_QUERY = 'inbox_type=team&inbox_id=900202&state=open';
const APP = 'app_id=demo1234';

const ofKind = (envelopes, kind) => envelopes.filter(e => e.kind === kind);

const summaryJson = (extra = {}, language = 'fr') => JSON.stringify({
  state: 'open',
  attributes: [{ descriptor: { id: 'language', name: 'Language' }, value: language }],
  ...extra
});

const streamPart = (id, name, attributeId, value) => ({
  id,
  conversation_id: Number(CONVERSATION_ID),
  created_at: '2026-08-11T09:30:41.250Z',
  renderable_type: 14,
  renderable_data: { attribute_summary: { id: attributeId, name }, value }
});

const streamJson = (parts, extra = {}, id = Number(CONVERSATION_ID)) => JSON.stringify({
  id,
  renderable_parts: parts,
  ...extra
});

const emailPart = to => ({
  id: 1,
  created_at: '2026-08-12T09:14:03.000Z',
  renderable_type: 12,
  renderable_data: {
    email_metadata: {
      sender_type: 'participant',
      header_addresses: {
        from: [{ name: 'Customer', email: 'customer.sample@example.com' }],
        to: [{ name: 'Brand', email: to }]
      }
    }
  }
});

const listJson = (contactId, email = 'customer@example.com') => JSON.stringify({
  meta: { has_more: false },
  conversations: [{
    id: Number(CONVERSATION_ID),
    state: 'open',
    user_summary: { id: contactId, name: 'Customer', email }
  }]
});

async function observe(url, body, init) {
  const ctx = hookWith({ [url]: makeIntercomResponse(body, { url }) });
  const { envelopes } = await relayed(ctx, url, init);
  return envelopes;
}

const summaryUrl = (path = `/ember/inbox/conversations/${CONVERSATION_ID}`) => `${ORIGIN}${path}?${APP}`;

const expectRelayedOnlyWhole = async ({ valid, invalid, kind, probe }) => {
  const accepted = await probe(valid);
  assert.equal(ofKind(accepted, kind).length, 1, `valid value relayed: ${JSON.stringify(valid)}`);
  for (const bad of invalid) {
    const rejected = await probe(bad);
    assert.equal(ofKind(rejected, kind).length, 0, `rejected: ${JSON.stringify(bad)}`);
  }
};

test('the conversation list path matches in full', async () => {
  const probe = async (path) => observe(`${ORIGIN}${path}?${LIST_QUERY}`, '{}');
  for (const valid of ['/ember/inbox/conversations', '/ember/inbox/conversations/list']) {
    assert.equal(ofKind(await probe(valid), 'inbox-list-state').length, 1, valid);
  }
  for (const bad of [
    '/x/ember/inbox/conversations',
    '/x/ember/inbox/conversations/list',
    '/ember/inbox/conversations/listing',
    '/ember/inbox/conversations/list/x',
    '/ember/inbox/conversationsx'
  ]) {
    assert.equal(ofKind(await probe(bad), 'inbox-list-state').length, 0, bad);
  }
});

test('the conversation summary path matches in full', async () => {
  const probe = (path) => observe(summaryUrl(path), summaryJson());
  const id = CONVERSATION_ID;
  const accepted = await probe(`/ember/inbox/conversations/${id}`);
  assert.equal(ofKind(accepted, 'conversation-language').length, 1);
  for (const bad of [
    `/ember/inbox/conversations/${id}/x`,
    `/ember/inbox/conversations/${id}x`,
    `/ember/inbox/conversations/x${id}`,
    `/x/ember/inbox/conversations/${id}`
  ]) {
    assert.equal(ofKind(await probe(bad), 'conversation-language').length, 0, bad);
  }
});

test('the conversation stream path matches in full', async () => {
  const body = streamJson([streamPart(1, 'Language', 'language', 'French')]);
  const probe = (path) => observe(summaryUrl(path), body);
  const id = CONVERSATION_ID;
  const accepted = await probe(`/ember/inbox/conversations/${id}/stream`);
  assert.equal(ofKind(accepted, 'conversation-language').length, 1);
  for (const bad of [
    `/ember/inbox/conversations/${id}/stream/x`,
    `/ember/inbox/conversations/${id}/streams`,
    `/x/ember/inbox/conversations/${id}/stream`,
    `/ember/inbox/conversations/x${id}/stream`
  ]) {
    assert.equal(ofKind(await probe(bad), 'conversation-language').length, 0, bad);
  }
});

test('the user path accepts 1 to 40 letters or digits and nothing around them', async () => {
  const userBody = id => JSON.stringify({ users: [{ id, browser_locale: 'de', geoip_data: { country_code2: 'DE' } }] });
  const probe = (id, path = `/ember/users/${id}`) => observe(`${ORIGIN}${path}?${APP}`, userBody(id));
  for (const valid of ['a', 'Ab12', 'a'.repeat(40)]) {
    assert.equal(ofKind(await probe(valid), 'contact-language').length, 1, valid);
  }
  assert.equal(ofKind(await probe('a'.repeat(41)), 'contact-language').length, 0, '41 characters');
  assert.equal(ofKind(await probe('abc', '/ember/users/abc/x'), 'contact-language').length, 0, 'suffix');
  assert.equal(ofKind(await probe('abc', '/ember/users/abc!x'), 'contact-language').length, 0, 'junk suffix');
  assert.equal(ofKind(await probe('abc', '/x/ember/users/abc'), 'contact-language').length, 0, 'prefix');
  assert.equal(ofKind(await probe('abc', '/ember/users/x!abc'), 'contact-language').length, 0, 'junk prefix');
});

test('a conversation id in the path is digits with nothing around them', async () => {
  const probe = (id) => observe(summaryUrl(`/ember/inbox/conversations/${id}`), summaryJson());
  assert.equal(ofKind(await probe('1'), 'conversation-language').length, 1);
  assert.equal(ofKind(await probe('9'.repeat(20)), 'conversation-language').length, 1);
  assert.equal(ofKind(await probe(`x!${CONVERSATION_ID}`), 'conversation-language').length, 0);
  assert.equal(ofKind(await probe(`${CONVERSATION_ID}!x`), 'conversation-language').length, 0);
});

test('a team id is 1 to 20 digits with nothing around it', async () => {
  const probe = (id) => observe(summaryUrl(), summaryJson({ team_assignee: { id } }));
  await expectRelayedOnlyWhole({
    valid: '900201',
    invalid: ['x!900201', '900201!x', 'x!', '', '9'.repeat(21), '900201 x', '900201\n!x'],
    kind: 'conversation-team',
    probe
  });
  const longest = await probe('9'.repeat(20));
  assert.equal(ofKind(longest, 'conversation-team')[0].teamId, '9'.repeat(20));
});

test('a list conversation id is 1 to 20 digits with nothing around it', async () => {
  const url = `${ORIGIN}/ember/inbox/conversations?${LIST_QUERY}&${APP}`;
  const probe = (id) => observe(url, JSON.stringify({
    meta: { has_more: false },
    conversations: [{ id, state: 'open', user_summary: { id: CONTACT_ID, name: 'Customer', email: 'customer@example.com' } }]
  }));
  await expectRelayedOnlyWhole({
    valid: CONVERSATION_ID,
    invalid: [`x${CONVERSATION_ID}`, `${CONVERSATION_ID}x`, '9'.repeat(21), '', `${CONVERSATION_ID}\n!x`],
    kind: 'inbox-list-identity',
    probe
  });
  const longest = await probe('9'.repeat(20));
  assert.equal(ofKind(longest, 'inbox-list-identity')[0].identities[0].conversationId, '9'.repeat(20));
});

test('a contact id is exactly 24 hex characters with nothing around it', async () => {
  const probe = (id) => observe(`${ORIGIN}/ember/inbox/conversations?${LIST_QUERY}&${APP}`, listJson(id));
  await expectRelayedOnlyWhole({
    valid: CONTACT_ID,
    invalid: [`x!${CONTACT_ID}`, `${CONTACT_ID}!x`, `${CONTACT_ID}0`, CONTACT_ID.slice(1), `${CONTACT_ID}\n!x`, `${CONTACT_ID.slice(1)}g`],
    kind: 'inbox-list-identity',
    probe
  });
});

test('a language value in a summary matches its whole pattern', async () => {
  const probe = (value) => observe(summaryUrl(), summaryJson({}, value));
  await expectRelayedOnlyWhole({
    valid: 'fr',
    invalid: ['x!fr', 'fr!x', 'fr\n!x', 'x!\nfr', 'a'.repeat(65)],
    kind: 'conversation-language',
    probe
  });
  for (const valid of ['pt-BR', 'fr_CA', 'Swiss German', 'a'.repeat(64)]) {
    assert.equal(ofKind(await probe(valid), 'conversation-language').length, 1, valid);
  }
});

test('a language value in a stream matches its whole pattern', async () => {
  const url = summaryUrl(`/ember/inbox/conversations/${CONVERSATION_ID}/stream`);
  const probe = (value) => observe(url, streamJson([streamPart(1, 'Language', 'language', value)]));
  await expectRelayedOnlyWhole({
    valid: 'French',
    invalid: ['x!French', 'French!x', 'French\n!x', 'a'.repeat(65)],
    kind: 'conversation-language',
    probe
  });
});

test('a brand value matches its whole pattern and accepts letters from any script', async () => {
  const url = summaryUrl(`/ember/inbox/conversations/${CONVERSATION_ID}/stream`);
  const probe = (value) => observe(url, streamJson([streamPart(1, 'Brand', '9006910', value)]));
  await expectRelayedOnlyWhole({
    valid: 'Fernhill',
    invalid: ['x!Fernhill', 'Fernhill!x', 'Fernhill\n!x', 'a'.repeat(65)],
    kind: 'conversation-company',
    probe
  });
  for (const valid of ['Ünïcode_1-x', 'Μάρκα_1-x', 'a'.repeat(64)]) {
    assert.equal(ofKind(await probe(valid), 'conversation-company').length, 1, valid);
  }
});

test('an inbound address must look like local@example.com with no spaces', async () => {
  const url = summaryUrl(`/ember/inbox/conversations/${CONVERSATION_ID}/stream`);
  const probe = (to) => observe(url, streamJson([emailPart(to)], { user_summary: { email: 'customer.sample@example.com' } }));
  await expectRelayedOnlyWhole({
    valid: 'support@brightwell.example',
    invalid: ['x support@brightwell.example', 'support@brightwell.example x', 'support@brightwell.example\n!x', 'sup port@brightwell.example', 'a@b@brightwell.example'],
    kind: 'conversation-inbound-address',
    probe
  });
});

test('an identity email in a stream must look like local@example.com with no spaces', async () => {
  const url = summaryUrl(`/ember/inbox/conversations/${CONVERSATION_ID}/stream`);
  const probe = (email) => observe(url, streamJson([], { user_summary: { email } }));
  await expectRelayedOnlyWhole({
    valid: 'elske.arden@example.com',
    invalid: ['x elske.arden@example.com', 'elske.arden@example.com x', 'elske.arden@example.com\n!x', 'elske arden@example.com'],
    kind: 'conversation-identity',
    probe
  });
});

test('a list identity email is dropped when it carries junk around a valid address', async () => {
  const url = `${ORIGIN}/ember/inbox/conversations?${LIST_QUERY}&${APP}`;
  const emailOf = async (email) => {
    const identities = ofKind(await observe(url, listJson(CONTACT_ID, email)), 'inbox-list-identity');
    assert.equal(identities.length, 1);
    return identities[0].identities[0];
  };
  assert.equal((await emailOf('elske.arden@example.com')).email, 'elske.arden@example.com');
  for (const bad of ['x elske.arden@example.com', 'elske.arden@example.com x', 'elske.arden@example.com\n!x']) {
    const entry = await emailOf(bad);
    assert.equal('email' in entry, false, bad);
    assert.equal(entry.contactId, CONTACT_ID);
  }
});

test('an inbox type in the counts payload is 1 to 32 lowercase letters and underscores', async () => {
  const typesFor = async (...types) => {
    const body = JSON.stringify({
      inboxes: types.map((inboxType, index) => ({ id: index + 1, inbox_type: inboxType, count: { count: 1 } }))
    });
    const envelopes = await observe(INBOXES_URL, body, { method: 'POST' });
    return Array.from(ofKind(envelopes, 'inbox-counts')[0].counts, entry => entry.inboxType);
  };
  const longest = 'a'.repeat(31) + '_';
  const kept = await typesFor(
    'team', 'x!team', 'team!x', 'team1', '1team', 'team\n!x', 'a_b', longest, 'a'.repeat(33), 'Team'
  ).catch(() => []);
  assert.deepEqual(kept, ['team', 'a_b', longest]);
});

test('an inbox type in a list query matches its whole pattern', async () => {
  const probe = (type) => observe(
    `${ORIGIN}/ember/inbox/conversations/list?inbox_type=${encodeURIComponent(type)}&inbox_id=900202&state=open`,
    '{}'
  );
  await expectRelayedOnlyWhole({
    valid: 'team',
    invalid: ['x!team', 'team!x', 'team1', '1team', 'a'.repeat(33)],
    kind: 'inbox-list-state',
    probe
  });
  assert.equal(ofKind(await probe('a'.repeat(32)), 'inbox-list-state').length, 1);
});

test('two summaries for different conversations before the handshake both deliver', async () => {
  const idA = '900401386132988';
  const idB = '900401386132989';
  const urlA = summaryUrl(`/ember/inbox/conversations/${idA}`);
  const urlB = summaryUrl(`/ember/inbox/conversations/${idB}`);
  const ctx = hookWith({
    [urlA]: makeIntercomResponse(summaryJson({}, 'de'), { url: urlA }),
    [urlB]: makeIntercomResponse(summaryJson({}, 'fr'), { url: urlB })
  });
  await ctx.window.fetch(urlA);
  await ctx.window.fetch(urlB);
  await delay(0);
  assert.equal(ctx.posted.filter(m => m && m.__isaic === true).length, 0);
  ctx.sendReady();
  await delay(0);
  const languages = ofKind(ctx.posted.filter(m => m && m.__isaic === true), 'conversation-language');
  assert.deepEqual(
    Array.from(languages, e => [e.conversationId, e.language]).sort(),
    [[idA, 'de'], [idB, 'fr']]
  );
});

test('inbox-count envelopes share one slot whatever their content', async () => {
  const bodies = {};
  const countsBody = (id, type, count) => JSON.stringify({
    inboxes: [{ id, inbox_type: type, count: { count } }]
  });
  bodies[INBOXES_URL] = makeIntercomResponse(countsBody(1, 'team', 3), { url: INBOXES_URL });
  const ctx = hookWith(bodies);
  await ctx.window.fetch(INBOXES_URL, { method: 'POST' });
  await delay(0);
  bodies[INBOXES_URL] = makeIntercomResponse(countsBody(2, 'view', 9), { url: INBOXES_URL });
  await ctx.window.fetch(INBOXES_URL, { method: 'POST' });
  await delay(0);
  assert.equal(ctx.posted.filter(m => m && m.__isaic === true).length, 0);
  ctx.sendReady();
  await delay(0);
  const counts = ofKind(ctx.posted.filter(m => m && m.__isaic === true), 'inbox-counts');
  assert.equal(counts.length, 1);
  assert.equal(counts[0].counts.length, 1);
  assert.equal(counts[0].counts[0].inboxType, 'view');
  assert.equal(counts[0].counts[0].inboxId, '2');
  assert.equal(counts[0].counts[0].count, 9);
});
