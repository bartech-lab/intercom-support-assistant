'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadIntercomPageHook, makeIntercomResponse, loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const CONVERSATION_ID = '900409686268320';
const ORIGIN = 'https://app.intercom.com';
const STREAM_URL = `${ORIGIN}/ember/inbox/conversations/${CONVERSATION_ID}/stream?app_id=demo1234`;
const CUSTOMER = 'customer.sample@example.com';

const customerEmailPart = ({ id, to, from = CUSTOMER, cc = null }) => ({
  id,
  created_at: '2026-08-12T09:14:03.000Z',
  renderable_type: 12,
  renderable_data: {
    email_from_address: from,
    channel: 3,
    email_metadata: {
      sender_type: 'participant',
      external_sender: false,
      header_addresses: {
        from: [{ name: 'Sam Sample', email: from }],
        to: [].concat(to).map(email => ({ name: 'Agent from Brand', email })),
        ...(cc ? { cc: [].concat(cc).map(email => ({ name: 'Colleague', email })) } : {})
      }
    }
  }
});

const teammateReplyPart = ({ id, from }) => ({
  id,
  created_at: '2026-08-12T10:20:00.000Z',
  renderable_type: 2,
  renderable_data: {
    channel: 3,
    email_metadata: {
      sender_type: 'participant',
      header_addresses: {
        from: [{ name: 'Agent from Brand', email: from }],
        to: [{ name: 'CUSTOMER SAMPLE', email: CUSTOMER }],
        reply_to: [{ name: 'Agent from Brand', email: from }]
      }
    }
  }
});

const streamBody = (parts, { id = Number(CONVERSATION_ID), customerEmail = CUSTOMER } = {}) =>
  JSON.stringify({
    id,
    user_summary: { email: customerEmail },
    renderable_parts: parts
  });

async function relayStream(body, { url = STREAM_URL, responseOptions = {} } = {}) {
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse(body, { url, ...responseOptions }))
  });
  ctx.sendReady();
  await ctx.window.fetch(url);
  await delay(0);
  return ctx.posted.filter(m => m && m.__isaic === true
    && m.kind === 'conversation-inbound-address');
}

test('the earliest customer email part yields the workspace address', async () => {
  const envelopes = await relayStream(streamBody([
    customerEmailPart({ id: 90024516098, to: 'support@brightwell.example' }),
    teammateReplyPart({ id: 90030717980, from: 'support@brightwell.example' }),
    customerEmailPart({ id: 90048271555, to: 'help@brightwell.example' })
  ]));

  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].conversationId, CONVERSATION_ID);
  assert.equal(envelopes[0].source, 'stream');
  assert.deepEqual(Array.from(envelopes[0].addresses), ['support@brightwell.example']);
});

test('a part order is honoured regardless of array order', async () => {
  const envelopes = await relayStream(streamBody([
    customerEmailPart({ id: 90048271555, to: 'help@brightwell.example' }),
    customerEmailPart({ id: 90024516098, to: 'support@brightwell.example' })
  ]));

  assert.deepEqual(Array.from(envelopes[0].addresses), ['support@brightwell.example']);
});

test('both to and cc addresses are relayed, and the customer is dropped', async () => {
  const envelopes = await relayStream(streamBody([
    customerEmailPart({
      id: 1,
      to: ['help@alderpoint.example', CUSTOMER],
      cc: 'support@alderpoint.example'
    })
  ]));

  assert.deepEqual(Array.from(envelopes[0].addresses), ['help@alderpoint.example', 'support@alderpoint.example']);
});

test('a teammate reply alone relays nothing', async () => {
  const envelopes = await relayStream(streamBody([
    teammateReplyPart({ id: 1, from: 'help@brightwell.example' })
  ]));
  assert.equal(envelopes.length, 0);
});

test('a stream for a different conversation is ignored', async () => {
  const envelopes = await relayStream(streamBody(
    [customerEmailPart({ id: 1, to: 'support@brightwell.example' })],
    { id: 999 }
  ));
  assert.equal(envelopes.length, 0);
});

test('a malformed address is rejected and an empty result relays nothing', async () => {
  for (const to of ['not-an-address', '', 'no@tld', `${'a'.repeat(250)}@brightwell.example`]) {
    const envelopes = await relayStream(streamBody([customerEmailPart({ id: 1, to })]));
    assert.equal(envelopes.length, 0, `rejected: ${to.slice(0, 20)}`);
  }
});

test('at most five addresses are relayed', async () => {
  const envelopes = await relayStream(streamBody([
    customerEmailPart({
      id: 1,
      to: ['a@x.example', 'b@x.example', 'c@x.example', 'd@x.example', 'e@x.example', 'f@x.example', 'g@x.example']
    })
  ]));
  assert.equal(envelopes[0].addresses.length, 5);
});

test('the language envelope still relays alongside the address envelope', async () => {
  const url = STREAM_URL;
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse(JSON.stringify({
      id: Number(CONVERSATION_ID),
      user_summary: { email: CUSTOMER },
      renderable_parts: [
        customerEmailPart({ id: 1, to: 'support@brightwell.example' }),
        {
          id: 2,
          created_at: '2026-08-12T09:15:00.000Z',
          renderable_type: 14,
          renderable_data: { attribute_summary: { id: 'language', name: 'Language' }, value: 'German' }
        }
      ]
    }), { url }))
  });
  ctx.sendReady();
  await ctx.window.fetch(url);
  await delay(0);

  const kinds = ctx.posted.filter(m => m && m.__isaic === true).map(m => m.kind);
  assert.deepEqual(Array.from(kinds).sort(),
    ['conversation-identity', 'conversation-inbound-address', 'conversation-language']);
});

test('buffered envelopes of both kinds survive the ready handshake', async () => {
  const url = STREAM_URL;
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse(JSON.stringify({
      id: Number(CONVERSATION_ID),
      user_summary: { email: CUSTOMER },
      renderable_parts: [
        customerEmailPart({ id: 1, to: 'support@brightwell.example' }),
        {
          id: 2,
          created_at: '2026-08-12T09:15:00.000Z',
          renderable_type: 14,
          renderable_data: { attribute_summary: { id: 'language', name: 'Language' }, value: 'German' }
        }
      ]
    }), { url }))
  });

  await ctx.window.fetch(url);
  await delay(0);
  ctx.sendReady();

  const kinds = ctx.posted.filter(m => m && m.__isaic === true).map(m => m.kind);
  assert.ok(kinds.includes('conversation-inbound-address'), 'address envelope was buffered');
  assert.ok(kinds.includes('conversation-language'), 'language envelope was buffered');
});

const TEAM = '900202';
const inboxUrl = `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`;
const ROBIN = 'Robin Vale';

function build(rows, { url = inboxUrl, state = 'Open' } = {}) {
  return loadExtension(fx.inboxHtml({
    list: fx.conversationList(rows, { state }),
    composer: fx.composer({ mode: 'email' })
  }), { url });
}

const row = (conversationId, name) =>
  fx.conversationListRow({ conversationId, name, teamId: TEAM });

const rowFor = (win, id) => win.document.querySelector(`a[data-conversation-id="${id}"]`);
const isMarked = (win, id) => rowFor(win, id).classList.contains('isa-support-origin-row');
const chipTitle = (win, id) =>
  rowFor(win, id).querySelector('.isa-support-origin-chip')?.title ?? null;

function learn(win, conversationId, addresses) {
  win.rememberInboundAddresses(conversationId, addresses);
}

test('a support address underlines the row and titles the chip', () => {
  const win = build([row('901', ROBIN), row('902', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  learn(win, '902', ['help@brightwell.example']);
  win.refreshSupportOriginHighlights();

  assert.equal(isMarked(win, '901'), true);
  assert.equal(chipTitle(win, '901'), 'Arrived at support@brightwell.example');
  assert.equal(isMarked(win, '902'), false);
  assert.equal(chipTitle(win, '902'), null);
});

test('a conversation addressed to both a brand address and support is marked', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['help@alderpoint.example', 'support@alderpoint.example']);
  win.refreshSupportOriginHighlights();

  assert.equal(isMarked(win, '901'), true);
  assert.equal(chipTitle(win, '901'), 'Arrived at support@alderpoint.example');
});

test('an unmapped local part marks nothing', () => {
  const win = build([row('901', ROBIN), row('902', ROBIN)]);
  learn(win, '901', ['forms@marlowe-books.example']);
  learn(win, '902', ['docs@other-brand.example', 'partner@group.example']);
  win.refreshSupportOriginHighlights();

  assert.equal(isMarked(win, '901'), false);
  assert.equal(isMarked(win, '902'), false);
});

test('an unknown conversation marks nothing', () => {
  const win = build([row('901', ROBIN)]);
  win.refreshSupportOriginHighlights();
  assert.equal(isMarked(win, '901'), false);
});

test('the address comparison is case insensitive', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['SUPPORT@brightwell.example']);
  win.refreshSupportOriginHighlights();
  assert.equal(isMarked(win, '901'), true);
});

test('a second pass neither stacks chips nor changes the row', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  win.refreshSupportOriginHighlights();
  win.refreshSupportOriginHighlights();

  assert.equal(rowFor(win, '901').querySelectorAll('.isa-support-origin-chip').length, 1);
  assert.equal(isMarked(win, '901'), true);
});

test('a recycled row regains its class without a second chip', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();

  rowFor(win, '901').className = 'ember-view group';
  win.refreshSupportOriginHighlights();

  assert.equal(isMarked(win, '901'), true);
  assert.equal(rowFor(win, '901').querySelectorAll('.isa-support-origin-chip').length, 1);
});

test('the style is injected into the document and the shadow root', () => {
  const win = loadExtension(fx.inboxHtml({
    list: fx.conversationList([row('901', ROBIN)], { state: 'Open' }),
    composer: fx.composer({ mode: 'email' })
  }).replace('<body>', '<body><div id="teammate-app-react"></div>'), {
    url: inboxUrl,
    beforeScripts: (target) => target.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' })
  });
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();

  assert.ok(win.document.getElementById('isa-support-origin-style'));
  const shadowRoot = win.document.querySelector('#teammate-app-react').shadowRoot;
  assert.ok(shadowRoot, 'the fixture renders the Inbox shadow host');
  assert.ok(shadowRoot.querySelector('#isa-support-origin-style'),
    'the Inbox renders inside the shadow root, so the style must be there too');
});

test('the chip is never read as the customer name', () => {
  const win = build([row('901', ROBIN), row('902', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.customerKeyFromRow(rowFor(win, '901')), 'robin vale');
  assert.equal(rowFor(win, '901').querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');
  assert.equal(rowFor(win, '902').querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');
});

test('the group rail and the support underline coexist on one row', () => {
  const win = build([row('901', ROBIN), row('902', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshDuplicateCustomerHighlights();
  win.refreshSupportOriginHighlights();

  const marked = rowFor(win, '901');
  assert.equal(marked.classList.contains('isa-duplicate-customer-row'), true);
  assert.equal(marked.classList.contains('isa-support-origin-row'), true);
  assert.equal(marked.querySelectorAll('.isa-duplicate-customer-chip').length, 1);
  assert.equal(marked.querySelectorAll('.isa-support-origin-chip').length, 1);
});

test('a support member is flagged in the duplicate strip', () => {
  const win = build([row('900', ROBIN), row('901', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshDuplicateCustomerHighlights();

  const links = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')];
  assert.equal(links.length, 2);
  const flagged = links.filter(link => link.textContent.includes('✉'));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].title, 'Arrived at support@brightwell.example');
});

test('an address learned after the strip exists still flags it', () => {
  const win = build([row('900', ROBIN), row('901', ROBIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(win.document.querySelectorAll('.isa-duplicate-customer-strip a[title]').length, 0);

  learn(win, '901', ['support@brightwell.example']);

  const flagged = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .filter(link => link.textContent.includes('✉'));
  assert.equal(flagged.length, 1);
});

test('a row that loses its support address loses the decoration', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  assert.equal(isMarked(win, '901'), true);

  learn(win, '901', ['help@brightwell.example']);
  win.refreshSupportOriginHighlights();

  assert.equal(isMarked(win, '901'), false);
  assert.equal(rowFor(win, '901').querySelector('.isa-support-origin-chip'), null);
  assert.equal(rowFor(win, '901').hasAttribute('data-isa-support-origin'), false);
});

test('the address cache is bounded, evicting the oldest conversation first', () => {
  const win = build([row('901', ROBIN)]);
  for (let i = 0; i < 205; i += 1) learn(win, `${1000 + i}`, ['support@brightwell.example']);

  assert.equal(win.inboundOriginForConversation('1000'), null, 'the oldest entry is evicted');
  assert.equal(win.inboundOriginForConversation('1004'), null);
  assert.equal(win.inboundOriginForConversation('1005')?.role, 'support', 'the 200 newest survive');
  assert.equal(win.inboundOriginForConversation('1204')?.role, 'support');
});

test('the support marker is gated on the Open filter too', () => {
  const win = build([row('901', ROBIN)], { state: 'Closed' });
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();

  assert.equal(isMarked(win, '901'), false);
  assert.equal(rowFor(win, '901').querySelector('.isa-support-origin-chip'), null);
});

test('switching to a closed list clears a support marker already drawn', () => {
  const win = build([row('901', ROBIN)], { state: 'Open' });
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  assert.equal(isMarked(win, '901'), true);

  win.rememberListState('team', TEAM, 'closed');

  assert.equal(isMarked(win, '901'), false);
  assert.equal(rowFor(win, '901').hasAttribute('data-isa-support-origin'), false);
});

test('the chip tray sits beside the name, not under the avatar', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();

  const rowEl = rowFor(win, '901');
  const nameEl = rowEl.querySelector('.font-semibold');
  const tray = rowEl.querySelector('.isa-row-chip-tray');

  assert.equal(tray.parentElement, nameEl.parentElement, 'the tray shares the title line with the name');
  assert.equal(tray.previousElementSibling, nameEl, 'and follows the name');
});

test('the tray stays put when hover swaps the avatar for a checkbox', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();

  const rowEl = rowFor(win, '901');
  const anchorBefore = rowEl.querySelector('.isa-row-chip-tray').parentElement;

  const holder = rowEl.querySelector('.flex.flex-col.items-end');
  holder.innerHTML = '<input type="checkbox">';
  win.refreshSupportOriginHighlights();

  const tray = rowEl.querySelector('.isa-row-chip-tray');
  assert.equal(rowEl.querySelectorAll('.isa-row-chip-tray').length, 1, 'no duplicate tray');
  assert.equal(rowEl.querySelectorAll('.isa-support-origin-chip').length, 1, 'no duplicate chip');
  assert.equal(tray.parentElement, anchorBefore, 'losing the avatar must not move the chips');
});

test('a row with no avatar at all still anchors the tray to the name', () => {
  const win = build([fx.conversationListRow({ conversationId: '901', name: ROBIN, teamId: TEAM, initial: '' })]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();

  const rowEl = rowFor(win, '901');
  const tray = rowEl.querySelector('.isa-row-chip-tray');
  assert.notEqual(tray.parentElement, rowEl, 'the tray must never fall back to the row itself');
  assert.equal(tray.previousElementSibling, rowEl.querySelector('.font-semibold'));
});

test('both chips share one tray so the avatar column cannot widen twice', () => {
  const win = build([row('901', ROBIN), row('902', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  win.refreshDuplicateCustomerHighlights();

  const rowEl = rowFor(win, '901');
  const trays = rowEl.querySelectorAll('.isa-row-chip-tray');
  assert.equal(trays.length, 1, 'one tray per row');
  assert.equal(trays[0].querySelectorAll('.isa-support-origin-chip').length, 1);
  assert.equal(trays[0].querySelectorAll('.isa-duplicate-customer-chip').length, 1);
});

test('the chip cannot stretch to row height wherever it lands', () => {
  const win = build([row('901', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();

  const css = win.document.getElementById('isa-support-origin-style').textContent;
  assert.match(css, /align-self:\s*center/);
  assert.match(css, /flex:\s*0 0 auto/);
});

test('a settled support-origin pass makes no DOM mutation at all', () => {
  const win = build([row('901', ROBIN), row('902', ROBIN)]);
  learn(win, '901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  const chip = rowFor(win, '901').querySelector('.isa-support-origin-chip');
  const observer = new win.MutationObserver(() => {});
  observer.observe(win.document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  win.refreshSupportOriginHighlights();
  win.refreshSupportOriginHighlights();
  const records = observer.takeRecords();
  observer.disconnect();
  assert.deepEqual(records.map(record => `${record.type}:${record.attributeName || ''}`), []);
  assert.equal(rowFor(win, '901').querySelector('.isa-support-origin-chip'), chip);
  assert.equal(isMarked(win, '901'), true);
});
