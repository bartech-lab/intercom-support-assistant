'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const TEAM = '900202';
const ROBIN = 'Robin Vale';
const ORIGIN = 'https://app.intercom.com';
const CHIP = '.isa-support-origin-chip';

const listUrl = `${ORIGIN}/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`;

function buildList(rowCount = 1) {
  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    rows.push(fx.conversationListRow({ conversationId: `${901 + i}`, name: ROBIN, teamId: TEAM }));
  }
  return loadExtension(fx.inboxHtml({
    list: fx.conversationList(rows, { state: 'Open' }),
    composer: fx.composer({ mode: 'email' })
  }), { url: listUrl });
}

const rowFor = (win, id) => win.document.querySelector(`a[data-conversation-id="${id}"]`);

test('a row decorated for address A and then address B shows one chip titled for B', () => {
  const win = buildList();
  const row = rowFor(win, '901');

  win.decorateSupportOriginRow(row, 'support@brightwell.example');
  assert.equal(row.querySelector(CHIP).title, 'Arrived at support@brightwell.example');
  win.decorateSupportOriginRow(row, 'support@alderpoint.example');

  const chips = row.querySelectorAll(CHIP);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].title, 'Arrived at support@alderpoint.example');
  assert.equal(row.getAttribute('data-isa-support-origin'), 'support@alderpoint.example');
});

test('a chip moved outside the tray goes back into the tray on the next decoration with the same address', () => {
  const win = buildList();
  const row = rowFor(win, '901');
  win.decorateSupportOriginRow(row, 'support@brightwell.example');
  const tray = row.querySelector('.isa-row-chip-tray');
  row.appendChild(row.querySelector(CHIP));
  assert.notEqual(row.querySelector(CHIP).parentElement, tray);

  win.decorateSupportOriginRow(row, 'support@brightwell.example');

  const chips = row.querySelectorAll(CHIP);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].parentElement.classList.contains('isa-row-chip-tray'), true);
  assert.equal(row.querySelectorAll('.isa-row-chip-tray').length, 1);
});

test('a row that lost its class but kept the data attribute loses its chip when the origin stops being support', () => {
  const win = buildList(2);
  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  const row = rowFor(win, '901');
  assert.ok(row.querySelector(CHIP));

  row.className = 'ember-view group';
  assert.equal(row.hasAttribute('data-isa-support-origin'), true);
  win.rememberInboundAddresses('901', ['help@brightwell.example']);
  win.refreshSupportOriginHighlights();

  assert.equal(row.querySelector(CHIP), null);
});

test('a chip is removed from the second row only, leaving the first row decorated', () => {
  const win = buildList(2);
  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.rememberInboundAddresses('902', ['support@brightwell.example']);
  win.refreshSupportOriginHighlights();
  const second = rowFor(win, '902');
  second.className = 'ember-view group';

  win.rememberInboundAddresses('902', ['help@brightwell.example']);
  win.refreshSupportOriginHighlights();

  assert.ok(rowFor(win, '901').querySelector(CHIP));
  assert.equal(second.querySelector(CHIP), null);
});

test('a whitespace-only team inbox name highlights no email metadata container despite two recipients and a brand attribute', () => {
  const win = loadExtension(fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: '   ',
      conversationAttrs: [fx.conversationAttrRow('3001', 'Brand', 'Brightwell')]
    }),
    conversation: fx.emailMetadataContainer('To: help@brightwell.example; Cc: bram@example.org')
  }));
  assert.equal(win.getVisibleTeamInboxName().trim(), '');

  win.refreshMultiRecipientEmailHighlights();

  const containers = [...win.document.querySelectorAll('[data-testid="email-metadata-container"]')];
  assert.equal(containers.length, 1);
  assert.equal(containers[0].classList.contains('isa-multi-recipient-email-highlight'), false);
});
