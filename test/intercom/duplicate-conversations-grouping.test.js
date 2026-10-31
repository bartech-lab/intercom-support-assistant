'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TAMSIN,
  MERROW,
  WREN,
  build,
  row,
  rowFor,
  isMarked,
  chipText,
  buildModern,
  modernRows,
} = require('../support/duplicate-conversations-harness');

function addOverlappingLegacyContainer(win) {
  const listbox = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('[data-testid="conversation-listbox"]');
  const wrapper = win.document.createElement('div');
  wrapper.setAttribute('data-intercom-target-conversation-list', '');
  listbox.parentNode.replaceChild(wrapper, listbox);
  wrapper.appendChild(listbox);
}

test('two rows from the same customer are both marked with a group of 2', () => {
  const win = build([row('1', TAMSIN), row('2', WREN), row('3', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), true);
  assert.equal(isMarked(win, '3'), true);
  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '3'), '⧉2');
});

test('a customer with a single conversation is never marked', () => {
  const win = build([row('1', TAMSIN), row('2', WREN), row('3', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '2'), false);
  assert.equal(chipText(win, '2'), null);
});

test('three rows from the same customer all show a group of 3', () => {
  const win = build([row('1', MERROW), row('2', MERROW), row('3', MERROW)]);
  win.refreshDuplicateCustomerHighlights();

  ['1', '2', '3'].forEach((id) => {
    assert.equal(isMarked(win, id), true, id);
    assert.equal(chipText(win, id), '⧉3', id);
  });
});

test('duplicates separated by unrelated rows are all marked', () => {
  const win = build([
    row('1', TAMSIN),
    row('2', WREN),
    row('3', 'Felix Lorne'),
    row('4', TAMSIN),
    row('5', 'Mona Sandoval'),
    row('6', TAMSIN)
  ]);
  win.refreshDuplicateCustomerHighlights();

  ['1', '4', '6'].forEach(id => assert.equal(chipText(win, id), '⧉3', id));
  ['2', '3', '5'].forEach(id => assert.equal(isMarked(win, id), false, id));
});

test('several groups on screen each carry their own count', () => {
  const win = build([
    row('1', TAMSIN), row('2', MERROW), row('3', TAMSIN),
    row('4', MERROW), row('5', MERROW), row('6', WREN)
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '3'), '⧉2');
  assert.equal(chipText(win, '2'), '⧉3');
  assert.equal(chipText(win, '4'), '⧉3');
  assert.equal(chipText(win, '5'), '⧉3');
  assert.equal(isMarked(win, '6'), false);
});

test('the avatar initial is never mistaken for the customer name', () => {
  const win = build([
    row('1', TAMSIN, { initial: 'h' }),
    row('2', MERROW, { initial: 'd' })
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false, 'two different customers share no group');
  assert.equal(isMarked(win, '2'), false);
  assert.equal(win.customerKeyFromRow(rowFor(win, '1')), TAMSIN.toLowerCase());
});

test('a row with no avatar still resolves the customer name', () => {
  const win = build([row('1', TAMSIN, { initial: '' }), row('2', TAMSIN, { initial: '' })]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, '1'), '⧉2');
});

test('a customer whose name is an email address groups correctly', () => {
  const email = 'ivo.sample@example.com';
  const win = build([row('1', email), row('2', email), row('3', WREN)]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(isMarked(win, '3'), false);
});

test('name matching ignores case and whitespace differences', () => {
  const win = build([row('1', 'Corin Rookwood'), row('2', '  corin   rookwood ')]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, '1'), '⧉2');
});

test('rows whose only name is the brand are never grouped', () => {
  const win = build([row('1', 'alderpoint'), row('2', 'alderpoint'), row('3', 'alderpoint')]);
  win.refreshDuplicateCustomerHighlights();

  ['1', '2', '3'].forEach((id) => {
    assert.equal(isMarked(win, id), false, id);
    assert.equal(chipText(win, id), null, id);
  });
});

test('brand-only rows do not stop real duplicates in the same list from being marked', () => {
  const win = build([
    row('1', 'alderpoint'),
    row('2', TAMSIN),
    row('3', 'Brightwell'),
    row('4', TAMSIN),
    row('5', 'alderpoint')
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '2'), '⧉2');
  assert.equal(chipText(win, '4'), '⧉2');
  ['1', '3', '5'].forEach(id => assert.equal(isMarked(win, id), false, id));
});

test('a real name that merely contains the brand is still groupable', () => {
  const win = build([row('1', 'Kira Alderpoint'), row('2', 'Kira Alderpoint')]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(win.customerKeyIsGroupable('kira alderpoint'), true);
  assert.equal(win.customerKeyIsGroupable('alderpoint'), false);
  assert.equal(win.customerKeyIsGroupable('Alderpoint'), false);
});

test('modern shadow list restores duplicate marks and ignores avatar and SLA text', () => {
  const win = buildModern();
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.conversationListRows().length, 5);
  assert.equal(modernRows(win).filter(row => row.classList.contains('isa-duplicate-customer-row')).length, 4);
  assert.equal(win.customerKeyFromRow(modernRows(win)[0]), 'juno example brightwell');
  assert.equal(modernRows(win)[0].querySelectorAll('[data-testid="sla-badge"]').length, 1);
  assert.equal(modernRows(win)[0].querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');
  assert.equal(modernRows(win)[2].querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');
  win.rememberInboundAddresses('modern-1', ['support@example.com']);
  assert.equal(modernRows(win)[0].classList.contains('isa-support-origin-row'), true);
});

test('overlapping legacy and modern list containers count each row once', () => {
  const win = buildModern();
  addOverlappingLegacyContainer(win);
  assert.equal(win.conversationListRows().length, 5);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(modernRows(win)[0].querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');
});

test('modern closed and snoozed list transitions clear duplicate marks', () => {
  const win = buildModern();
  win.refreshDuplicateCustomerHighlights();
  assert.equal(modernRows(win)[0].classList.contains('isa-duplicate-customer-row'), true);

  const trigger = win.document.getElementById('teammate-app-react').shadowRoot
    .querySelector('[data-testid="state-filter-trigger"]');
  for (const state of ['Closed', 'Snoozed']) {
    trigger.textContent = `4 ${state}`;
    win.refreshDuplicateCustomerHighlights();
    assert.equal(modernRows(win).some(row => row.classList.contains('isa-duplicate-customer-row')), false, state);
  }
  trigger.textContent = '4 Open';
  win.refreshDuplicateCustomerHighlights();
  assert.equal(modernRows(win).filter(row => row.classList.contains('isa-duplicate-customer-row')).length, 4);
});
