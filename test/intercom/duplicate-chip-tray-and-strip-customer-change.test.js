'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM,
  TAMSIN,
  build,
  row,
  rowFor,
} = require('../support/duplicate-conversations-harness');

const MORGAN = 'morgan hale';
const urlFor = id => `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/${id}?view=List`;
const listOf = win => win.document.querySelector('[data-intercom-target-conversation-list]');
const stripHrefs = win => [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
  .map(a => a.getAttribute('href').match(/conversation\/(\w+)/)[1]);

test('a row that stops being a duplicate loses its empty chip tray', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(rowFor(win, '1').querySelectorAll('.isa-row-chip-tray').length, 1);

  rowFor(win, '2').remove();
  win.refreshDuplicateCustomerHighlights();

  assert.equal(rowFor(win, '1').querySelector('.isa-duplicate-customer-chip'), null);
  assert.equal(rowFor(win, '1').querySelector('.isa-row-chip-tray'), null);
});

test('the tray stays with a support-origin chip after the duplicate chip leaves', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.rememberInboundAddresses('1', ['support@brightwell.example']);
  win.refreshDuplicateCustomerHighlights();
  win.refreshSupportOriginHighlights();
  const origin = rowFor(win, '1').querySelector('.isa-support-origin-chip');
  assert.ok(origin, 'the support-origin chip exists');

  rowFor(win, '2').remove();
  win.refreshDuplicateCustomerHighlights();

  const tray = rowFor(win, '1').querySelector('.isa-row-chip-tray');
  assert.ok(tray, 'the tray is kept');
  assert.equal(rowFor(win, '1').querySelector('.isa-duplicate-customer-chip'), null);
  assert.equal(origin.parentElement, tray);
});

test('a kept duplicate chip stranded outside the tray goes back into it', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const rowEl = rowFor(win, '1');
  const chip = rowEl.querySelector('.isa-duplicate-customer-chip');
  rowEl.appendChild(chip);
  assert.equal(chip.parentElement, rowEl);

  win.refreshDuplicateCustomerHighlights();

  const tray = rowEl.querySelector('.isa-row-chip-tray');
  assert.ok(tray);
  assert.equal(rowEl.querySelectorAll('.isa-duplicate-customer-chip').length, 1);
  assert.equal(rowEl.querySelector('.isa-duplicate-customer-chip'), chip);
  assert.equal(chip.parentElement, tray);
});

test('strip memory does not carry across a customer change of the open conversation', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)], { url: urlFor('900') });
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(stripHrefs(win), ['900', '901', '902']);

  listOf(win).innerHTML = row('900', TAMSIN) + row('902', TAMSIN);
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(stripHrefs(win), ['900', '901', '902'], '901 is remembered');

  listOf(win).innerHTML = row('900', MORGAN) + row('902', TAMSIN) + row('903', MORGAN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(stripHrefs(win), ['900', '903']);
});
