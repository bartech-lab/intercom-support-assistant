'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse, loadExtension } = require('../support/helpers');
const {
  CONVERSATION_ID,
  ORIGIN,
  SUMMARY_URL,
  summaryBody,
  hookWith,
  relayed,
  INBOXES_URL,
} = require('../support/intercom-page-hook-harness');

const LIST_URL = (query) => `${ORIGIN}/ember/inbox/conversations/list?${query}`;

const listStates = (ctx) => ctx.posted
  .filter(m => m && m.__isaic === true && m.kind === 'inbox-list-state');

async function relayList(query, { status = 200, body = '{}' } = {}) {
  const url = LIST_URL(query);
  const ctx = hookWith({ [url]: makeIntercomResponse(body, { url, status }) });
  ctx.sendReady();
  await ctx.window.fetch(url);
  await delay(0);
  return listStates(ctx);
}

const LIST_ROWS_URL = `${ORIGIN}/ember/inbox/conversations/list?app_id=demo1234&inbox_type=team&inbox_id=900202&state=open&fields%5B%5D=attributes`;

const listBody = (pairs, extra = {}) => JSON.stringify({
  meta: { has_more: true },
  conversations: pairs.map(([id, contactId, name, email]) => ({
    id: Number(id),
    state: 'open',
    title: 'Delivery',
    channel: 'email',
    attributes: [{ descriptor: { id: 9006910, name: 'Brand' }, value: 'uuid' }],
    user_summary: contactId === null ? null : {
      id: contactId,
      name: name || 'Customer',
      email: email === undefined ? 'customer@example.com' : email,
      user_id: 'C5355'
    }
  })),
  ...extra
});

const identityEnvelopes = envelopes => envelopes.filter(m => m.kind === 'inbox-list-identity');

const stateEnvelopes = envelopes => envelopes.filter(m => m.kind === 'conversation-state');

const CURRENT_LIST_URL = `${ORIGIN}/ember/inbox/conversations?inbox_type=team&count=80&inbox_id=9006928&state=open&fields%5Buser_summary%5D=true&app_id=demo1234`;

test('a list request relays its inbox and state from the query alone', async () => {
  const states = await relayList(
    'app_id=demo1234&inbox_type=team&inbox_id=900202&sort_field=sorting_updated_at&state=open&count=52'
  );

  assert.equal(states.length, 1);
  assert.equal(states[0].inboxType, 'team');
  assert.equal(states[0].inboxId, '900202');
  assert.equal(states[0].inboxKey, 'team:900202');
  assert.equal(states[0].state, 'open');
});

test('a closed and a snoozed filter relay their own state', async () => {
  for (const state of ['closed', 'snoozed']) {
    const states = await relayList(`inbox_type=team&inbox_id=900202&state=${state}`);
    assert.equal(states[0].state, state, state);
  }
});

test('an uppercase state is normalized', async () => {
  const states = await relayList('inbox_type=team&inbox_id=900202&state=OPEN');
  assert.equal(states[0].state, 'open');
});

test('a list request with no state relays nothing', async () => {
  assert.equal((await relayList('inbox_type=team&inbox_id=900202')).length, 0);
});

test('a malformed inbox or state relays nothing', async () => {
  const queries = [
    'inbox_type=team&inbox_id=&state=open',
    'inbox_type=&inbox_id=900202&state=open',
    'inbox_type=team&inbox_id=900202&state=open%20closed',
    'inbox_type=team&inbox_id=' + 'x'.repeat(65) + '&state=open',
    'inbox_type=TEAM&inbox_id=900202&state=open'
  ];
  for (const query of queries) {
    assert.equal((await relayList(query)).length, 0, query);
  }
});

test('the state is relayed when the request is made, not when it answers', async () => {
  for (const status of [200, 304, 500]) {
    const states = await relayList('inbox_type=team&inbox_id=900202&state=open', { status });
    assert.equal(states[0].state, 'open', `status ${status}`);
  }
});

test('the list response body is left untouched', async () => {
  const url = LIST_URL('inbox_type=team&inbox_id=900202&state=open');
  const response = makeIntercomResponse('{"conversations":[]}', { url });
  let originalReads = 0;
  response.text = async () => {
    originalReads += 1;
    if (originalReads > 1) throw new TypeError('body stream already read');
    return '{"conversations":[]}';
  };
  const ctx = hookWith({ [url]: response });
  ctx.sendReady();
  const result = await ctx.window.fetch(url);
  await delay(0);

  assert.equal(listStates(ctx).length, 1);
  assert.equal(originalReads, 0, 'the hook never reads the original body');
  assert.equal(await result.text(), '{"conversations":[]}', 'the page can still read its own body');
});

test('a view inbox relays its own key', async () => {
  const states = await relayList('inbox_type=view&inbox_id=all&state=open');
  assert.equal(states[0].inboxKey, 'view:all');
});

test('buffered list states survive the handshake and keep one per inbox', async () => {
  const first = LIST_URL('inbox_type=team&inbox_id=1&state=open');
  const second = LIST_URL('inbox_type=team&inbox_id=1&state=closed');
  const ctx = hookWith({
    [first]: makeIntercomResponse('{}', { url: first }),
    [second]: makeIntercomResponse('{}', { url: second })
  });

  await ctx.window.fetch(first);
  await ctx.window.fetch(second);
  await delay(0);
  ctx.sendReady();

  const states = listStates(ctx);
  assert.equal(states.length, 1, 'one slot per inbox, latest wins');
  assert.equal(states[0].state, 'closed');
});

test('a list payload relays one conversation-to-contact pair per row', async () => {
  const body = listBody([
    ['900202944780004', 'ffffffffffffffffffffffff'],
    ['900313855668012', '900ebe0ce50a2b5bcd53165e']
  ]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);
  const identities = identityEnvelopes(envelopes);

  assert.equal(identities.length, 1);
  assert.equal(identities[0].inboxKey, 'team:900202:open');
  assert.equal(identities[0].state, 'open',
    'the list state keeps a closed or snoozed page out of the open group');
  assert.deepEqual(Array.from(identities[0].identities, e => [e.conversationId, e.contactId]), [
    ['900202944780004', 'ffffffffffffffffffffffff'],
    ['900313855668012', '900ebe0ce50a2b5bcd53165e']
  ]);
});

test('the list identity envelope carries no name and no external id', async () => {
  const body = listBody([['900202944780004', 'ffffffffffffffffffffffff', 'Michael Mallard']]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  const serialized = JSON.stringify(identityEnvelopes(envelopes)[0]);
  assert.ok(!serialized.includes('Michael'), serialized);
  assert.ok(!serialized.includes('C5355'), serialized);
});

test('the list identity envelope carries the customer email, trimmed and lowercased', async () => {
  const body = listBody([['900202944780004', 'ffffffffffffffffffffffff', 'Customer', '  Tamsin.Holloway@Example.com ']]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.equal(identityEnvelopes(envelopes)[0].identities[0].email, 'tamsin.holloway@example.com');
});

test('an unusable email leaves the row keyed on the contact id alone', async () => {
  const body = listBody([
    ['900202944780004', 'ffffffffffffffffffffffff', 'Customer', null],
    ['900313855668012', '900ebe0ce50a2b5bcd53165e', 'Customer', 'not-an-address'],
    ['900313855668013', '900166236fad67c73a635620', 'Customer', `${'a'.repeat(250)}@example.com`]
  ]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  const identities = identityEnvelopes(envelopes)[0].identities;
  assert.equal(identities.length, 3);
  identities.forEach((entry) => {
    assert.ok(entry.contactId);
    assert.equal('email' in entry, false);
  });
});

test('two contacts sharing one email relay that email on both rows', async () => {
  const body = listBody([
    ['900202944780005', 'cccccccccccccccccccccccc', 'Tamsin Holloway', 'tamsin.holloway@example.com'],
    ['900202944780003', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'Tamsin Holloway', 'tamsin.holloway@example.com']
  ]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.deepEqual(
    Array.from(identityEnvelopes(envelopes)[0].identities, e => [e.contactId, e.email]),
    [
      ['cccccccccccccccccccccccc', 'tamsin.holloway@example.com'],
      ['bbbbbbbbbbbbbbbbbbbbbbbb', 'tamsin.holloway@example.com']
    ]
  );
});

test('the list state is still relayed alongside the identities', async () => {
  const body = listBody([['900202944780004', 'ffffffffffffffffffffffff']]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  const states = envelopes.filter(m => m.kind === 'inbox-list-state');
  assert.equal(states.length, 1);
  assert.equal(states[0].state, 'open');
});

test('a row with no user_summary is skipped rather than relayed as null', async () => {
  const body = listBody([
    ['900202944780004', null],
    ['900313855668012', '900ebe0ce50a2b5bcd53165e']
  ]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.deepEqual(
    Array.from(identityEnvelopes(envelopes)[0].identities, e => [e.conversationId, e.contactId]),
    [['900313855668012', '900ebe0ce50a2b5bcd53165e']]
  );
});

test('a null conversation entry in the list does not swallow the valid rows around it', async () => {
  const body = JSON.stringify({
    meta: { has_more: false },
    conversations: [
      {
        id: 900202944780012, state: 'open', title: 'Delivery', channel: 'email',
        user_summary: { id: 'ffffffffffffffffffffffff', name: 'Customer', email: 'customer@example.com' }
      },
      null,
      {
        id: 900202944780013, state: 'open', title: 'Delivery', channel: 'email',
        user_summary: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Customer', email: 'customer2@example.com' }
      }
    ]
  });
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.deepEqual(
    Array.from(identityEnvelopes(envelopes)[0].identities, e => e.conversationId),
    ['900202944780012', '900202944780013']
  );
});

test('a contact id that is not 24 hex characters is dropped', async () => {
  const body = listBody([['900202944780004', 'nope']]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.equal(identityEnvelopes(envelopes).length, 0);
});

test('the relayed identity array is capped at 200 rows', async () => {
  const pairs = [];
  for (let i = 0; i < 260; i += 1) {
    pairs.push([String(900457984154173 + i), i.toString(16).padStart(24, '0')]);
  }
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(listBody(pairs), { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.equal(identityEnvelopes(envelopes)[0].identities.length, 200);
});

test('a list response that is not 200 relays no identities', async () => {
  const body = listBody([['900202944780004', 'ffffffffffffffffffffffff']]);
  const ctx = hookWith({
    [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL, status: 304 })
  });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.equal(identityEnvelopes(envelopes).length, 0);
});

test('a summary response relays the conversation state so a closed one can be dropped', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  const states = stateEnvelopes(envelopes);

  assert.equal(states.length, 1);
  assert.deepEqual({ ...states[0] }, {
    __isaic: true,
    version: 1,
    kind: 'conversation-state',
    conversationId: CONVERSATION_ID,
    state: 'closed'
  });
});

test('the conversation state envelope carries nothing but the id and the state', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);

  assert.deepEqual(Object.keys(stateEnvelopes(envelopes)[0]).sort(),
    ['__isaic', 'conversationId', 'kind', 'state', 'version']);
});

test('the list endpoint without the /list suffix still relays state and identities', async () => {
  const body = listBody([
    ['900202944780006', 'eeeeeeeeeeeeeeeeeeeeeeee', 'Oskar Fenwick', 'oskar.fenwick@example.com'],
    ['900202944780007', 'eeeeeeeeeeeeeeeeeeeeeeee', 'Oskar Fenwick', 'oskar.fenwick@example.com']
  ]);
  const ctx = hookWith({ [CURRENT_LIST_URL]: makeIntercomResponse(body, { url: CURRENT_LIST_URL }) });
  const { envelopes } = await relayed(ctx, CURRENT_LIST_URL);

  const stateEnvelope = envelopes.find(e => e.kind === 'inbox-list-state');
  assert.ok(stateEnvelope, 'list state envelope posted');
  assert.equal(stateEnvelope.state, 'open');

  const identityEnvelope = envelopes.find(e => e.kind === 'inbox-list-identity');
  assert.ok(identityEnvelope, 'list identity envelope posted');
  assert.deepEqual(
    Array.from(identityEnvelope.identities, entry => entry.conversationId),
    ['900202944780006', '900202944780007']
  );
  assert.deepEqual(
    Array.from(new Set(Array.from(identityEnvelope.identities, entry => entry.contactId))),
    ['eeeeeeeeeeeeeeeeeeeeeeee']
  );
});

test('buffer overflow before the handshake evicts the oldest conversation, never an unrelated envelope', async () => {
  const ids = Array.from({ length: 22 }, (_, index) => String(900401386132987 + index));
  const summaryUrl = id => `${ORIGIN}/ember/inbox/conversations/${id}?fields%5Battributes%5D=true&app_id=demo1234`;
  const bodies = {
    [INBOXES_URL]: makeIntercomResponse(JSON.stringify({
      inboxes: [{ id: 5, inbox_type: 'team', count: { count: 7 } }]
    }), { url: INBOXES_URL })
  };
  ids.forEach(id => { bodies[summaryUrl(id)] = makeIntercomResponse(summaryBody('fr'), { url: summaryUrl(id) }); });
  const ctx = hookWith(bodies);

  await ctx.window.fetch(INBOXES_URL, { method: 'POST' });
  for (const id of ids) await ctx.window.fetch(summaryUrl(id));
  await delay(0);
  assert.equal(ctx.posted.filter(m => m && m.__isaic === true).length, 0, 'nothing is relayed before the handshake');

  ctx.sendReady();
  await delay(0);
  const envelopes = ctx.posted.filter(m => m && m.__isaic === true);
  assert.ok(envelopes.some(e => e.kind === 'inbox-counts'), 'the inbox counts survive the overflow');
  const relayedIds = new Set(envelopes.filter(e => e.conversationId !== undefined).map(e => String(e.conversationId)));
  assert.equal(relayedIds.size, 20);
  assert.equal(relayedIds.has(ids[0]), false, 'the oldest conversation is the one evicted');
  assert.equal(relayedIds.has(ids[1]), false);
  assert.equal(relayedIds.has(ids[21]), true);
});

test('the conversation cap counts every buffered conversation, not every other one', async () => {
  const ids = Array.from({ length: 22 }, (_, index) => String(900401386133087 + index));
  const streamUrl = id => `${ORIGIN}/ember/inbox/conversations/${id}/stream?app_id=demo1234`;
  const streamBodyFor = id => JSON.stringify({
    id: Number(id),
    renderable_parts: [{
      id: 1,
      conversation_id: Number(id),
      created_at: '2026-08-11T09:30:41.250Z',
      renderable_type: 14,
      renderable_data: { attribute_summary: { id: 'language', name: 'Language' }, value: 'fr' }
    }]
  });
  const bodies = {};
  ids.forEach(id => { bodies[streamUrl(id)] = makeIntercomResponse(streamBodyFor(id), { url: streamUrl(id) }); });
  const ctx = hookWith(bodies);

  for (const id of ids) await ctx.window.fetch(streamUrl(id));
  await delay(0);
  ctx.sendReady();
  await delay(0);

  const envelopes = ctx.posted.filter(m => m && m.__isaic === true);
  const relayedIds = new Set(envelopes.map(e => String(e.conversationId)));
  assert.equal(relayedIds.size, 20, 'only the 20-conversation cap survives, one buffered envelope per conversation');
  assert.equal(relayedIds.has(ids[0]), false, 'the oldest conversation is evicted');
  assert.equal(relayedIds.has(ids[21]), true);
});

test('a row with a malformed conversation id is dropped so the valid rows still pass the bridge check', async () => {
  const body = listBody([
    ['not-a-number', 'ffffffffffffffffffffffff'],
    ['900313855668012', '900ebe0ce50a2b5bcd53165e']
  ]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.deepEqual(
    Array.from(identityEnvelopes(envelopes)[0].identities, e => [e.conversationId, e.contactId]),
    [['900313855668012', '900ebe0ce50a2b5bcd53165e']]
  );
});

test('an uppercase contact id is relayed lowercased, the only form the bridge accepts', async () => {
  const body = listBody([['900313855668012', '900EBE0CE50A2B5BCD53165E']]);
  const ctx = hookWith({ [LIST_ROWS_URL]: makeIntercomResponse(body, { url: LIST_ROWS_URL }) });
  const { envelopes } = await relayed(ctx, LIST_ROWS_URL);

  assert.deepEqual(
    Array.from(identityEnvelopes(envelopes)[0].identities, e => e.contactId),
    ['900ebe0ce50a2b5bcd53165e']
  );
});
