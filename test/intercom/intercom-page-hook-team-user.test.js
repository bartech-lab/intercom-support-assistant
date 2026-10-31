'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse, loadExtension } = require('../support/helpers');
const {
  CONVERSATION_ID,
  ORIGIN,
  SUMMARY_URL,
  STREAM_URL,
  hookWith,
  relayed,
} = require('../support/intercom-page-hook-harness');

const summaryWithTeam = (team, value = 'fr') => JSON.stringify({
  state: 'closed',
  team_assignee: team,
  attributes: [
    { descriptor: { id: 'language', name: 'Language' }, value }
  ]
});

const teamEnvelopes = envelopes => envelopes.filter(e => e.kind === 'conversation-team');

const USER_ID = '900fcbb36062854afdf312d1';
const USER_URL = `${ORIGIN}/ember/users/${USER_ID}?app_id=demo1234`;

const userBody = (over = {}, id = USER_ID) => JSON.stringify({
  users: [{
    id,
    email: 'customer@example.com',
    name: 'Klaus Wexley',
    language_override: null,
    browser_locale: 'de',
    geoip_data: { country_code2: 'DE', city_name: 'Berlin' },
    custom_data: { profile_country: 'DE', plan: 'pro' },
    ...over
  }]
});

const contactEnvelopes = envelopes => envelopes.filter(m => m.kind === 'contact-language');

test('the summary relays the root team_assignee id alongside the language', async () => {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(
      summaryWithTeam({ id: 900201, name: 'Support Alderpoint', icon: '🎒', is_redacted: false }),
      { url: SUMMARY_URL }
    )
  });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);
  const team = teamEnvelopes(envelopes);

  assert.equal(team.length, 1);
  assert.deepEqual(Object.keys(team[0]).sort(),
    ['__isaic', 'conversationId', 'kind', 'source', 'teamId', 'version']);
  assert.equal(team[0].teamId, '900201', 'a numeric id becomes a string');
  assert.equal(team[0].source, 'summary');
  assert.equal(team[0].conversationId, CONVERSATION_ID);
});

test('the team name never crosses the bridge', async () => {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(
      summaryWithTeam({ id: 900201, name: 'Support Alderpoint' }), { url: SUMMARY_URL })
  });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);

  assert.equal(JSON.stringify(envelopes).includes('Support Alderpoint'), false);
});

test('a team is relayed even when the language attribute is absent', async () => {
  const body = JSON.stringify({ state: 'open', team_assignee: { id: 900202 }, attributes: [] });
  const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(body, { url: SUMMARY_URL }) });
  const { envelopes } = await relayed(ctx, SUMMARY_URL);

  assert.equal(teamEnvelopes(envelopes).length, 1);
  assert.equal(envelopes.filter(e => e.kind === 'conversation-language').length, 0);
});

test('an absent, null, redacted or malformed team relays nothing', async () => {
  const cases = [
    JSON.stringify({ attributes: [] }),
    JSON.stringify({ team_assignee: null }),
    JSON.stringify({ team_assignee: { id: 900201, is_redacted: true } }),
    JSON.stringify({ team_assignee: { id: 'not-a-number' } }),
    JSON.stringify({ team_assignee: { id: -5 } }),
    JSON.stringify({ team_assignee: { name: 'Support Alderpoint' } }),
    JSON.stringify({ team_assignee: 'Support Alderpoint' })
  ];

  for (const body of cases) {
    const ctx = hookWith({ [SUMMARY_URL]: makeIntercomResponse(body, { url: SUMMARY_URL }) });
    const { envelopes } = await relayed(ctx, SUMMARY_URL);
    assert.equal(teamEnvelopes(envelopes).length, 0, body);
  }
});

test('a stream payload carrying team_assignee relays no team', async () => {
  const body = JSON.stringify({
    id: Number(CONVERSATION_ID),
    team_assignee: { id: 900201, name: 'Support Alderpoint' },
    renderable_parts: []
  });
  const ctx = hookWith({ [STREAM_URL]: makeIntercomResponse(body, { url: STREAM_URL }) });
  const { envelopes } = await relayed(ctx, STREAM_URL);

  assert.equal(teamEnvelopes(envelopes).length, 0, 'summary is the only verified source');
});

test('a team observed before the handshake is buffered and replayed once', async () => {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(
      summaryWithTeam({ id: 900201 }), { url: SUMMARY_URL })
  });

  await ctx.window.fetch(SUMMARY_URL);
  await delay(0);
  assert.equal(teamEnvelopes(ctx.posted.filter(m => m && m.__isaic === true)).length, 0);

  ctx.sendReady();
  await delay(0);
  assert.equal(teamEnvelopes(ctx.posted.filter(m => m && m.__isaic === true)).length, 1);

  ctx.sendReady();
  await delay(0);
  assert.equal(teamEnvelopes(ctx.posted.filter(m => m && m.__isaic === true)).length, 1);
});

test('a user payload relays only the three language tokens', async () => {
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(userBody(), { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);
  const contacts = contactEnvelopes(envelopes);

  assert.equal(contacts.length, 1);
  assert.deepEqual(Object.keys(contacts[0]).sort(), [
    '__isaic', 'browserLocale', 'countryCode', 'kind', 'languageOverride', 'userId', 'version'
  ]);
  assert.equal(contacts[0].userId, USER_ID);
  assert.equal(contacts[0].browserLocale, 'de');
  assert.equal(contacts[0].countryCode, 'DE');
  assert.equal(contacts[0].languageOverride, null);
});

test('a language override is relayed when the workspace has set one', async () => {
  const body = userBody({ language_override: 'it' });
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);

  assert.equal(contactEnvelopes(envelopes)[0].languageOverride, 'it');
});

test('the country falls back to profile_country when geoip is absent', async () => {
  const body = userBody({ geoip_data: null, custom_data: { profile_country: 'nl' } });
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);

  assert.equal(contactEnvelopes(envelopes)[0].countryCode, 'NL');
});

test('geoip takes priority over profile_country when both are present and disagree', async () => {
  const body = userBody({ geoip_data: { country_code2: 'FR' }, custom_data: { profile_country: 'de' } });
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);

  assert.equal(contactEnvelopes(envelopes)[0].countryCode, 'FR');
});

test('a user payload with no usable token relays a clearing envelope', async () => {
  const body = userBody({ browser_locale: null, geoip_data: null, custom_data: {} });
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);

  const contact = contactEnvelopes(envelopes)[0];
  assert.ok(contact);
  assert.equal(contact.kind, 'contact-language');
  assert.equal(contact.userId, USER_ID);
  assert.equal(contact.languageOverride, null);
  assert.equal(contact.browserLocale, null);
  assert.equal(contact.countryCode, null);
});

test('a user payload for a different id is ignored', async () => {
  const body = userBody({}, '900401b4f55400b18b24d08e');
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);

  assert.equal(contactEnvelopes(envelopes).length, 0);
});

test('a malformed country code is dropped rather than relayed', async () => {
  const body = userBody({ geoip_data: { country_code2: 'DEU' }, custom_data: {} });
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(body, { url: USER_URL }) });
  const { envelopes } = await relayed(ctx, USER_URL);

  assert.equal(contactEnvelopes(envelopes)[0].countryCode, null);
});

test('a user observed before the handshake is buffered and replayed once', async () => {
  const ctx = hookWith({ [USER_URL]: makeIntercomResponse(userBody(), { url: USER_URL }) });

  await ctx.window.fetch(USER_URL);
  await delay(0);
  assert.equal(contactEnvelopes(ctx.posted.filter(m => m && m.__isaic === true)).length, 0);

  ctx.sendReady();
  await delay(0);
  assert.equal(contactEnvelopes(ctx.posted.filter(m => m && m.__isaic === true)).length, 1);

  ctx.sendReady();
  await delay(0);
  assert.equal(contactEnvelopes(ctx.posted.filter(m => m && m.__isaic === true)).length, 1);
});
