'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const TEAM = '900202';
const inboxUrl = `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`;
const NAME = 'Robin Vale';

function build(rows) {
  return loadExtension(fx.inboxHtml({
    list: fx.conversationList(rows, { state: 'Open' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: inboxUrl });
}

const listRow = id => fx.conversationListRow({ conversationId: id, name: NAME, teamId: TEAM });
const rowFor = (win, id) => win.document.querySelector(`a[data-conversation-id="${id}"]`);

test('a support chip dropped by a re-render comes back while the row keeps its marker', () => {
  const win = build([listRow('901')]);
  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  rowFor(win, '901').querySelector('.isa-support-origin-chip').remove();
  assert.equal(rowFor(win, '901').getAttribute('data-isa-support-origin'), 'support@brightwell.example');

  win.refreshSupportOriginHighlights();

  const chips = rowFor(win, '901').querySelectorAll('.isa-support-origin-chip');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].title, 'Arrived at support@brightwell.example');
});

test('clearing the only chip also removes its empty tray', () => {
  const win = build([listRow('901')]);
  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  assert.ok(rowFor(win, '901').querySelector('.isa-row-chip-tray'));

  win.rememberInboundAddresses('901', ['help@brightwell.example']);
  win.refreshSupportOriginHighlights();

  assert.equal(rowFor(win, '901').querySelector('.isa-row-chip-tray'), null);
});

for (const [label, markup] of [
  ['chip tray', '<span class="isa-row-chip-tray"><span>tray text</span></span>'],
  ['duplicate chip', '<span class="isa-duplicate-customer-chip">⧉2</span>'],
  ['support chip', '<span class="isa-support-origin-chip">✉</span>']
]) {
  test(`text in a ${label} placed before the name is never a customer name candidate`, () => {
    const win = build([listRow('901')]);
    const row = win.document.createElement('div');
    row.innerHTML = `${markup}<span>${NAME}</span>`;
    assert.deepEqual(Array.from(win.collectCustomerNameCandidates(row)), [NAME]);
  });
}

const CONVERSATION_ID = '900363083242906';
const ORIGIN = 'https://app.intercom.com';
const ALDERPOINT_TEAM = '900201';

function relay(win, data) {
  win.dispatchEvent(new win.MessageEvent('message', {
    data: { __isaic: true, version: 1, conversationId: CONVERSATION_ID, ...data },
    source: win,
    origin: ORIGIN
  }));
}

function brandPage() {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({ conversationAttrs: [fx.conversationAttrRow('9100', 'Brand', 'Marlowe Books')] })
  }), { url: `${ORIGIN}/a/inbox/demo1234/inbox/conversation/${CONVERSATION_ID}?view=List` });
  const notes = [];
  win.console.debug = (...args) => notes.push(args.join(' '));
  return { win, notes };
}
