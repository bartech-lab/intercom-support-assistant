'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeIntercomResponse } = require('../support/helpers');
const {
  CONVERSATION_ID,
  SUMMARY_URL,
  hookWith,
  relayed,
} = require('../support/intercom-page-hook-harness');

const ofKind = (envelopes, kind) => envelopes.filter(e => e.kind === kind);

async function observe(payload) {
  const ctx = hookWith({
    [SUMMARY_URL]: makeIntercomResponse(JSON.stringify(payload), { url: SUMMARY_URL })
  });
  return (await relayed(ctx, SUMMARY_URL)).envelopes;
}

test('a descriptor with id language and a localized name is the language attribute', async () => {
  const envelopes = await observe({
    state: 'open',
    attributes: [{ descriptor: { id: 'language', name: 'Idioma' }, value: 'es' }]
  });
  const languages = ofKind(envelopes, 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'es');
  assert.equal(languages[0].conversationId, CONVERSATION_ID);
});

test('a descriptor named with padding and capitals is the language attribute', async () => {
  const envelopes = await observe({
    state: 'open',
    attributes: [{ descriptor: { id: 99887, name: '  LANGUAGE  ' }, value: 'de' }]
  });
  const languages = ofKind(envelopes, 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'de');
});

test('a non-language attribute listed first is not posted as the language', async () => {
  const envelopes = await observe({
    state: 'open',
    attributes: [
      { descriptor: { id: 555, name: 'Urgent' }, value: 'High' },
      { descriptor: { id: 'language', name: 'Language' }, value: 'it' }
    ]
  });
  const languages = ofKind(envelopes, 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'it');
});

test('a brand descriptor with padding is recognised and an earlier unrelated attribute is not the brand', async () => {
  const envelopes = await observe({
    state: 'open',
    attributes: [
      { descriptor: { id: 555, name: 'Urgent' }, value: 'High' },
      { descriptor: { id: 9006910, name: ' Brand ' }, value: 'alderpoint' }
    ]
  });
  const brands = ofKind(envelopes, 'conversation-company');
  assert.equal(brands.length, 1);
  assert.equal(brands[0].company, 'alderpoint');
  assert.equal(brands[0].source, 'summary');
});

test('the option matching the value is the second one and its label is posted', async () => {
  const envelopes = await observe({
    state: 'open',
    attributes: [{
      descriptor: {
        id: 'language',
        name: 'Language',
        options: [
          null,
          { id: 'opt-a', label: 'de' },
          { id: 'opt-b', label: 'fr' }
        ]
      },
      value: 'opt-b'
    }]
  });
  const languages = ofKind(envelopes, 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'fr');
});

test('an attribute with a null descriptor does not hide a later language attribute', async () => {
  const envelopes = await observe({
    state: 'open',
    attributes: [
      { descriptor: null, value: 'x' },
      { descriptor: { id: 'language', name: 'Language' }, value: 'pt' }
    ]
  });
  const languages = ofKind(envelopes, 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'pt');
});

test('a null team_assignee posts no team but still posts language and state', async () => {
  const envelopes = await observe({
    state: 'open',
    team_assignee: null,
    attributes: [{ descriptor: { id: 'language', name: 'Language' }, value: 'fr' }]
  });
  assert.equal(ofKind(envelopes, 'conversation-team').length, 0);
  const languages = ofKind(envelopes, 'conversation-language');
  assert.equal(languages.length, 1);
  assert.equal(languages[0].language, 'fr');
  const states = ofKind(envelopes, 'conversation-state');
  assert.equal(states.length, 1);
  assert.equal(states[0].state, 'open');
});

test('an attributes object that is not an array posts no language but still posts the team', async () => {
  const envelopes = await observe({
    state: 'open',
    team_assignee: { id: 900201, is_redacted: false },
    attributes: {}
  });
  assert.equal(ofKind(envelopes, 'conversation-language').length, 0);
  assert.equal(ofKind(envelopes, 'conversation-company').length, 0);
  const team = ofKind(envelopes, 'conversation-team');
  assert.equal(team.length, 1);
  assert.equal(team[0].teamId, '900201');
});
