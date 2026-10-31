'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TAMSIN,
  build,
  row,
  rowFor,
  buildModern,
  modernRows,
} = require('../support/duplicate-conversations-harness');

test('the chip tray is laid out horizontally, so a decorated row grows no taller', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  const css = win.document.getElementById('isa-duplicate-customer-style').textContent;
  const tray = css.slice(css.indexOf('.isa-row-chip-tray'));
  const block = tray.slice(0, tray.indexOf('}'));

  assert.match(block, /flex-direction:\s*row/,
    'a column tray stacks the chips and overflows the fixed row height Intercom sets');
  assert.doesNotMatch(block, /margin-top/,
    'the tray shares the title line, so it must add no vertical margin');
});

test('two chips share one tray on the title line', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  const rowEl = rowFor(win, '1');
  const trays = rowEl.querySelectorAll('.isa-row-chip-tray');
  assert.equal(trays.length, 1);
  assert.equal(trays[0].parentElement, rowEl.querySelector('.font-semibold').parentElement);
});

test('the modern badge sits beside the name, not inside the truncating wrapper', () => {
  const win = buildModern();
  win.refreshDuplicateCustomerHighlights();

  const rowEl = modernRows(win)[0];
  const meta = rowEl.querySelector('[data-testid="conversation-list-row-meta"]');
  const wrapper = meta.querySelector('.truncate');
  const tray = rowEl.querySelector('.isa-row-chip-tray');

  assert.ok(tray, 'the tray is rendered');
  assert.equal(tray.parentElement, meta,
    'a tray inside .truncate is clipped and wraps the badge under the name');
  assert.equal(wrapper.contains(tray), false);
  assert.equal(wrapper.nextSibling, tray, 'the badge follows the name it belongs to');
});

test('a long customer name truncates around the badge instead of hiding it', () => {
  const win = buildModern();
  win.refreshDuplicateCustomerHighlights();

  const rowEl = modernRows(win)[1];
  const name = rowEl.querySelector('[data-testid="conversation-list-row-meta"] .truncate');
  assert.ok(name.textContent.length > 30, 'the fixture row carries a long name');
  assert.equal(rowEl.querySelector('.isa-duplicate-customer-chip').textContent, '⧉2');

  const css = win.document.getElementById('isa-duplicate-customer-style').textContent;
  const tray = css.slice(css.indexOf('.isa-row-chip-tray'));
  const block = tray.slice(0, tray.indexOf('}'));
  assert.match(block, /flex:\s*0 0 auto/,
    'a shrinkable tray lets the badge collapse when the name is long');
  assert.match(block, /margin-right:\s*auto/,
    'without it justify-between floats the badge away from the name');
});

test('the full-card overlay preserves Intercom hover and selected backgrounds', () => {
  const win = buildModern();
  win.refreshDuplicateCustomerHighlights();

  const css = win.document.getElementById('isa-duplicate-customer-style').textContent;
  const start = css.indexOf('.isa-duplicate-customer-row {');
  const block = css.slice(start, css.indexOf('}', start));

  assert.doesNotMatch(block, /background/,
    'an !important row background overrides the hover and selected row colours');
  assert.match(block, /position:\s*relative/);
  assert.match(css, /\.isa-duplicate-customer-row::before/,
    'the group overlay uses the rounded card bounds');
  const overlayStart = css.indexOf('.isa-duplicate-customer-row::before {');
  const overlay = css.slice(overlayStart, css.indexOf('}', overlayStart));
  assert.match(overlay, /inset:\s*0;/);
  assert.match(overlay, /border:\s*1px solid var\(--isa-dup-hue\)/);
  assert.match(overlay, /border-radius:\s*inherit/);
  assert.match(overlay, /background-color:\s*color-mix\(in srgb, var\(--isa-dup-hue\) 8%, transparent\)/);
  assert.match(overlay, /pointer-events:\s*none/);
  const dashedStart = css.indexOf('.isa-duplicate-customer-row.isa-dup-dashed::before {');
  const dashed = css.slice(dashedStart, css.indexOf('}', dashedStart));
  assert.match(dashed, /border-style:\s*dashed/);
  assert.doesNotMatch(dashed, /background/);
  const selected = modernRows(win)[0];
  assert.equal(selected.getAttribute('aria-selected'), 'true');
  assert.equal(selected.querySelector('[data-testid="conversation-list-row-close"]').getAttribute('aria-label'), 'Close');
});

test('the duplicate overlay and the support underline use different pseudo-elements', () => {
  const win = buildModern();
  win.rememberInboundAddresses('modern-1', ['support@example.com']);
  win.refreshDuplicateCustomerHighlights();
  win.refreshSupportOriginHighlights();

  const rowEl = modernRows(win)[0];
  assert.equal(rowEl.classList.contains('isa-duplicate-customer-row'), true);
  assert.equal(rowEl.classList.contains('isa-support-origin-row'), true);

  const duplicateCss = win.document.getElementById('isa-duplicate-customer-style').textContent;
  const originCss = win.document.getElementById('isa-support-origin-style').textContent;
  assert.match(duplicateCss, /\.isa-duplicate-customer-row::before/);
  assert.match(originCss, /\.isa-support-origin-row::after/);
  assert.doesNotMatch(duplicateCss, /\.isa-duplicate-customer-row::after/);
});

test('the composer banner is a quiet line with pill links, not a bordered box', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  const css = win.document.getElementById('isa-duplicate-customer-style').textContent;
  const start = css.indexOf('.isa-duplicate-customer-strip {');
  const block = css.slice(start, css.indexOf('}', start));
  assert.doesNotMatch(block, /border/);
  assert.doesNotMatch(block, /background/);

  const strip = win.document.querySelector('.isa-duplicate-customer-strip');
  assert.equal(strip.querySelector('.isa-duplicate-customer-strip-glyph').textContent, '⧉');
  assert.equal(
    strip.querySelector('.isa-duplicate-customer-strip-label').textContent,
    '2 open conversations from this customer'
  );
  assert.match(css, /\.isa-duplicate-customer-strip a\[aria-current="true"\]/);
  assert.doesNotMatch(css, /text-decoration:\s*underline/);
});
