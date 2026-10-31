'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeIntercomResponse } = require('../support/helpers');
const { CONVERSATION_ID, STREAM_URL, hookWith, relayed } = require('../support/intercom-page-hook-harness');

const part = (id, name, value) => ({
  id,
  conversation_id: Number(CONVERSATION_ID),
  created_at: '2026-08-11T09:30:41.250Z',
  renderable_type: 14,
  renderable_data: { attribute_summary: { id: name.toLowerCase(), name }, value }
});

const stream = async (parts) => {
  const body = JSON.stringify({
    id: Number(CONVERSATION_ID),
    renderable_parts: [{ id: 1, renderable_type: 2, renderable_data: { body: 'Hello' } }, ...parts]
  });
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  return envelopes;
};

const reported = (envelopes, kind, field) => envelopes.filter((m) => m.kind === kind).map((m) => m[field]);

const INVALID = [
  ['empty', ''],
  ['whitespace', '   '],
  ['too long', 'x'.repeat(200)],
  ['forbidden characters', '<script>alert(1)</script>']
];

for (const [label, kind, field, name, older, newer] of [
  ['language', 'conversation-language', 'language', 'Language', 'French', 'German'],
  ['brand', 'conversation-company', 'company', 'Brand', 'Fernhill', 'Brightwell']
]) {
  test(`${label}: a newer invalid part does not replace or erase the older valid value`, async () => {
    for (const [why, bad] of INVALID) {
      const envelopes = await stream([part(90063761859, name, older), part(90075599852, name, bad)]);
      assert.deepEqual(reported(envelopes, kind, field), [older], why);
    }
  });

  test(`${label}: the invalid newer part is ignored whatever the array order`, async () => {
    const envelopes = await stream([part(90075599852, name, ''), part(90063761859, name, older)]);
    assert.deepEqual(reported(envelopes, kind, field), [older]);
  });

  test(`${label}: control, a newer valid part wins over an older valid part`, async () => {
    const envelopes = await stream([part(90063761859, name, older), part(90075599852, name, newer)]);
    assert.deepEqual(reported(envelopes, kind, field), [newer]);
  });

  test(`${label}: control, newest is chosen by numeric id and not array order`, async () => {
    const envelopes = await stream([part(90075599852, name, newer), part(90063761859, name, older)]);
    assert.deepEqual(reported(envelopes, kind, field), [newer]);
  });
}
