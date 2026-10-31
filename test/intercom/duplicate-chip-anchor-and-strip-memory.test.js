'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM,
  TAMSIN,
  WREN,
  build,
  row,
  rowFor,
} = require('../support/duplicate-conversations-harness');

const urlFor = id => `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/${id}?view=List`;
const listOf = win => win.document.querySelector('[data-intercom-target-conversation-list]');
const stripHrefs = win => [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
  .map(a => a.getAttribute('href').match(/conversation\/(\w+)/)[1]);

const withLeadingPiece = (id, piece) => row(id, TAMSIN, { initial: '' })
  .replace('<div class="flex flex-row gap-1">', `<div class="flex flex-row gap-1">${piece}`);

function trayPlacement(win, id) {
  const rowEl = rowFor(win, id);
  const name = rowEl.querySelector('.font-semibold');
  const tray = rowEl.querySelector('.isa-row-chip-tray');
  assert.ok(tray, `tray rendered on row ${id}`);
  return { rowEl, name, tray };
}

test('avatar initials ahead of the name do not pull the chip into the avatar', () => {
  const win = build([row('1', TAMSIN, { initial: 'JD' }), row('2', TAMSIN, { initial: '' })]);
  win.refreshDuplicateCustomerHighlights();

  const withAvatar = trayPlacement(win, '1');
  const plain = trayPlacement(win, '2');
  assert.equal(withAvatar.rowEl.querySelector('.inbox2__avatar').textContent, 'JD');
  assert.equal(withAvatar.tray.parentElement, withAvatar.name.parentElement);
  assert.equal(withAvatar.rowEl.querySelector('.inbox2__avatar').contains(withAvatar.tray), false);
  assert.equal(
    [...withAvatar.tray.parentElement.children].indexOf(withAvatar.tray),
    [...plain.tray.parentElement.children].indexOf(plain.tray),
    'same position beside the name as in a row with no avatar text'
  );
});

test('a one-character unread badge before the name does not attract the chip', () => {
  const win = build([withLeadingPiece('1', '<span class="badge">3</span>'), row('2', TAMSIN, { initial: '' })]);
  win.refreshDuplicateCustomerHighlights();

  const { rowEl, name, tray } = trayPlacement(win, '1');
  const badge = rowEl.querySelector('.badge');
  assert.notEqual(badge.parentElement, name.parentElement, 'the badge lives in another parent');
  assert.equal(tray.parentElement, name.parentElement);
  assert.equal(badge.parentElement.contains(tray), false);
  assert.equal(badge.nextElementSibling === tray, false);
});

test('a one-character bullet before the name does not attract the chip', () => {
  const win = build([withLeadingPiece('1', '<span class="bullet">•</span>'), row('2', TAMSIN, { initial: '' })]);
  win.refreshDuplicateCustomerHighlights();

  const { rowEl, name, tray } = trayPlacement(win, '1');
  const bullet = rowEl.querySelector('.bullet');
  assert.equal(tray.parentElement, name.parentElement);
  assert.equal(bullet.parentElement.contains(tray), false);
});

test('a sibling scrolled out stays in the strip after another sibling is closed', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)], { url: urlFor('900') });
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(stripHrefs(win), ['900', '901', '902']);

  listOf(win).innerHTML = row('900', TAMSIN) + row('902', TAMSIN);
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(stripHrefs(win), ['900', '901', '902'], 'the scrolled-out sibling is remembered');

  win.forgetDuplicateConversation('902');
  listOf(win).innerHTML = row('900', TAMSIN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(stripHrefs(win), ['900', '901']);
});

test('closing the open conversation drops the remembered siblings', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)], { url: urlFor('900') });
  win.refreshDuplicateCustomerHighlights();

  listOf(win).innerHTML = row('900', TAMSIN) + row('902', TAMSIN);
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(stripHrefs(win), ['900', '901', '902']);

  win.forgetDuplicateConversation('900');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);

  win.history.pushState({}, '', new URL(urlFor('910')).pathname + '?view=List');
  listOf(win).innerHTML = row('910', TAMSIN) + row('912', TAMSIN) + row('913', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(stripHrefs(win), ['910', '912'], 'no stale 901 or 902');
});
