'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse } = require('../support/helpers');

const CONVERSATION_ID = '900409686268320';
const ORIGIN = 'https://app.intercom.com';
const STREAM_URL = `${ORIGIN}/ember/inbox/conversations/${CONVERSATION_ID}/stream?app_id=demo1234`;
const CUSTOMER = 'customer.sample@example.com';

const customerEmailPart = ({ id, to, from = CUSTOMER, cc = null, createdAt = '2026-08-12T09:14:03.000Z' }) => ({
  id,
  ...(createdAt ? { created_at: createdAt } : {}),
  renderable_type: 12,
  renderable_data: {
    email_from_address: from,
    channel: 3,
    email_metadata: {
      sender_type: 'participant',
      external_sender: false,
      header_addresses: {
        from: [{ name: 'Sam Sample', email: from }],
        to: [].concat(to).map(email => (email === null ? null : { name: 'Manager', email })),
        ...(cc ? { cc: [].concat(cc).map(email => (email === null ? null : { name: 'Legal', email })) } : {})
      }
    }
  }
});

const streamBody = (parts, { userSummary = { email: CUSTOMER }, omitSummary = false } = {}) =>
  JSON.stringify({
    id: Number(CONVERSATION_ID),
    ...(omitSummary ? {} : { user_summary: userSummary }),
    renderable_parts: parts
  });

async function relay(body) {
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse(body, { url: STREAM_URL }))
  });
  ctx.sendReady();
  await ctx.window.fetch(STREAM_URL);
  await delay(0);
  return ctx.posted.filter(m => m && m.__isaic === true);
}

const ofKind = (envelopes, kind) => envelopes.filter(m => m.kind === kind);

async function relayAddresses(body) {
  return ofKind(await relay(body), 'conversation-inbound-address');
}

const addressesOf = envelope => Array.from(envelope.addresses);

const addressOfLength = length => {
  const domain = '@example.com';
  return `${'a'.repeat(length - domain.length)}${domain}`;
};

test('E1: a missing user_summary still relays the customer email part addresses', async () => {
  const envelopes = await relayAddresses(streamBody(
    [customerEmailPart({ id: 1, to: 'support@brightwell.example' })],
    { omitSummary: true }
  ));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), ['support@brightwell.example']);
});

test('E2: a redacted user_summary posts no identity but still relays addresses', async () => {
  const all = await relay(streamBody(
    [customerEmailPart({ id: 1, to: 'support@brightwell.example' })],
    { userSummary: { email: CUSTOMER, is_redacted: true } }
  ));
  assert.equal(ofKind(all, 'conversation-identity').length, 0);
  const addresses = ofKind(all, 'conversation-inbound-address');
  assert.equal(addresses.length, 1);
  assert.deepEqual(addressesOf(addresses[0]), ['support@brightwell.example']);
});

test('E2 control: an unredacted user_summary posts the identity envelope', async () => {
  const all = await relay(streamBody(
    [customerEmailPart({ id: 1, to: 'support@brightwell.example' })],
    { userSummary: { email: CUSTOMER, is_redacted: false } }
  ));
  assert.equal(ofKind(all, 'conversation-identity').length, 1);
  assert.equal(ofKind(all, 'conversation-inbound-address').length, 1);
});

test('E3: an address of exactly 254 characters is relayed', async () => {
  const address = addressOfLength(254);
  assert.equal(address.length, 254);
  const envelopes = await relayAddresses(streamBody([customerEmailPart({ id: 1, to: address })]));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), [address]);
});

test('E3: an address of 255 characters is not relayed', async () => {
  const address = addressOfLength(255);
  assert.equal(address.length, 255);
  const envelopes = await relayAddresses(streamBody([customerEmailPart({ id: 1, to: address })]));
  assert.equal(envelopes.length, 0);
});

test('E4: a null renderable part is skipped and the later valid part wins', async () => {
  const envelopes = await relayAddresses(streamBody([
    null,
    customerEmailPart({ id: 5, to: 'support@brightwell.example' })
  ]));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), ['support@brightwell.example']);
});

test('E4: a part of another renderable_type with an earlier id is skipped', async () => {
  const otherType = customerEmailPart({ id: 1, to: 'other@brightwell.example' });
  otherType.renderable_type = 2;
  const envelopes = await relayAddresses(streamBody([
    otherType,
    customerEmailPart({ id: 5, to: 'support@brightwell.example' })
  ]));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), ['support@brightwell.example']);
});

test('E4: a customer email part without email_metadata is skipped', async () => {
  const noMetadata = {
    id: 1,
    created_at: '2026-08-12T09:00:00.000Z',
    renderable_type: 12,
    renderable_data: { email_from_address: CUSTOMER, channel: 3 }
  };
  const envelopes = await relayAddresses(streamBody([
    noMetadata,
    customerEmailPart({ id: 5, to: 'support@brightwell.example' })
  ]));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), ['support@brightwell.example']);
});

test('E5: a customer email part with an undeterminable order makes the stream relay nothing', async () => {
  const envelopes = await relayAddresses(streamBody([
    customerEmailPart({ id: 'abc', to: 'help@brightwell.example', createdAt: null }),
    customerEmailPart({ id: 5, to: 'support@brightwell.example' })
  ]));
  assert.equal(envelopes.length, 0);
});

test('E6: two customer email parts with the same id resolve to the earlier array entry', async () => {
  const envelopes = await relayAddresses(streamBody([
    customerEmailPart({ id: 7, to: 'first@brightwell.example' }),
    customerEmailPart({ id: 7, to: 'second@brightwell.example' })
  ]));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), ['first@brightwell.example']);
});

test('E7: a null entry in the to list is skipped and the valid address is relayed', async () => {
  const envelopes = await relayAddresses(streamBody([
    customerEmailPart({ id: 1, to: [null, 'support@brightwell.example'] })
  ]));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), ['support@brightwell.example']);
});

test('E7: a null entry in the cc list is skipped and the valid address is relayed', async () => {
  const envelopes = await relayAddresses(streamBody([
    customerEmailPart({ id: 1, to: [], cc: [null, 'support@brightwell.example'] })
  ]));
  assert.equal(envelopes.length, 1);
  assert.deepEqual(addressesOf(envelopes[0]), ['support@brightwell.example']);
});
