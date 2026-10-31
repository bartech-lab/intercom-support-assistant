'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse, loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const {
  CONVERSATION_ID,
  ORIGIN,
  SUMMARY_URL,
  STREAM_URL,
  summaryBody,
  hookWith,
  relayed,
} = require('../support/intercom-page-hook-harness');

const streamPart = ({ id, value, name = 'Language', attributeId = 'language', createdAt }) => ({
  id,
  conversation_id: Number(CONVERSATION_ID),
  created_at: createdAt || '2026-08-11T09:30:41.250Z',
  renderable_type: 14,
  renderable_data: {
    attribute_summary: { id: attributeId, name },
    value
  }
});

const streamBody = (parts, conversationId = Number(CONVERSATION_ID)) => JSON.stringify({
  id: conversationId,
  renderable_parts: [
    { id: 1, renderable_type: 2, renderable_data: { body: 'Bonjour' } },
    ...parts
  ]
});

const bridgeEnvelope = (over = {}) => ({
  __isaic: true,
  version: 1,
  kind: 'conversation-language',
  conversationId: '456',
  language: 'fr',
  source: 'summary',
  ...over
});

function isolated({ url = 'https://app.intercom.com/a/inbox/team/123/conversation/456' } = {}) {
  return loadExtension(fx.inboxHtml({}), { url });
}

function deliver(win, data, { source = win, origin = 'https://app.intercom.com' } = {}) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source, origin }));
}

const languageEnvelopes = envelopes => envelopes.filter(m => m.kind === 'conversation-language');

test('a summary response relays its locale code for the conversation in the path', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody('fr'), { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(languageEnvelopes(envelopes).length, 1);
  assert.deepEqual({ ...languageEnvelopes(envelopes)[0] }, {
    __isaic: true,
    version: 1,
    kind: 'conversation-language',
    conversationId: CONVERSATION_ID,
    language: 'fr',
    source: 'summary'
  });
});

test('a stream response relays the display-name value', async () => {
  const body = streamBody([streamPart({ id: 90063761859, value: 'French' })]);
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].language, 'French');
  assert.equal(envelopes[0].source, 'stream');
});

test('several stream language events resolve to the newest by part id', async () => {
  const body = streamBody([
    streamPart({ id: 10, value: 'German', createdAt: '2026-08-12T10:00:00.000Z' }),
    streamPart({ id: 99, value: 'French', createdAt: '2026-08-01T12:55:06.605Z' }),
    streamPart({ id: 50, value: 'Italian', createdAt: '2026-08-04T10:00:00.000Z' })
  ]);
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].language, 'French', 'the highest part id wins even though its timestamp is the oldest');
});

test('a Brand attribute event in the stream relays the conversation brand', async () => {
  const body = streamBody([
    streamPart({ id: 1, value: 'alderpoint', name: 'Brand', attributeId: '9006910' })
  ]);
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  assert.equal(envelopes.length, 1);
  assert.deepEqual({ ...envelopes[0] }, {
    __isaic: true,
    version: 1,
    kind: 'conversation-company',
    conversationId: CONVERSATION_ID,
    company: 'alderpoint',
    source: 'stream'
  });
});

test('an unrelated attribute event in the stream is ignored', async () => {
  const body = streamBody([
    streamPart({ id: 1, value: 'Billing question', name: 'Topics', attributeId: '9006335' })
  ]);
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  assert.equal(envelopes.length, 0);
});

test('a summary relays the Brand option label and never the raw option id', async () => {
  const withOptions = JSON.stringify({
    state: 'open',
    attributes: [
      {
        descriptor: {
          id: 9006910,
          name: 'Brand',
          options: [
            { id: '9000b0a1-4c2e-4d7a-9e11-5a3f0c7d2b10', label: 'Fernhill' },
            { id: '9000c0a2-4c2e-4d7a-9e11-5a3f0c7d2b11', label: 'Quayside Fashion' }
          ]
        },
        value: '9000b0a1-4c2e-4d7a-9e11-5a3f0c7d2b10'
      }
    ]
  });
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(withOptions, { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  const brandEnvelopes = envelopes.filter(envelope => envelope.kind === 'conversation-company');
  assert.equal(brandEnvelopes.length, 1);
  assert.equal(brandEnvelopes[0].company, 'Fernhill');
  assert.equal(brandEnvelopes[0].source, 'summary');
});

test('a summary Brand value left as an unresolved option id is not relayed', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody('fr'), { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.filter(envelope => envelope.kind === 'conversation-company').length, 0);
});

test('a malformed attribute entry does not swallow brand and language parsing for the rest of the summary', async () => {
  const body = JSON.stringify({
    state: 'open',
    attributes: [
      { descriptor: null, value: 'irrelevant' },
      { descriptor: { id: 9006910, name: 'Brand' }, value: 'alderpoint' },
      { descriptor: { id: 'language', name: 'Language' }, value: 'fr' }
    ]
  });
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(body, { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(languageEnvelopes(envelopes)[0].language, 'fr');
  const brand = envelopes.find(envelope => envelope.kind === 'conversation-company');
  assert.ok(brand, 'the brand attribute after the malformed entry still relays');
  assert.equal(brand.company, 'alderpoint');
});

test('a stream whose root id disagrees with the request path is ignored', async () => {
  const body = streamBody([streamPart({ id: 1, value: 'French' })], 900999);
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);
  assert.equal(envelopes.length, 0);
});

test('an unreadable 304 is a safe miss that changes nothing', async () => {
  const response = makeIntercomResponse('', { status: 304, url: SUMMARY_URL });
  const ctx = hookWith({ [SUMMARY_URL]: response });
  const { result, envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.length, 0);
  assert.equal(result, response, 'the page still receives its own response object');
});

test('a clone that throws never breaks the page response', async () => {
  const response = makeIntercomResponse(summaryBody(), { url: SUMMARY_URL, cloneThrows: true });
  const ctx = hookWith({ [SUMMARY_URL]: response });
  const { result, envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.length, 0);
  assert.equal(await result.text(), summaryBody(), 'the original body stays readable');
});

test('observation leaves the original response body readable', async () => {
  const response = makeIntercomResponse(summaryBody(), { url: SUMMARY_URL });
  let originalReads = 0;
  response.text = async () => {
    originalReads += 1;
    if (originalReads > 1) throw new TypeError('body stream already read');
    return summaryBody();
  };
  const ctx = hookWith({ [SUMMARY_URL]: response });
  const { result, envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(languageEnvelopes(envelopes).length, 1);
  assert.equal(originalReads, 0, 'the hook observed the clone, not the original');
  assert.equal(await result.text(), summaryBody());
});

test('a fetch rejection stays the page rejection', async () => {
  const boom = new Error('offline');
  const ctx = hookWith({ [SUMMARY_URL]: boom });
  ctx.sendReady();
  await assert.rejects(() => ctx.window.fetch(SUMMARY_URL), /offline/);
});

test('fetch arguments and this-binding are passed through untouched', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL }) });
  ctx.sendReady();
  const init = { method: 'GET', headers: { accept: 'application/json' } };
  await ctx.window.fetch(SUMMARY_URL, init);
  assert.equal(ctx.calls[0].url, SUMMARY_URL);
  assert.equal(ctx.calls[0].init, init, 'init is forwarded by reference, not copied');
  assert.equal(ctx.calls[0].thisArg, ctx.window);
});

test('a Request-like input is resolved the same way as a string url', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL }) });
  ctx.sendReady();
  await ctx.window.fetch({ url: SUMMARY_URL, method: 'GET' });
  await delay(0);
  assert.equal(languageEnvelopes(ctx.posted.filter(m => m && m.__isaic)).length, 1);
});

test('a non-GET request to a conversation path is ignored', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL, { method: 'POST' });
  assert.equal(envelopes.length, 0);
});

test('unrelated Intercom endpoints are never inspected', async () => {
  const other = `${ORIGIN}/ember/inbox/conversations/list?inbox_id=900201`;
  const ctx = hookWith({ [other]: makeIntercomResponse(summaryBody(), { url: other }) });
  const { envelopes } = await relayed(ctx, other);
  assert.equal(envelopes.length, 0);
});

test('a same-origin request that resolves to another origin is ignored', async () => {
  const evil = 'https://evil.example.com/ember/inbox/conversations/900401386132981';
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: evil }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.length, 0);
});

test('a redirect to a different conversation id is ignored', async () => {
  const otherId = `${ORIGIN}/ember/inbox/conversations/900231923`;
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: otherId }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.length, 0);
});

test('a non-JSON content type is ignored', async () => {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL, contentType: 'text/html' })
  });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.length, 0);
});

test('an oversized declared payload is ignored', async () => {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL, contentLength: '90067313' })
  });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.length, 0);
});

test('malformed JSON is ignored without throwing', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse('{not json', { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(envelopes.length, 0);
});

test('a language value outside the allowed token shape is not relayed', async () => {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(summaryBody('<script>alert(1)</script>'), { url: SUMMARY_URL })
  });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.equal(languageEnvelopes(envelopes).length, 0);
});

for (const [label, value] of [['null', null], ['empty', ''], ['blank', '   ']]) {
  test(`a ${label} language value is not relayed`, async () => {
    const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(value), { url: SUMMARY_URL }) });
    const { envelopes } = await relayed(ctx, SUMMARY_URL);
    assert.equal(languageEnvelopes(envelopes).length, 0);
  });
}

test('the envelope carries no message bodies or unrelated attributes', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  assert.deepEqual(Object.keys(languageEnvelopes(envelopes)[0]).sort(),
    ['__isaic', 'conversationId', 'kind', 'language', 'source', 'version']);
});

test('nothing is posted before the ready handshake, then boot records replay once', async () => {
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(summaryBody(), { url: SUMMARY_URL }) });
  await ctx.window.fetch(SUMMARY_URL);
  await delay(0);
  assert.equal(ctx.posted.filter(m => m && m.__isaic).length, 0, 'no isolated listener exists yet');

  ctx.sendReady();
  await delay(0);
  const envelopes = languageEnvelopes(ctx.posted.filter(m => m && m.__isaic));
  assert.equal(envelopes.length, 1, 'the buffered record replays exactly once');
  assert.equal(envelopes[0].language, 'fr');

  ctx.sendReady();
  await delay(0);
  assert.equal(languageEnvelopes(ctx.posted.filter(m => m && m.__isaic)).length, 1,
    'a second handshake replays nothing');
});

test('the boot buffer keeps only the latest record per conversation and source', async () => {
  const bodies = { [SUMMARY_URL]: makeIntercomResponse(summaryBody('de'), { url: SUMMARY_URL }) };
  const ctx = hookWith(bodies);
  await ctx.window.fetch(SUMMARY_URL);
  await delay(0);
  bodies[SUMMARY_URL] = makeIntercomResponse(summaryBody('fr'), { url: SUMMARY_URL });
  await ctx.window.fetch(SUMMARY_URL);
  await delay(0);
  ctx.sendReady();
  await delay(0);
  const envelopes = languageEnvelopes(ctx.posted.filter(m => m && m.__isaic));
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].language, 'fr');
});

test('a valid bridge envelope becomes the first language source', () => {
  const win = isolated();
  deliver(win, bridgeEnvelope({ language: 'fr' }));
  assert.equal(win.detectCustomerLanguage(), 'french');
});

test('locale codes for every supported language map to a signature language', () => {
  const win = isolated();
  const expected = {
    en: 'english', de: 'german', fr: 'french', it: 'italian',
    pt: 'portuguese', es: 'spanish', nl: 'dutch'
  };
  Object.entries(expected).forEach(([code, language]) => {
    assert.equal(win.signatureLanguageFromAttribute(code), language, code);
  });
  assert.equal(win.signatureLanguageFromAttribute('pt-BR'), 'portuguese');
  assert.equal(win.signatureLanguageFromAttribute('fr_CA'), 'french');
});

test('full names and unsupported languages keep their existing behaviour', () => {
  const win = isolated();
  assert.equal(win.signatureLanguageFromAttribute('French'), 'french');
  assert.equal(win.signatureLanguageFromAttribute('Deutsch'), 'german');
  assert.equal(win.signatureLanguageFromAttribute('Swedish'), 'english');
  assert.equal(win.signatureLanguageFromAttribute('Klingon'), null);
});

test('agreeing summary and stream observations resolve to that language', () => {
  const win = isolated();
  deliver(win, bridgeEnvelope({ language: 'fr', source: 'summary' }));
  deliver(win, bridgeEnvelope({ language: 'French', source: 'stream' }));
  assert.equal(win.detectCustomerLanguage(), 'french');
});

test('conflicting summary and stream observations fall back instead of guessing', () => {
  const win = isolated();
  deliver(win, bridgeEnvelope({ language: 'fr', source: 'summary' }));
  deliver(win, bridgeEnvelope({ language: 'German', source: 'stream' }));
  assert.equal(win.detectCustomerLanguage(), 'english', 'no DOM evidence remains, so English');
});

test('arrival order does not change the resolved language', () => {
  const first = isolated();
  deliver(first, bridgeEnvelope({ language: 'fr', source: 'summary' }));
  deliver(first, bridgeEnvelope({ language: 'French', source: 'stream' }));

  const second = isolated();
  deliver(second, bridgeEnvelope({ language: 'French', source: 'stream' }));
  deliver(second, bridgeEnvelope({ language: 'fr', source: 'summary' }));

  assert.equal(first.detectCustomerLanguage(), second.detectCustomerLanguage());

  const conflictA = isolated();
  deliver(conflictA, bridgeEnvelope({ language: 'fr', source: 'summary' }));
  deliver(conflictA, bridgeEnvelope({ language: 'German', source: 'stream' }));

  const conflictB = isolated();
  deliver(conflictB, bridgeEnvelope({ language: 'German', source: 'stream' }));
  deliver(conflictB, bridgeEnvelope({ language: 'fr', source: 'summary' }));

  assert.equal(conflictA.detectCustomerLanguage(), 'english', 'summary then stream');
  assert.equal(conflictB.detectCustomerLanguage(), 'english', 'stream then summary');
});

test('a record for another conversation never affects the visible one', () => {
  const win = isolated();
  deliver(win, bridgeEnvelope({ conversationId: '999', language: 'de' }));
  assert.equal(win.detectCustomerLanguage(), 'english');
});

test('a foreign source, origin, marker, version, kind or schema is rejected', () => {
  const cases = [
    ['foreign source', bridgeEnvelope(), { source: {} }],
    ['foreign origin', bridgeEnvelope(), { origin: 'https://evil.example.com' }],
    ['wrong marker', { ...bridgeEnvelope(), __isaic: false }, {}],
    ['wrong version', bridgeEnvelope({ version: 2 }), {}],
    ['wrong kind', bridgeEnvelope({ kind: 'something-else' }), {}],
    ['unknown source value', bridgeEnvelope({ source: 'guess' }), {}],
    ['non-numeric conversation id', bridgeEnvelope({ conversationId: 'abc' }), {}],
    ['oversized language', bridgeEnvelope({ language: 'french' + 'x'.repeat(60) }), {}],
    ['language with control characters', bridgeEnvelope({ language: 'french\u0007' }), {}]
  ];
  cases.forEach(([label, data, options]) => {
    const win = isolated();
    deliver(win, data, options);
    assert.equal(win.detectCustomerLanguage(), 'english', label);
    assert.equal(win.eval('networkLanguageByConversation.size'), 0, `${label} stores nothing`);
  });
});

test('a malformed message does not erase an existing valid observation', () => {
  const win = isolated();
  deliver(win, bridgeEnvelope({ language: 'fr' }));
  deliver(win, { __isaic: true, version: 1, kind: 'conversation-language' });
  deliver(win, bridgeEnvelope({ language: '' }));
  assert.equal(win.detectCustomerLanguage(), 'french');
});

test('a late network observation invalidates a cached English detection', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ conversationAttrs: [fx.conversationAttrRow('9001', 'Language', 'English')] })
  }), { url: 'https://app.intercom.com/a/inbox/team/123/conversation/456' });
  assert.equal(win.activeSignatureLanguage(), 'english');
  const cached = win.eval('cachedLanguageDetection');
  assert.equal(cached.conversationId, '456');
  assert.equal(cached.provisional, false, 'the English answer is cached as evidence-backed');

  deliver(win, bridgeEnvelope({ language: 'fr' }));
  assert.equal(win.activeSignatureLanguage(), 'french', 'the cached English answer is dropped');
});
