'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const REAL_ROWS = [
  fx.reactUserAttributeRow('name', 'Name', fx.reactAttributeValue('name', 'Tester')),
  fx.reactUserAttributeRow('email', 'Email', fx.reactEmailValue('customer@example.com')),
  fx.reactUserAttributeRow('user_id', 'User id', fx.reactAttributeValue('user_id', 'C42793'))
];

const DUPLICATE_ROWS = [
  fx.reactUserAttributeRow('email', 'Email', fx.reactEmailValue('other@example.com')),
  fx.reactUserAttributeRow('user_id', 'User id', fx.reactAttributeValue('user_id', '900802_marlowe'))
];

function loadReactInbox({ duplicates = false } = {}) {
  const userDetails = [
    duplicates ? fx.reactDuplicateCard('90032524b3cb727fd472c85b', DUPLICATE_ROWS) : '',
    fx.reactUserDetailsSection(REAL_ROWS)
  ].join('\n');

  return loadExtension(fx.inboxHtml({
    sidebar: fx.reactSidebarSection({
      teamInbox: 'Support Brightwell',
      conversationId: '456',
      conversationAttrs: [fx.reactConversationAttrRow('9006910', 'Brand', 'Brightwell')]
    }),
    userDetails,
    conversation: fx.reactConversationStream({ customerText: 'Hello' })
  }));
}

test('the React sidebar resolves every attribute the customer link needs', () => {
  const win = loadReactInbox();

  assert.equal(win.getCustomerEmail(), 'customer@example.com');
  assert.equal(win.getCompanyFromAttributes({ allowRaw: true }), 'Brightwell');
  assert.equal(win.getVisibleTeamInboxName().trim(), 'Support Brightwell');
  assert.equal(win.getSidebarConversationId(), '456');
});

test('a potential-duplicate card never supplies the email', () => {
  const win = loadReactInbox({ duplicates: true });

  assert.equal(win.getCustomerEmail(), 'customer@example.com');
});

test('the React conversation stream is a recognised conversation surface', () => {
  const win = loadReactInbox();
  const anchor = win.buildAnchorHealthReport().anchors
    .find(entry => entry.id === 'conversationSurface');

  assert.equal(anchor.status, 'ok');
});

test('left-nav rows are never mistaken for attribute rows when no sidebar is present', () => {
  const win = loadExtension(fx.inboxHtml({
    nav: `<div class="flex flex-row items-center h-8"><span class="truncate">Your inbox</span></div>
          <div class="flex flex-row items-center h-8"><span class="truncate">Mentions</span></div>`
  }));

  assert.deepEqual(Array.from(win.getAttributeRows()), []);
  assert.equal(win.getCustomerEmail(), null);
});

test('a required conversation attribute keeps its label match despite the asterisk', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.reactSidebarSection({
      teamInbox: 'Сases Brightwell',
      conversationId: '900202944780006',
      conversationAttrs: [
        fx.reactConversationAttrRow('9006910', 'Brand<span aria-hidden="true">*</span>', 'Brightwell')
      ]
    }),
    userDetails: fx.reactUserDetailsSection(REAL_ROWS),
    conversation: fx.reactConversationStream({ customerText: 'Hello' })
  }));

  assert.equal(win.getCompanyFromAttributes(), 'Brightwell');
});

test('a middle click on a customer link inside the shadow-root sidebar opens it in a new tab', () => {
  const win = loadExtension(fx.inboxHtml({
    userDetails: '<div id="teammate-app-react"></div>'
  }));
  const shadow = win.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<span data-original-user-id="42"><a href="https://admin.brightwell.example/customers/find?email=p%40e.example">Brightwell Customer Profile</a></span>';
  const opened = [];
  win.open = (url, target) => { opened.push([url, target]); return null; };

  const event = new win.MouseEvent('auxclick', { button: 1, bubbles: true, composed: true, cancelable: true });
  shadow.querySelector('a').dispatchEvent(event);

  assert.deepEqual(opened, [['https://admin.brightwell.example/customers/find?email=p%40e.example', '_blank']]);
  assert.equal(event.defaultPrevented, true);
});
