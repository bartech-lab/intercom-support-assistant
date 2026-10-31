'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { makeIntercomResponse } = require('../support/helpers');
const { CONVERSATION_ID, ORIGIN, SUMMARY_URL, STREAM_URL, summaryBody, hookWith } = require('../support/intercom-page-hook-harness');
const { WORKSPACE, CONTACT, CONVERSATION_URL } = require('../support/temporary-notes-harness');

const streamBody = language => JSON.stringify({
  id: Number(CONVERSATION_ID),
  renderable_parts: [{
    id: 90063761859,
    conversation_id: Number(CONVERSATION_ID),
    created_at: '2026-08-11T09:30:41.250Z',
    renderable_type: 14,
    renderable_data: { attribute_summary: { id: 'language', name: 'Language' }, value: language }
  }]
});

test('summary and stream language for one conversation are both kept until ready', async () => {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(summaryBody('fr'), { url: SUMMARY_URL }),
    [STREAM_URL]: makeIntercomResponse(streamBody('German'), { url: STREAM_URL })
  });
  await ctx.window.fetch(SUMMARY_URL);
  await ctx.window.fetch(STREAM_URL);
  await delay(0);
  assert.equal(ctx.posted.length, 0, 'precondition: nothing is posted before ready');
  ctx.sendReady();
  await delay(0);
  const languages = ctx.posted
    .filter(m => m && m.__isaic === true && m.kind === 'conversation-language')
    .map(m => `${m.source}:${m.language}`)
    .sort();
  assert.deepEqual(languages, ['stream:German', 'summary:fr']);
});

test('a relative lifetime with a fractional delayMs is blocked', async () => {
  const ctx = hookWith({}, { url: CONVERSATION_URL });
  ctx.sendReady();
  await delay(0);
  const before = ctx.posted.length;
  ctx.window.dispatchEvent(new ctx.window.MessageEvent('message', {
    source: ctx.window,
    origin: ORIGIN,
    data: {
      __isaTempNote: true, kind: 'arm', workspace: WORKSPACE, contact: CONTACT, draft: 'note',
      lifetime: { mode: 'relative', delayMs: 86400000.5 }, token: 'arm-test-0001', revision: 1
    }
  }));
  await delay(0);
  const replies = ctx.posted.slice(before).filter(m => m && m.kind === 'temporary-note-armed');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].status, 'blocked');
  assert.equal(replies[0].reason, 'invalid-arm');
});
