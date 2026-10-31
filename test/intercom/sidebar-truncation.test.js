'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const CONVERSATION_ID = '900202944780104';
const ORIGIN = 'https://app.intercom.com';
const URL = `${ORIGIN}/a/inbox/demo1234/inbox/team/90009637/conversation/${CONVERSATION_ID}`;

const SEE_ALL_ATTRIBUTES = '<button type="button" data-testid="see-all-attributes"><span>See all</span></button>';
const SEE_ALL_USER_ATTRIBUTES = '<button type="button" data-testid="see-all-user-attributes"><span>See all</span></button>';

function identityEnvelope(over = {}) {
  return {
    __isaic: true,
    version: 1,
    kind: 'conversation-identity',
    conversationId: CONVERSATION_ID,
    email: 'elske.arden@example.com',
    source: 'summary',
    ...over
  };
}

function deliver(win, data) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: ORIGIN }));
}

function loadTruncatedSidebar() {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Shared Desk East', conversationAttrs: [] }) + SEE_ALL_ATTRIBUTES,
    userDetails: fx.userDetailsSection([fx.userDetailRow('Location', '<span>Lindau, Germany</span>')])
      + SEE_ALL_USER_ATTRIBUTES
  }), { url: URL });
}

test('anchor health reports which fields a truncated panel is hiding', () => {
  const win = loadTruncatedSidebar();
  const panels = win.buildAnchorHealthReport().truncatedPanels;

  const conversation = panels.find(panel => panel.id === 'conversationAttributes');
  assert.equal(conversation.seeAllPresent, true);
  assert.equal(conversation.fields.find(field => field.field === 'company').hiddenBehindSeeAll, true);

  const user = panels.find(panel => panel.id === 'userAttributes');
  assert.equal(user.seeAllPresent, true);
  assert.equal(user.fields.find(field => field.field === 'email').hiddenBehindSeeAll, true);
  assert.equal(user.fields.find(field => field.field === 'userId').hiddenBehindSeeAll, true);
  assert.equal(user.fields.find(field => field.field === 'location').hiddenBehindSeeAll, false,
    'a rendered row is not reported as hidden');
});

test('a rendered row is never reported as hidden behind See all', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: 'Shared Desk East',
      conversationAttrs: [fx.conversationAttrRow('9100', 'Brand', 'Fernhill')]
    }) + SEE_ALL_ATTRIBUTES
  }), { url: URL });

  const conversation = win.buildAnchorHealthReport().truncatedPanels
    .find(panel => panel.id === 'conversationAttributes');
  assert.equal(conversation.fields.find(field => field.field === 'company').hiddenBehindSeeAll, false);
});

test('the customer email falls back to the conversation payload', () => {
  const win = loadTruncatedSidebar();

  assert.equal(win.getCustomerEmail(), null, 'nothing to read while the rows are hidden');

  deliver(win, identityEnvelope());

  assert.equal(win.getCustomerEmail(), 'elske.arden@example.com');
});

test('an identity for another conversation is never read', () => {
  const win = loadTruncatedSidebar();
  deliver(win, identityEnvelope({ conversationId: '900257296012' }));

  assert.equal(win.getCustomerEmail(), null);
});

test('a malformed identity envelope is dropped', () => {
  const win = loadTruncatedSidebar();
  deliver(win, identityEnvelope({ email: 'not an address' }));

  assert.equal(win.getCustomerEmail(), null);
});
