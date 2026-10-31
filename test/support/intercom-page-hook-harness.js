'use strict';

const test = require('node:test');

const { setTimeout: delay } = require('node:timers/promises');

const { loadIntercomPageHook, makeIntercomResponse, loadExtension } = require('./helpers');

const CONVERSATION_ID = '900401386132981';

const ORIGIN = 'https://app.intercom.com';

const SUMMARY_URL = `${ORIGIN}/ember/inbox/conversations/${CONVERSATION_ID}?fields%5Battributes%5D=true&app_id=demo1234`;

const STREAM_URL = `${ORIGIN}/ember/inbox/conversations/${CONVERSATION_ID}/stream?app_id=demo1234`;

const summaryBody = (value = 'fr') => JSON.stringify({
  state: 'closed',
  attributes: [
    { descriptor: { id: 'has_attachments', name: 'Has attachments' }, value: false },
    { descriptor: { id: 'language', name: 'Language' }, value },
    { descriptor: { id: 9006910, name: 'Brand' }, value: '9000b0a1-4c2e-4d7a-9e11-5a3f0c7d2b10' }
  ]
});

function hookWith(bodyByUrl, options = {}) {
  const calls = [];
  const fetchImpl = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init, thisArg: this });
    const entry = bodyByUrl[url];
    if (entry === undefined) return Promise.resolve(makeIntercomResponse('{}', { url }));
    if (entry instanceof Error) return Promise.reject(entry);
    return Promise.resolve(entry);
  };
  const ctx = loadIntercomPageHook({ fetchImpl, ...options });
  ctx.calls = calls;
  return ctx;
}

async function relayed(ctx, url, init) {
  ctx.sendReady();
  const result = await ctx.window.fetch(url, init);
  await delay(0);
  return { result, envelopes: ctx.posted.filter(m => m && m.__isaic === true) };
}

const INBOXES_URL = `${ORIGIN}/ember/inbox/inboxes/inboxes?app_id=demo1234&fields%5Bcount%5D=true`;

module.exports = {
  CONVERSATION_ID,
  ORIGIN,
  SUMMARY_URL,
  STREAM_URL,
  summaryBody,
  hookWith,
  relayed,
  INBOXES_URL,
};
