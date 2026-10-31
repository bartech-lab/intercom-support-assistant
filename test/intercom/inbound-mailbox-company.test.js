'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';
const CONVERSATION_ID = '900202944780103';
const MAILBOX_TEAM = '90009672';
const CUSTOMER_EMAIL = 'anselm.sample@example.com';

function conversationUrl(teamId = MAILBOX_TEAM) {
  return `${ORIGIN}/a/inbox/demo1234/inbox/team/${teamId}/conversation/${CONVERSATION_ID}`;
}

function addressEnvelope(addresses) {
  return {
    __isaic: true,
    version: 1,
    kind: 'conversation-inbound-address',
    conversationId: CONVERSATION_ID,
    source: 'stream',
    addresses
  };
}

function brandEnvelope(brand) {
  return {
    __isaic: true,
    version: 1,
    kind: 'conversation-company',
    conversationId: CONVERSATION_ID,
    source: 'stream',
    brand
  };
}

function deliver(win, data) {
  win.dispatchEvent(new win.MessageEvent('message', { data, source: win, origin: ORIGIN }));
}

function crossBrandWindow({ teamInbox = 'Shared Desk North', userId = 'C23250' } = {}) {
  return loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox, conversationAttrs: [] }),
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue(CUSTOMER_EMAIL)),
      fx.userDetailRow('User id', fx.userIdValue(userId))
    ]),
    conversation: fx.conversationSpace({ customerText: 'Hallo' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: conversationUrl() });
}

test('detectInboxType prefers the inbound mailbox over a cross-brand Brand attribute', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Kestrel Kids',
      conversationAttrs: [fx.conversationAttrRow(CONVERSATION_ID, 'Brand', 'Kestrel Kids')]
    }),
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Email', fx.emailValue(CUSTOMER_EMAIL)),
      fx.userDetailRow('User id', fx.userIdValue('C23250'))
    ]),
    conversation: fx.conversationSpace({ customerText: 'Hallo' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: `${ORIGIN}/a/inbox/demo1234/inbox/conversation/${CONVERSATION_ID}` });
  win.console.warn = () => {};
  win.console.debug = () => {};

  deliver(win, addressEnvelope(['help@brightwell.example']));
  const info = win.detectInboxType();

  assert.equal(info.type, 'company');
  assert.equal(info.sources.mailbox, 'Brightwell');
  assert.equal(info.sources.attribute, 'Kestrel Kids');
  assert.equal(info.name, 'Brightwell');
});
