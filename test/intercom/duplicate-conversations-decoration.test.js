'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, hydrateShadowRoots } = require('../support/helpers');
const fx = require('../support/fixtures');
const {
  inboxUrl,
  TAMSIN,
  MERROW,
  WREN,
  build,
  row,
  rowFor,
  isMarked,
  chipText,
} = require('../support/duplicate-conversations-harness');

const hueClassOf = (win, conversationId) =>
  [...rowFor(win, conversationId).classList].find(c => /^isa-dup-c\d$/.test(c));

const isDashed = (win, conversationId) =>
  rowFor(win, conversationId).classList.contains('isa-dup-dashed');

test('a URL without a team id leaves existing decoration and styles untouched', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', MERROW), row('4', MERROW)]);
  win.refreshDuplicateCustomerHighlights();
  const hueBefore = hueClassOf(win, '1');
  const otherBefore = hueClassOf(win, '3');

  win.history.replaceState({}, '', 'https://app.intercom.com/a/inbox/demo1234/inbox/conversation/1?view=List');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), true, 'decoration must survive a team-less URL');
  assert.equal(chipText(win, '1'), '⧉2');
  assert.equal(hueClassOf(win, '1'), hueBefore, 'and must not be reassigned a new hue');
  assert.equal(hueClassOf(win, '3'), otherBefore);

  win.history.replaceState({}, '', inboxUrl);
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = [row('3', MERROW), row('4', MERROW), row('1', TAMSIN), row('2', TAMSIN)].join('\n');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hueClassOf(win, '1'), hueBefore, 'a group rendered in another order keeps its hue');
  assert.equal(hueClassOf(win, '3'), otherBefore);
});

test('style numbering does not restart after a team-less URL', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const first = hueClassOf(win, '1');

  win.history.replaceState({}, '', 'https://app.intercom.com/a/inbox/demo1234/inbox/conversation/1?view=List');
  win.refreshDuplicateCustomerHighlights();
  win.history.replaceState({}, '', inboxUrl);

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = [row('3', MERROW), row('4', MERROW), row('1', TAMSIN), row('2', TAMSIN)].join('\n');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hueClassOf(win, '1'), first, 'the first group keeps its hue');
  assert.notEqual(hueClassOf(win, '3'), first, 'the next group does not collide with it');
});

test('nothing is decorated when the URL carries no team id', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], {
    url: 'https://app.intercom.com/a/inbox/demo1234/inbox/conversation/900?view=List'
  });
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false);
  assert.equal(isMarked(win, '2'), false);
});

test('the style is injected into both the document and the shadow root', () => {
  const win = loadExtension(
    fx.inboxHtml({ list: fx.conversationList([row('1', TAMSIN), row('2', TAMSIN)]) }),
    {
      url: inboxUrl,
      beforeScripts(w) {
        const host = w.document.createElement('div');
        host.id = 'teammate-app-react';
        host.attachShadow({ mode: 'open' });
        w.document.body.appendChild(host);
      }
    }
  );
  win.refreshDuplicateCustomerHighlights();

  const documentStyle = win.document.getElementById('isa-duplicate-customer-style');
  const shadowStyle = win.document.querySelector('#teammate-app-react')
    .shadowRoot.querySelector('#isa-duplicate-customer-style');
  assert.ok(documentStyle, 'document style');
  assert.ok(shadowStyle, 'shadow root style');
  assert.match(documentStyle.textContent, /--isa-dup-hue: #c2255c/);
  assert.match(documentStyle.textContent, /@media \(prefers-color-scheme: dark\)/);
  assert.match(documentStyle.textContent, /--isa-dup-hue: #f06595/);
});

test('each group gets its own hue, and both rows of a group share it', () => {
  const win = build([
    row('1', TAMSIN), row('2', MERROW), row('3', TAMSIN), row('4', MERROW)
  ]);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hueClassOf(win, '1'), hueClassOf(win, '3'), 'one group, one hue');
  assert.equal(hueClassOf(win, '2'), hueClassOf(win, '4'));
  assert.notEqual(hueClassOf(win, '1'), hueClassOf(win, '2'), 'different groups differ');
});

test('the first six groups are solid and sweep every hue before any dashing', () => {
  const customers = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const rows = customers.flatMap((p, i) => [row(`${i}a`, `${p}`), row(`${i}b`, `${p}`)]);
  const win = build(rows);
  win.refreshDuplicateCustomerHighlights();

  const hues = customers.map((_, i) => hueClassOf(win, `${i}a`));
  assert.equal(new Set(hues).size, 6, 'six groups use six distinct hues');
  customers.forEach((_, i) => assert.equal(isDashed(win, `${i}a`), false, `group ${i} solid`));
});

test('the seventh group starts the dashed sweep, reusing the first hue', () => {
  const customers = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const rows = customers.flatMap((p, i) => [row(`${i}a`, `${p}`), row(`${i}b`, `${p}`)]);
  const win = build(rows);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hueClassOf(win, '6a'), hueClassOf(win, '0a'), 'hue 1 comes round again');
  assert.equal(isDashed(win, '6a'), true, 'but dashed, so the pair stays distinguishable');
  assert.equal(isDashed(win, '0a'), false);
});

test('a group keeps its style when other groups appear later', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const before = hueClassOf(win, '1');

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = [
    row('3', MERROW), row('4', MERROW), row('1', TAMSIN), row('2', TAMSIN)
  ].join('\n');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hueClassOf(win, '1'), before, 'an existing group is never repainted');
  assert.notEqual(hueClassOf(win, '3'), before, 'the new group takes the next hue');
});

test('styles reset on inbox change so the next inbox starts from the first hue', () => {
  const win = build([row('1', 'zzz other'), row('2', 'zzz other')]);
  win.refreshDuplicateCustomerHighlights();

  win.history.replaceState({}, '', 'https://app.intercom.com/a/inbox/demo1234/inbox/team/999/conversation/901?view=List');
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = [row('3', TAMSIN), row('4', TAMSIN)].join('\n');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(hueClassOf(win, '3'), 'isa-dup-c1');
  assert.equal(isDashed(win, '3'), false);
});

test('a cleared row keeps no hue or dash class behind', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', WREN)]);
  win.refreshDuplicateCustomerHighlights();

  rowFor(win, '2').setAttribute('data-conversation-id', '9');
  rowFor(win, '9').querySelector('.font-semibold').textContent = 'Solo Customer';
  win.refreshDuplicateCustomerHighlights();

  const classes = [...rowFor(win, '9').classList];
  assert.ok(!classes.some(c => /^isa-dup-c\d$/.test(c)), 'no stale hue class');
  assert.ok(!classes.includes('isa-dup-dashed'), 'no stale dash class');
});

test('a row recycled onto a different customer is re-decorated, not skipped', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', MERROW)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, '1'), '⧉2');

  rowFor(win, '3').setAttribute('data-conversation-id', '4');
  rowFor(win, '4').querySelector('.line-clamp-1').textContent = TAMSIN;
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '4'), '⧉3', 'the recycled row joins the group');
  assert.equal(chipText(win, '1'), '⧉3', 'and the existing rows update their count');
});

test('a decorated row recycled onto another customer of the same group size is re-decorated, not skipped', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', MERROW), row('4', MERROW), row('5', MERROW)]);
  win.refreshDuplicateCustomerHighlights();
  const staleChip = rowFor(win, '5').querySelector('.isa-duplicate-customer-chip');
  assert.equal(staleChip.textContent, '⧉3');
  const firstGroupHue = hueClassOf(win, '5');

  rowFor(win, '5').setAttribute('data-conversation-id', '6');
  rowFor(win, '6').querySelector('.line-clamp-1').textContent = TAMSIN;
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '6'), '⧉3', 'the recycled row joins the three-row group');
  assert.notEqual(rowFor(win, '6').querySelector('.isa-duplicate-customer-chip'), staleChip, 'the old customer chip is replaced');
  assert.equal(hueClassOf(win, '6'), hueClassOf(win, '1'), 'it takes the new customer hue');
  assert.notEqual(hueClassOf(win, '6'), firstGroupHue);
  assert.match(rowFor(win, '6').getAttribute('data-isa-duplicate-group'), /^tamsin sorrel/, 'its marker names the new customer');
});

test('a cleared row from a dashed group keeps no hue or dash class behind', () => {
  const customers = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const rows = customers.flatMap((p, i) => [row(`${i}a`, `${p}`), row(`${i}b`, `${p}`)]);
  const win = build(rows);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isDashed(win, '6b'), true, 'precondition: the seventh group is dashed');

  rowFor(win, '6b').setAttribute('data-conversation-id', '99');
  rowFor(win, '99').querySelector('.font-semibold').textContent = 'Solo Customer';
  win.refreshDuplicateCustomerHighlights();

  const classes = [...rowFor(win, '99').classList];
  assert.ok(!classes.some(c => /^isa-dup-c\d$/.test(c)), 'no stale hue class');
  assert.ok(!classes.includes('isa-dup-dashed'), 'no stale dash class');
});

test('the injected chip is never read back as the customer name', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  const chip = rowFor(win, '1').querySelector('.isa-duplicate-customer-chip');
  assert.ok(chip.compareDocumentPosition(rowFor(win, '1').querySelector('.font-semibold'))
    & win.Node.DOCUMENT_POSITION_PRECEDING,
    'the chip sits after the name on the title line');

  assert.equal(win.customerKeyFromRow(rowFor(win, '1')), TAMSIN.toLowerCase(),
    'a decorated row still resolves to the customer, not to the chip text');

  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, '1'), '⧉2', 'the group survives a second pass over decorated rows');
});

test('a row stripped of its classes by a re-render gets its colour back', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const hue = hueClassOf(win, '1');

  rowFor(win, '1').className = 'ember-view group';
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), true, 'a chip without a rail is the broken state');
  assert.equal(hueClassOf(win, '1'), hue);
  assert.equal(rowFor(win, '1').querySelectorAll('.isa-duplicate-customer-chip').length, 1);
});

test('a decoration pass never stacks duplicate chips', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  win.refreshDuplicateCustomerHighlights();
  win.refreshDuplicateCustomerHighlights();

  assert.equal(rowFor(win, '1').querySelectorAll('.isa-duplicate-customer-chip').length, 1);
});

test('closing one conversation shrinks the group instead of leaving a stale count', () => {
  const win = build([row('1', MERROW), row('2', MERROW), row('3', MERROW)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(chipText(win, '1'), '⧉3');

  rowFor(win, '3').remove();
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2', 'the handled conversation stops being counted');
  assert.equal(chipText(win, '2'), '⧉2');
});

test('closing all but one clears the marking entirely', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(isMarked(win, '1'), true);

  rowFor(win, '2').remove();
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '1'), false, 'a lone conversation is no longer a duplicate');
  assert.equal(chipText(win, '1'), null);
});

test('an empty list is a rebuilding list, not an emptied inbox', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = '';
  win.refreshDuplicateCustomerHighlights();
  list.innerHTML = [row('1', TAMSIN), row('2', TAMSIN)].join('\n');
  win.refreshDuplicateCustomerHighlights();

  assert.equal(chipText(win, '1'), '⧉2', 'the group survives a momentarily empty render');
});

test('group state does not leak across inboxes', () => {
  const win = build([row('1', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  win.history.replaceState({}, '', 'https://app.intercom.com/a/inbox/demo1234/inbox/team/999/conversation/901?view=List');
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row('2', TAMSIN);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(isMarked(win, '2'), false, 'a different inbox starts from an empty group map');
});

test('a settled duplicate pass changes nothing in the document', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', MERROW), row('4', WREN)]);
  win.refreshDuplicateCustomerHighlights();
  const chip = rowFor(win, '1').querySelector('.isa-duplicate-customer-chip');
  const observer = new win.MutationObserver(() => {});
  observer.observe(win.document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  win.refreshDuplicateCustomerHighlights();
  win.refreshDuplicateCustomerHighlights();
  const records = observer.takeRecords();
  observer.disconnect();
  assert.deepEqual(records.map(record => `${record.type}:${record.attributeName || ''}`), []);
  assert.equal(rowFor(win, '1').querySelector('.isa-duplicate-customer-chip'), chip);
  assert.equal(isMarked(win, '1'), true);
});
