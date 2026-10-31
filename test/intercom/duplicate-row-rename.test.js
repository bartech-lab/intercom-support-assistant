'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TAMSIN,
  build,
  row,
  rowFor,
  isMarked,
  chipText,
} = require('../support/duplicate-conversations-harness');

const VISITOR = 'visitor 77';
const MORGAN = 'morgan lee';

const nameEl = (win, id) => rowFor(win, id).querySelector('.font-semibold');
const hasChip = (win, id) => rowFor(win, id).querySelector('.isa-duplicate-customer-chip') !== null;

test('a row renamed in place into a group joins it', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', VISITOR)]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hasChip(win, '1'), true, 'row 1 has a chip before the rename');
  assert.equal(hasChip(win, '2'), true, 'row 2 has a chip before the rename');
  assert.equal(hasChip(win, '3'), false, 'row 3 has no chip before the rename');

  const rowEl = rowFor(win, '3');
  nameEl(win, '3').textContent = TAMSIN;
  win.refreshDuplicateCustomerHighlights();

  assert.equal(rowFor(win, '3'), rowEl, 'the row element is the same');
  assert.equal(hasChip(win, '3'), true, 'row 3 has a chip after the rename');
  assert.equal(isMarked(win, '3'), true, 'row 3 is marked after the rename');
  ['1', '2', '3'].forEach(id => assert.equal(chipText(win, id), '⧉3', `group size on row ${id}`));
});

test('a row renamed in place out of a group leaves it', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hasChip(win, '1'), true, 'row 1 has a chip before the rename');
  assert.equal(hasChip(win, '2'), true, 'row 2 has a chip before the rename');

  nameEl(win, '2').textContent = MORGAN;
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hasChip(win, '1'), false, 'row 1 has no chip after the rename');
  assert.equal(hasChip(win, '2'), false, 'row 2 has no chip after the rename');
  assert.equal(isMarked(win, '1'), false, 'row 1 is not marked after the rename');
  assert.equal(isMarked(win, '2'), false, 'row 2 is not marked after the rename');
});

test('control: replacing a row with a differently named new row ungroups the other', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(hasChip(win, '1'), true, 'row 1 has a chip before the replacement');

  const second = rowFor(win, '2');
  const list = second.parentElement;
  second.remove();
  list.insertAdjacentHTML('beforeend', row('3', MORGAN));
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hasChip(win, '1'), false, 'row 1 has no chip');
  assert.equal(hasChip(win, '3'), false, 'row 3 has no chip');
});
