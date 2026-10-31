'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const CONVERSATION_ID = '900476928560574';
const ORIGIN = 'https://app.intercom.com';

const ALDERPOINT_TEAM = '900201';
const BRIGHTWELL_TEAM = '900202';
const KESTREL_TEAM = '900203';

function conversationUrl(teamId, conversationId = CONVERSATION_ID) {
  return `${ORIGIN}/a/inbox/demo1234/inbox/team/${teamId}/conversation/${conversationId}`;
}

function teamEnvelope(over = {}) {
  return {
    __isaic: true,
    version: 1,
    kind: 'conversation-team',
    conversationId: CONVERSATION_ID,
    teamId: ALDERPOINT_TEAM,
    source: 'summary',
    ...over
  };
}

function deliver(win, data, { source = win, origin = ORIGIN } = {}) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source, origin }));
}

function loadSidebar({ url, brand = null, teamInbox = null } = {}) {
  const rows = [];
  if (brand) rows.push(fx.conversationAttrRow('9100', 'Brand', brand));
  return loadExtension(
    fx.inboxHtml({ sidebar: fx.sidebarSection({ teamInbox, conversationAttrs: rows }) }),
    { url }
  );
}

test('a network team corroborating the sidebar clears a phantom conflict', () => {
  const win = loadSidebar({
    url: conversationUrl(BRIGHTWELL_TEAM),
    brand: 'Alderpoint',
    teamInbox: 'Support Alderpoint'
  });

  const before = win.detectInboxType();
  assert.equal(before.signatureSafe, false, 'the stale URL team makes this fail closed today');

  deliver(win, teamEnvelope());
  const after = win.detectInboxType();

  assert.equal(after.name, 'Alderpoint');
  assert.equal(after.signatureSafe, true, 'the real assignee corroborates the sidebar');
  assert.equal(after.sources.networkTeam, 'Alderpoint');
  assert.equal(after.sources.urlTeam, 'Brightwell', 'the url team keeps its original meaning');
});

test('a network team disagreeing with the Brand attribute wins resolution', () => {
  const win = loadSidebar({
    url: conversationUrl(ALDERPOINT_TEAM),
    brand: 'Brightwell',
    teamInbox: 'Support Brightwell'
  });

  deliver(win, teamEnvelope());
  const info = win.detectInboxType();

  assert.equal(info.name, 'Alderpoint', 'the assignee outranks a hand-entered attribute');
  assert.equal(info.sources.attribute, 'Brightwell');
  assert.equal(info.signatureSafe, true, 'the assignee backs the resolution');
});

test('a hand-entered Brand attribute naming another brand loses to the assignee', () => {
  const win = loadSidebar({
    url: `${ORIGIN}/a/inbox/demo1234/inbox/conversation/${CONVERSATION_ID}?view=List`,
    brand: 'Marlowe Books',
    teamInbox: 'Support Alderpoint'
  });

  assert.equal(win.detectInboxType().name, 'Marlowe Books', 'with no team signal the attribute still decides');

  deliver(win, teamEnvelope({ teamId: ALDERPOINT_TEAM }));
  const info = win.detectInboxType();

  assert.equal(info.name, 'Alderpoint');
  assert.equal(info.sources.urlTeam, null, 'this view carries no team id in the path');
  assert.equal(info.sources.networkTeam, 'Alderpoint');
  assert.equal(info.signatureSafe, true);
});

test('the Brand attribute still decides when no team signal exists', () => {
  const win = loadSidebar({
    url: `${ORIGIN}/a/inbox/demo1234/inbox/conversation/${CONVERSATION_ID}?view=List`,
    brand: 'Brightwell',
    teamInbox: 'Support Brightwell'
  });

  const info = win.detectInboxType();

  assert.equal(info.name, 'Brightwell');
  assert.equal(info.sources.networkTeam, null);
});

test('an unmapped team id changes nothing', () => {
  const url = conversationUrl(BRIGHTWELL_TEAM);
  const control = loadSidebar({ url, brand: 'Alderpoint', teamInbox: 'Support Alderpoint' }).detectInboxType();

  const win = loadSidebar({ url, brand: 'Alderpoint', teamInbox: 'Support Alderpoint' });
  deliver(win, teamEnvelope({ teamId: '900956585' }));
  const info = win.detectInboxType();

  assert.equal(info.signatureSafe, control.signatureSafe);
  assert.equal(info.name, control.name);
  assert.equal(info.sources.networkTeam, null);
});

test('a team for a different conversation is never consulted', () => {
  const win = loadSidebar({
    url: conversationUrl(BRIGHTWELL_TEAM),
    brand: 'Alderpoint',
    teamInbox: 'Support Alderpoint'
  });

  deliver(win, teamEnvelope({ conversationId: '900126133858689' }));
  const info = win.detectInboxType();

  assert.equal(info.sources.networkTeam, null);
  assert.equal(info.signatureSafe, false);
});

test('forged envelopes are rejected', () => {
  const cases = [
    ['bad team token', teamEnvelope({ teamId: 'not-a-number' })],
    ['empty team', teamEnvelope({ teamId: '' })],
    ['numeric team', teamEnvelope({ teamId: 900201 })],
    ['wrong version', teamEnvelope({ version: 2 })],
    ['missing marker', { ...teamEnvelope(), __isaic: undefined }],
    ['unknown source', teamEnvelope({ source: 'guess' })],
    ['bad conversation id', teamEnvelope({ conversationId: 'abc' })]
  ];

  for (const [label, envelope] of cases) {
    const win = loadSidebar({ url: conversationUrl(BRIGHTWELL_TEAM), brand: 'Alderpoint', teamInbox: 'Support Alderpoint' });
    deliver(win, envelope);
    assert.equal(win.detectInboxType().sources.networkTeam, null, label);
    assert.equal(win.eval('networkTeamByConversation.size'), 0, `${label} stores nothing`);
  }

  const foreignOrigin = loadSidebar({ url: conversationUrl(BRIGHTWELL_TEAM), brand: 'Alderpoint', teamInbox: 'Support Alderpoint' });
  deliver(foreignOrigin, teamEnvelope(), { origin: 'https://evil.example' });
  assert.equal(foreignOrigin.detectInboxType().sources.networkTeam, null, 'foreign origin');

  const foreignSource = loadSidebar({ url: conversationUrl(BRIGHTWELL_TEAM), brand: 'Alderpoint', teamInbox: 'Support Alderpoint' });
  deliver(foreignSource, teamEnvelope(), { source: {} });
  assert.equal(foreignSource.detectInboxType().sources.networkTeam, null, 'foreign source');
});

test('the store evicts the oldest conversation past its cap', () => {
  const win = loadSidebar({
    url: conversationUrl(BRIGHTWELL_TEAM),
    brand: 'Alderpoint',
    teamInbox: 'Support Alderpoint'
  });

  deliver(win, teamEnvelope());
  for (let index = 0; index < 20; index += 1) {
    deliver(win, teamEnvelope({ conversationId: `9001818745556${String(index).padStart(2, '0')}` }));
  }

  assert.equal(win.detectInboxType().sources.networkTeam, null, 'the original entry was evicted');
});

test('an excluded inbox still resolves the per-conversation brand', () => {
  const win = loadSidebar({
    url: conversationUrl(ALDERPOINT_TEAM),
    brand: 'Quayside Fashion',
    teamInbox: 'Tier 2'
  });

  deliver(win, teamEnvelope());
  const info = win.detectInboxType();

  assert.equal(info.type, 'excluded', 'an excluded inbox must never sign');
  assert.equal(info.name, 'Quayside Fashion', 'and must resolve the conversation brand, not the team');
});

test('the new-conversation composer consults no team', () => {
  const win = loadSidebar({
    url: `${ORIGIN}/a/inbox/demo1234/inbox/new-conversation?view=List`,
    brand: 'Alderpoint',
    teamInbox: 'Support Alderpoint'
  });

  deliver(win, teamEnvelope());
  const info = win.detectInboxType();

  assert.equal(info.sources.networkTeam, null, 'a draft has no conversation id to key on');
});
