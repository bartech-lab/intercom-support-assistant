'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, hookWith } = require('../support/intercom-page-hook-harness');
const { WORKSPACE, CONTACT, CONVERSATION_URL } = require('../support/temporary-notes-harness');

const listUrl = inboxId =>
  `${ORIGIN}/ember/inbox/conversations/list?app_id=demo1234&inbox_type=team&inbox_id=${inboxId}&state=open&fields%5B%5D=attributes`;

const listBody = contactId => JSON.stringify({
  meta: { has_more: true },
  conversations: [{
    id: 900202944780004,
    state: 'open',
    title: 'Delivery',
    channel: 'email',
    attributes: [{ descriptor: { id: 9006910, name: 'Brand' }, value: 'uuid' }],
    user_summary: { id: contactId, name: 'Customer', email: 'customer@example.com', user_id: 'C5355' }
  }]
});

const userUrl = userId => `${ORIGIN}/ember/users/${userId}?app_id=demo1234`;
const userBody = userId => JSON.stringify({
  users: [{ id: userId, language_override: null, browser_locale: 'de', geoip_data: { country_code2: 'DE' }, custom_data: { profile_country: 'DE' } }]
});

const envelopes = ctx => ctx.posted.filter(m => m && m.__isaic === true);
const ofKind = (ctx, kind) => envelopes(ctx).filter(m => m.kind === kind);

function dispatch(ctx, data, source) {
  ctx.window.dispatchEvent(new ctx.window.MessageEvent('message', { data, source, origin: ORIGIN }));
}

async function fetchAll(ctx, urls) {
  for (const url of urls) {
    await ctx.window.fetch(url);
    await delay(0);
  }
}

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function listHook() {
  const urls = [listUrl(1111), listUrl(2222)];
  const ctx = hookWith({
    [urls[0]]: makeIntercomResponse(listBody(A), { url: urls[0] }),
    [urls[1]]: makeIntercomResponse(listBody(B), { url: urls[1] })
  });
  return { ctx, urls };
}

test('nothing is posted before ready and the flush posts only envelope objects', async () => {
  const { ctx, urls } = listHook();
  await fetchAll(ctx, urls);
  assert.equal(ctx.posted.length, 0);
  ctx.sendReady();
  await delay(0);
  assert.ok(ctx.posted.length > 0);
  for (const message of ctx.posted) {
    assert.equal(typeof message, 'object');
    assert.notEqual(message, null);
    assert.equal(message.__isaic, true);
  }
  assert.equal(ctx.posted.length, envelopes(ctx).length);
  assert.equal(ofKind(ctx, 'inbox-list-state').length, 2);
  assert.equal(ofKind(ctx, 'inbox-list-identity').length, 2);
  assert.equal(ctx.posted.length, 4);
});

test('list-state envelopes for two inboxes are both flushed', async () => {
  const { ctx, urls } = listHook();
  await fetchAll(ctx, urls);
  ctx.sendReady();
  await delay(0);
  const keys = ofKind(ctx, 'inbox-list-state').map(m => m.inboxKey).sort();
  assert.deepEqual(keys, ['team:1111', 'team:2222']);
});

test('list-identity envelopes for two inboxes are both flushed', async () => {
  const { ctx, urls } = listHook();
  await fetchAll(ctx, urls);
  ctx.sendReady();
  await delay(0);
  const ids = ofKind(ctx, 'inbox-list-identity');
  assert.equal(ids.length, 2);
  const contacts = ids.map(m => m.identities[0].contactId).sort();
  assert.deepEqual(contacts, [A, B]);
});

test('a newer list-state for the same inbox replaces the older one', async () => {
  const url1 = listUrl(1111);
  const url2 = `${url1}&x=1`.replace('state=open', 'state=closed');
  const ctx = hookWith({});
  await fetchAll(ctx, [url1, url2]);
  ctx.sendReady();
  await delay(0);
  const states = ofKind(ctx, 'inbox-list-state');
  assert.equal(states.length, 1);
  assert.equal(states[0].state, 'closed');
});

test('contact-language envelopes for two users are both flushed', async () => {
  const U1 = '900fcbb36062854afdf312d1';
  const U2 = '9005f0ce525b25cadc756ccc';
  const ctx = hookWith({
    [userUrl(U1)]: makeIntercomResponse(userBody(U1), { url: userUrl(U1) }),
    [userUrl(U2)]: makeIntercomResponse(userBody(U2), { url: userUrl(U2) })
  });
  await fetchAll(ctx, [userUrl(U1), userUrl(U2)]);
  assert.equal(ctx.posted.length, 0);
  ctx.sendReady();
  await delay(0);
  const flushed = ofKind(ctx, 'contact-language');
  assert.deepEqual(flushed.map(m => m.userId).sort(), [U1, U2].sort());
  assert.equal(ctx.posted.length, flushed.length);
});

async function bufferedHook() {
  const { ctx, urls } = listHook();
  await fetchAll(ctx, urls);
  return ctx;
}

test('a ready message from another source does not flush', async () => {
  const ctx = await bufferedHook();
  const frame = ctx.window.document.createElement('iframe');
  ctx.window.document.body.appendChild(frame);
  dispatch(ctx, { __isaic_ready: true }, null);
  dispatch(ctx, { __isaic_ready: true }, frame.contentWindow);
  await delay(0);
  assert.equal(ctx.posted.length, 0);
  ctx.sendReady();
  await delay(0);
  assert.equal(ofKind(ctx, 'inbox-list-state').length, 2);
});

test('a same-source message without the exact ready marker does not flush', async () => {
  const ctx = await bufferedHook();
  for (const data of [{ __isaic_ready: 'true' }, { __isaic_ready: 1 }, { foo: 1 }]) {
    dispatch(ctx, data, ctx.window);
    await delay(0);
    assert.equal(ctx.posted.length, 0, JSON.stringify(data));
  }
  ctx.sendReady();
  await delay(0);
  assert.equal(ofKind(ctx, 'inbox-list-state').length, 2);
});

const TOKEN = 'hs-token-0001';
const arm = expiresAt => ({
  __isaTempNote: true,
  kind: 'arm',
  workspace: WORKSPACE,
  contact: CONTACT,
  draft: 'note',
  lifetime: { mode: 'absolute', expiresAt },
  token: TOKEN,
  revision: 1
});

async function armReply(expiresAt) {
  const ctx = loadIntercomPageHook({
    url: CONVERSATION_URL,
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}'))
  });
  ctx.sendReady();
  const before = ctx.posted.length;
  dispatch(ctx, arm(expiresAt), ctx.window);
  await delay(0);
  const replies = ctx.posted.slice(before).filter(m => m && m.kind === 'temporary-note-armed');
  assert.equal(replies.length, 1);
  return replies[0];
}

test('an absolute lifetime accepts a 4-digit-year timestamp and rejects an extended-year one', async () => {
  const ok = await armReply('2027-01-01T00:00:00.000Z');
  assert.equal(ok.status, 'armed');

  const extended = '+010000-01-01T00:00:00.000Z';
  assert.equal(new Date(Date.parse(extended)).toISOString(), extended);
  const bad = await armReply(extended);
  assert.equal(bad.status, 'blocked');
  assert.equal(bad.reason, 'invalid-arm');
  assert.equal(bad.token, TOKEN);
  assert.equal(bad.revision, 1);
});
