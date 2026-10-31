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
  CONTACT_A,
  deliverIdentities,
} = require('../support/duplicate-conversations-harness');

const styleText = win => win.document.getElementById('isa-duplicate-customer-style').textContent;

const slotColours = (css, slot) => {
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(darkAt > 0, 'a dark media block exists');
  const read = (scope) => {
    const match = scope.match(new RegExp(`\\.isa-dup-c${slot}\\s*\\{[^}]*?--isa-dup-hue:\\s*(#[0-9a-fA-F]+);\\s*--isa-dup-ink:\\s*(#[0-9a-fA-F]+);`));
    assert.ok(match, `slot ${slot} declared in scope`);
    return { hue: match[1].toLowerCase(), ink: match[2].toLowerCase() };
  };
  return { light: read(css.slice(0, darkAt)), dark: read(css.slice(darkAt)) };
};

const withoutConversationId = html => html.replace(/\sdata-conversation-id="[^"]*"/, '');

const forgetMany = (win, ids) => ids.forEach(id => win.forgetDuplicateConversation(id));

const fillerIds = (count, prefix = 'f') => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

test('hue slot 1 uses its light colour and ink in light mode and its dark pair in dark mode', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const colours = slotColours(styleText(win), 1);

  assert.deepEqual(colours.light, { hue: '#c2255c', ink: '#ffffff' });
  assert.deepEqual(colours.dark, { hue: '#f06595', ink: '#16161a' });
});

test('hue slot 4 keeps its own light and dark colours, not slot 1', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const colours = slotColours(styleText(win), 4);

  assert.deepEqual(colours.light, { hue: '#e8590c', ink: '#ffffff' });
  assert.deepEqual(colours.dark, { hue: '#ff922b', ink: '#16161a' });
});

test('the last base-palette slot 6 keeps its own light and dark colours', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const css = styleText(win);
  const colours = slotColours(css, 6);

  assert.deepEqual(colours.light, { hue: '#0c8599', ink: '#ffffff' });
  assert.deepEqual(colours.dark, { hue: '#3bc9db', ink: '#16161a' });
  assert.equal(/\.isa-dup-c7\s*\{/.test(css), false, 'the base palette ends at six slots');
});

test('light and dark hues differ for every slot, so no slot reuses one colour in both modes', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const css = styleText(win);
  for (let slot = 1; slot <= 6; slot += 1) {
    const colours = slotColours(css, slot);
    assert.notEqual(colours.light.hue, colours.dark.hue, `slot ${slot} hue`);
    assert.notEqual(colours.light.ink, colours.dark.ink, `slot ${slot} ink`);
  }
});

test('two rows of different customers with the same avatar text but different names do not group', () => {
  const win = build([
    row('1', TAMSIN, { initial: 'AB' }),
    row('2', MERROW, { initial: 'AB' })
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false);
  assert.equal(isMarked(win, '2'), false);
  assert.equal(win.customerKeyFromRow(rowFor(win, '1')), TAMSIN.toLowerCase());
  assert.equal(win.customerKeyFromRow(rowFor(win, '2')), MERROW.toLowerCase());
});

test('two rows of the same customer with different avatar text still group', () => {
  const win = build([
    row('1', TAMSIN, { initial: 'XY' }),
    row('2', WREN),
    row('3', TAMSIN, { initial: 'ZW' })
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '3'), '⧉2');
  assert.equal(isMarked(win, '2'), false);
});

test('avatar text in the modern shadow list never becomes the key, even ahead of the name', () => {
  const win = buildModern();
  const rows = modernRows(win);
  rows[0].querySelector('[data-testid="avatar-fallback"]').textContent = 'Zed';
  rows[2].querySelector('[data-testid="avatar-fallback"]').textContent = 'Yan';
  rows[3].querySelector('[data-testid="avatar-fallback"]').textContent = 'Zed';
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.customerKeyFromRow(rows[0]), 'juno example brightwell');
  assert.equal(win.customerKeyFromRow(rows[3]), 'maren example brightwell');
  assert.equal(rows[0].querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');
  assert.equal(rows[2].querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');
  assert.equal(rows[3].querySelector('.isa-duplicate-customer-chip'), null);
});

test('the injected chip text is never read back as the key on a later pass', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', WREN), row('4', WREN)]);
  win.refreshDuplicateCustomerHighlights();
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.customerKeyFromRow(rowFor(win, '1')), TAMSIN.toLowerCase());
  assert.equal(win.customerKeyFromRow(rowFor(win, '3')), WREN.toLowerCase());
  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '3'), '⧉2');
});

test('different customers who share the avatar initial A do not group', () => {
  const win = build([
    row('1', 'Anna Lee', { initial: 'A' }),
    row('2', 'Alex Ray', { initial: 'A' }),
    row('3', 'Anna Lee', { initial: 'A' })
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '3'), '⧉2');
  assert.equal(isMarked(win, '2'), false, 'Alex shares only the initial with Anna');
});

test('a lone single-character piece never becomes the key', () => {
  const win = build([
    row('1', 'A', { initial: '', subject: '', preview: '', age: '' }),
    row('2', 'A', { initial: '', subject: '', preview: '', age: '' })
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.customerKeyFromRow(rowFor(win, '1')), null);
  assert.equal(isMarked(win, '1'), false);
  assert.equal(isMarked(win, '2'), false);
});

test('a single-character piece outside the avatar is skipped in favour of the full name', () => {
  const inline = (id, name) => row(id, name, { initial: '' })
    .replace('<div class="flex min-w-0 mr-2">', '<div class="flex min-w-0 mr-2"><span>A</span>');
  const win = build([inline('1', 'Anna Lee'), inline('2', 'Alex Ray')]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.customerKeyFromRow(rowFor(win, '1')), 'anna lee');
  assert.equal(win.customerKeyFromRow(rowFor(win, '2')), 'alex ray');
  assert.equal(isMarked(win, '1'), false);
  assert.equal(isMarked(win, '2'), false);
});

test('the chip tray is placed beside the name element that holds the full name, not the initial', () => {
  const win = build([row('1', 'Anna Lee', { initial: 'A' }), row('2', 'Anna Lee', { initial: 'A' })]);
  win.refreshDuplicateCustomerHighlights();

  const rowEl = rowFor(win, '1');
  const name = rowEl.querySelector('.font-semibold');
  const tray = rowEl.querySelector('.isa-row-chip-tray');
  assert.equal(name.textContent, 'Anna Lee');
  assert.ok(tray, 'tray rendered');
  assert.equal(tray.parentElement, name.parentElement);
  assert.equal(rowEl.querySelector('.inbox2__avatar').contains(tray), false);
});

test('a two-character piece is a valid name, the single-character cut-off is exactly one', () => {
  const win = build([row('1', 'Al', { initial: '' }), row('2', 'Al', { initial: '' })]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.customerKeyFromRow(rowFor(win, '1')), 'al');
  assert.equal(chipText(win, '1'), '⧉2');
});

test('rows without a conversation id never join a group', () => {
  const win = build([
    row('1', TAMSIN),
    withoutConversationId(row('x', TAMSIN)),
    row('2', WREN)
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false, 'the idless row is not a sibling');
  assert.equal(win.document.querySelectorAll('.isa-duplicate-customer-chip').length, 0);
});

test('two idless rows of the same customer form no group', () => {
  const win = build([
    withoutConversationId(row('x', TAMSIN)),
    withoutConversationId(row('y', TAMSIN)),
    row('1', WREN)
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.document.querySelectorAll('.isa-duplicate-customer-chip').length, 0);
  assert.equal(win.document.querySelectorAll('.isa-duplicate-customer-row').length, 0);
});

test('an idless row does not inflate the count of a real group', () => {
  const win = build([
    row('1', TAMSIN),
    withoutConversationId(row('x', TAMSIN)),
    row('2', TAMSIN)
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '2'), '⧉2');
});

test('a closed conversation leaves its group on the next name-path refresh and the count shrinks', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, '3'), '⧉3');

  win.forgetDuplicateConversation('3');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '3'), false);
  assert.equal(chipText(win, '3'), null);
  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '2'), '⧉2');
});

test('forgetting one of a pair dissolves the group on the name path', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  win.forgetDuplicateConversation('2');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false);
  assert.equal(isMarked(win, '2'), false);
});

test('a closed conversation leaves its group on the next refresh on the identity path', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW), row('3', WREN)]);
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_A]]);
  assert.equal(chipText(win, '3'), '⧉3');

  win.forgetDuplicateConversation('3');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '3'), false);
  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '2'), '⧉2');
});

test('a reopened conversation rejoins its group on the next refresh on the name path', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  win.forgetDuplicateConversation('3');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '3'), false);

  win.rememberDuplicateConversationOpen('3');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '3'), '⧉3');
  assert.equal(chipText(win, '1'), '⧉3');
});

test('a reopened conversation rejoins its group on the next refresh on the identity path', () => {
  const win = build([row('1', TAMSIN), row('2', MERROW), row('3', WREN)]);
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_A]]);
  win.forgetDuplicateConversation('3');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '3'), false);

  win.rememberDuplicateConversationOpen('3');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '3'), '⧉3');
  assert.equal(chipText(win, '2'), '⧉3');
});

test('reopening a conversation that was never forgotten changes nothing', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  win.rememberDuplicateConversationOpen('2');
  win.rememberDuplicateConversationOpen('999');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(chipText(win, '2'), '⧉2');
});

test('forgetting a conversation twice then reopening it once rejoins the group', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', TAMSIN)]);
  win.forgetDuplicateConversation('3');
  win.forgetDuplicateConversation('3');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '3'), false);

  win.rememberDuplicateConversationOpen('3');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, '3'), '⧉3');
});

test('after 501 distinct forgets the first is no longer closed and the second still is', () => {
  const win = build([row('a1', TAMSIN), row('a2', TAMSIN), row('a3', TAMSIN)]);
  forgetMany(win, ['a1', 'a2', ...fillerIds(499)]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, 'a1'), '⧉2', 'the oldest forget was evicted, so a1 groups again');
  assert.equal(chipText(win, 'a3'), '⧉2');
  assert.equal(isMarked(win, 'a2'), false, 'the second oldest is still closed');
});

test('exactly 500 forgets keep all 500 closed, including the first', () => {
  const win = build([row('a1', TAMSIN), row('a2', TAMSIN), row('a3', TAMSIN)]);
  forgetMany(win, ['a1', 'a2', ...fillerIds(498)]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, 'a1'), false);
  assert.equal(isMarked(win, 'a2'), false);
  assert.equal(isMarked(win, 'a3'), false, 'a3 is alone because a1 and a2 are still closed');
});

test('the 500th forgotten id is itself remembered as closed', () => {
  const win = build([row('a1', TAMSIN), row('a2', TAMSIN), row('a3', TAMSIN)]);
  forgetMany(win, [...fillerIds(499), 'a1']);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, 'a1'), false);
  assert.equal(chipText(win, 'a2'), '⧉2');
});

test('a 502nd forget evicts the second as well, keeping only the newest 500', () => {
  const win = build([row('a1', TAMSIN), row('a2', TAMSIN), row('a3', TAMSIN), row('a4', TAMSIN)]);
  forgetMany(win, ['a1', 'a2', ...fillerIds(498), 'a3']);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, 'a1'), true, 'a1 evicted after 501');
  assert.equal(isMarked(win, 'a2'), false, 'a2 still within the newest 500');

  win.forgetDuplicateConversation('extra');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, 'a1'), '⧉3');
  assert.equal(chipText(win, 'a4'), '⧉3');
  assert.equal(isMarked(win, 'a2'), true, 'a2 evicted after 502');
});

test('re-forgetting an already forgotten id does not count as a new entry', () => {
  const win = build([row('a1', TAMSIN), row('a2', TAMSIN), row('a3', TAMSIN)]);
  forgetMany(win, ['a1', 'a2', ...fillerIds(498), 'a2', 'a1']);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, 'a1'), false);
  assert.equal(isMarked(win, 'a2'), false);
  assert.equal(isMarked(win, 'a3'), false);
});

const strip = win => win.document.querySelector('.isa-duplicate-customer-strip');

const stripLinks = win => Array.from(strip(win).querySelectorAll('a'), a => a.getAttribute('href'));

test('closing a sibling of the open conversation removes it from the strip', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(stripLinks(win).length, 3);

  win.forgetDuplicateConversation('901');
  win.refreshDuplicateCustomerHighlights();

  const hrefs = stripLinks(win);
  assert.equal(hrefs.length, 2);
  assert.ok(hrefs.some(h => h.includes('/conversation/900')), 'the open conversation stays');
  assert.ok(hrefs.some(h => h.includes('/conversation/902')));
  assert.ok(!hrefs.some(h => h.includes('/conversation/901')), 'the closed sibling is gone');
  assert.match(strip(win).textContent, /2 open conversations from this customer/);
});

test('closing the only sibling of the open conversation removes the strip', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.ok(strip(win));

  win.forgetDuplicateConversation('901');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(strip(win), null);
});

test('forgetting the open conversation itself clears the strip', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.ok(strip(win));

  win.forgetDuplicateConversation('900');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(strip(win), null);
  assert.equal(chipText(win, '901'), '⧉2', 'the remaining siblings still group on the rows');
});

test('reopening the forgotten sibling puts it back in the strip', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  win.forgetDuplicateConversation('901');
  win.refreshDuplicateCustomerHighlights();
  assert.equal(stripLinks(win).length, 2);

  win.rememberDuplicateConversationOpen('901');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(stripLinks(win).length, 3);
  assert.ok(stripLinks(win).some(h => h.includes('/conversation/901')));
});
