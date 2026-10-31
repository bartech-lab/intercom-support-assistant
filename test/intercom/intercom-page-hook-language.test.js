'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, hookWith, relayed } = require('../support/intercom-page-hook-harness');

const USER_ID = '900fcbb36062854afdf312d1';
const USER_PATH = `/ember/users/${USER_ID}`;
const USER_URL = `${ORIGIN}${USER_PATH}?app_id=demo1234`;
const MAX_BODY = 4 * 1024 * 1024;

const userBody = (over = {}) => JSON.stringify({
  users: [{
    id: USER_ID,
    language_override: null,
    browser_locale: 'de',
    geoip_data: { country_code2: 'DE' },
    custom_data: { profile_country: 'DE' },
    ...over
  }]
});

const contacts = envelopes => envelopes.filter(m => m.kind === 'contact-language');

const padTo = (json, length) => json + ' '.repeat(length - json.length);

test('geoip_data null falls back to profile_country and still posts the message', async () => {
  const body = userBody({
    geoip_data: null,
    browser_locale: 'fr',
    custom_data: { profile_country: 'NL' }
  });
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);
  const posted = contacts(envelopes);

  assert.equal(posted.length, 1);
  assert.equal(posted[0].userId, USER_ID);
  assert.equal(posted[0].countryCode, 'NL');
  assert.equal(posted[0].browserLocale, 'fr');
});

test('an empty response url falls back to the request url', async () => {
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(userBody(), { url: '' }) });
  const { envelopes } = await relayed(ctx, USER_URL);
  const posted = contacts(envelopes);

  assert.equal(posted.length, 1);
  assert.equal(posted[0].userId, USER_ID);
});

test('a response whose final url is another origin posts nothing', async () => {
  const evil = `https://evil.example${USER_PATH}`;
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(userBody(), { url: evil }) });
  const { envelopes } = await relayed(ctx, USER_URL);

  assert.equal(contacts(envelopes).length, 0);
});

test('a body of exactly 4 MiB of characters is accepted and one more is ignored', async () => {
  const json = userBody();
  const atLimit = hookWith({
    [USER_URL]: makeIntercomResponse(padTo(json, MAX_BODY), { url: USER_URL })
  });
  const accepted = await relayed(atLimit, USER_URL);
  assert.equal(contacts(accepted.envelopes).length, 1);

  const overLimit = hookWith({
    [USER_URL]: makeIntercomResponse(padTo(json, MAX_BODY + 1), { url: USER_URL })
  });
  const ignored = await relayed(overLimit, USER_URL);
  assert.equal(contacts(ignored.envelopes).length, 0);
});

test('a content-length of exactly 4 MiB on a small body is accepted', async () => {
  const ctx = hookWith({
    [USER_URL]: makeIntercomResponse(userBody(), {
      url: USER_URL,
      contentLength: String(MAX_BODY)
    })
  });
  const { envelopes } = await relayed(ctx, USER_URL);

  assert.equal(contacts(envelopes).length, 1);
});

test('a same-origin non-user path posts nothing even when the payload holds the user', async () => {
  for (const path of ['/ember/users/search', '/ember/conversations/1']) {
    const url = `${ORIGIN}${path}?app_id=demo1234`;
    const ctx = hookWith({ [url]: makeIntercomResponse(userBody(), { url }) });
    const { envelopes } = await relayed(ctx, url);
    assert.equal(contacts(envelopes).length, 0, path);
  }
});

test('a response whose clone throws posts nothing and the page fetch still resolves', async () => {
  const response = makeIntercomResponse(userBody(), { url: USER_URL, cloneThrows: true });
  const ctx = hookWith({ [USER_URL]: response });
  const { result, envelopes } = await relayed(ctx, USER_URL);

  assert.equal(result, response);
  assert.equal(contacts(envelopes).length, 0);
});

test('a same-origin redirect to a different path or user id posts nothing', async () => {
  const targets = [
    `${ORIGIN}/ember/conversations/1?app_id=demo1234`,
    `${ORIGIN}/ember/users/900401b4f55400b18b24d08e?app_id=demo1234`
  ];
  for (const finalUrl of targets) {
    const ctx = hookWith({ [USER_URL]: makeIntercomResponse(userBody(), { url: finalUrl }) });
    const { envelopes } = await relayed(ctx, USER_URL);
    assert.equal(contacts(envelopes).length, 0, finalUrl);
  }
});
