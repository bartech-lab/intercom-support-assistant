'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeIntercomResponse } = require('../support/helpers');
const { ORIGIN, hookWith, relayed } = require('../support/intercom-page-hook-harness');

const USER_ID = '900fcbb36062854afdf312d1';
const USER_URL = `${ORIGIN}/ember/users/${USER_ID}?app_id=demo1234`;
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

const post = async (body, options = {}) => {
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL, ...options }) });
  const { envelopes } = await relayed(ctx, USER_URL);
  return contacts(envelopes);
};

test('C1 a content-length one over the limit posts nothing while the limit itself posts one', async () => {
  const atLimit = await post(userBody(), { contentLength: String(MAX_BODY) });
  assert.equal(atLimit.length, 1);
  assert.equal(atLimit[0].userId, USER_ID);

  const overLimit = await post(userBody(), { contentLength: String(MAX_BODY + 1) });
  assert.equal(overLimit.length, 0);
});

test('C2 null custom_data and geoip_data still post the language with no country', async () => {
  for (const over of [
    { language_override: null, browser_locale: 'fr' },
    { language_override: 'pl', browser_locale: null }
  ]) {
    const posted = await post(userBody({ ...over, custom_data: null, geoip_data: null }));
    assert.equal(posted.length, 1, JSON.stringify(over));
    assert.equal(posted[0].userId, USER_ID);
    assert.equal(posted[0].countryCode ?? null, null);
    assert.equal(posted[0].languageOverride ?? null, over.language_override);
    assert.equal(posted[0].browserLocale ?? null, over.browser_locale);
  }
});

test('C3 a first user with another id posts nothing', async () => {
  const posted = await post(userBody({ id: '900401b4f55400b18b24d08e' }));
  assert.equal(posted.length, 0);
});

test('C3 an empty users array posts nothing', async () => {
  const posted = await post(JSON.stringify({ users: [] }));
  assert.equal(posted.length, 0);
});
