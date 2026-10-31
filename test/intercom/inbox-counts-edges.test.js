'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeIntercomResponse } = require('../support/helpers');
const { hookWith, relayed, INBOXES_URL } = require('../support/intercom-page-hook-harness');

async function countsFor(inboxes) {
  const ctx = hookWith({
    [INBOXES_URL]: makeIntercomResponse(JSON.stringify({ inboxes }), { url: INBOXES_URL })
  });
  const { envelopes } = await relayed(ctx, INBOXES_URL, { method: 'POST' });
  const envelope = envelopes.find(e => e.kind === 'inbox-counts');
  return { envelope, entries: envelope ? Array.from(envelope.counts) : [] };
}

const valid = (id, count = 1) => ({ id, inbox_type: 'team', count });

test('I1: a count of 1000000 is relayed and 9001983 is not', async () => {
  const { entries } = await countsFor([
    { id: 'max', inbox_type: 'team', count: 1000000 },
    { id: 'over', inbox_type: 'team', count: 9001983 },
    { id: 'nested-max', inbox_type: 'team', count: { count: 1000000 } },
    { id: 'nested-over', inbox_type: 'team', count: { count: 9001983 } },
    valid('sibling', 3)
  ]);
  assert.deepEqual(entries.map(e => e.inboxId), ['max', 'nested-max', 'sibling']);
  assert.equal(entries[0].count, 1000000);
  assert.equal(entries[1].count, 1000000);
});

test('I2: 51 valid inboxes relay exactly the first 50 in payload order', async () => {
  const inboxes = Array.from({ length: 51 }, (_, i) => valid(`inbox-${i}`, i));
  const { entries } = await countsFor(inboxes);
  assert.equal(entries.length, 50);
  assert.deepEqual(entries.map(e => e.inboxId), inboxes.slice(0, 50).map(i => i.id));
  assert.deepEqual(entries.map(e => e.count), Array.from({ length: 50 }, (_, i) => i));
});

test('I3: a null entry before a valid inbox is skipped and the valid inbox is relayed', async () => {
  const { entries } = await countsFor([null, valid('after-null', 4)]);
  assert.deepEqual(entries.map(e => e.inboxId), ['after-null']);
  assert.equal(entries[0].count, 4);
});

test('I4: a null count before a valid inbox is not relayed and the valid inbox is', async () => {
  const { entries } = await countsFor([
    { id: 'null-count', inbox_type: 'team', count: null },
    valid('good', 9)
  ]);
  assert.deepEqual(entries.map(e => e.inboxId), ['good']);
  assert.equal(entries[0].count, 9);
});

test('I5: an invalid id or a missing id is not relayed while a sibling is', async () => {
  const { entries } = await countsFor([
    { id: 'a b', inbox_type: 'team', count: 1 },
    { inbox_type: 'team', count: 2 },
    valid('sibling', 5)
  ]);
  assert.deepEqual(entries.map(e => e.inboxId), ['sibling']);
  assert.ok(!entries.some(e => e.inboxId === 'undefined' || e.inboxId === ''));
});

test('I6: a payload where every inbox is invalid posts no inbox-counts envelope', async () => {
  const { envelope } = await countsFor([
    { id: 'a b', inbox_type: 'team', count: 1 },
    { inbox_type: 'team', count: 2 },
    { id: 'x', inbox_type: 'BAD', count: 3 },
    { id: 'y', inbox_type: 'team', count: -1 },
    null
  ]);
  assert.equal(envelope, undefined);
});
