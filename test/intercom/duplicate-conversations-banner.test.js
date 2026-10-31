'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  TEAM,
  TAMSIN,
  WREN,
  build,
  row,
  rowFor,
  chipText,
  CONTACT_A,
  CONTACT_B,
  deliverIdentities,
} = require('../support/duplicate-conversations-harness');

const stripLinkText = win =>
  [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')].map(a => a.textContent);

function deliverConversationState(win, conversationId, state) {
  win.dispatchEvent(new win.MessageEvent('message', {
    source: win,
    origin: 'https://app.intercom.com',
    data: { __isaic: true, version: 1, kind: 'conversation-state', conversationId, state }
  }));
}

const DARIO = 'Dario Corvo';
const DARIO_CONTACT = 'dddddddddddddddddddddddd';
const DARIO_EMAIL = 'dario.corvo@example.com';
const DARIO_OPEN = ['900202944779906', '900202944779905', '900202944779904', '900202944779903'];

const darioIdentities = DARIO_OPEN.map(id => [id, DARIO_CONTACT, DARIO_EMAIL]);

test('the banner survives the virtualised list unmounting every duplicate row', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`
  });
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(stripLinkText(win), ['1', '2'], 'both siblings are listed while mounted');

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row('902', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(stripLinkText(win), ['1', '2'],
    'scrolling the pair out of view must not remove the banner');
  assert.equal(
    win.document.querySelector('.isa-duplicate-customer-strip a[aria-current="true"]').textContent,
    '1',
    'the open conversation stays flagged'
  );
});

test('a partly unmounted group keeps every sibling in the banner', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`
  });
  win.refreshDuplicateCustomerHighlights();

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row('900', TAMSIN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(stripLinkText(win), ['1', '2'],
    'the open row alone must not shrink the group to one');
});

test('a sibling that leaves the list stays in the banner until the conversation changes', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`
  });
  win.refreshDuplicateCustomerHighlights();

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row('900', TAMSIN) + row('902', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(stripLinkText(win), ['1', '2'],
    'virtualisation makes a closed sibling and a scrolled-out sibling look identical, '
    + 'so the banner keeps it rather than blinking off mid-scroll');
});

test('opening a different conversation forgets the remembered group', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`
  });
  win.refreshDuplicateCustomerHighlights();
  assert.ok(win.document.querySelector('.isa-duplicate-customer-strip'));

  win.history.pushState({}, '', `/a/inbox/demo1234/inbox/team/${TEAM}/conversation/902?view=List`);
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row('902', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null,
    'a lone conversation must not inherit the previous banner');
});

test('a closed or snoozed list clears the remembered group', () => {
  for (const state of ['Closed', 'Snoozed']) {
    const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
      url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?view=List`
    });
    win.refreshDuplicateCustomerHighlights();
    assert.ok(win.document.querySelector('.isa-duplicate-customer-strip'), `the group is shown before: ${state}`);

    const trigger = win.document.querySelector('[data-intercom-target="filter-button"]');
    trigger.textContent = `4 ${state}`;
    win.refreshDuplicateCustomerHighlights();

    assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null, `a ${state} list clears it`);
  }
});

test('a duplicate that never rendered is still found through the list payload', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  assert.equal(chipText(win, '1'), '⧉2',
    'row 2 sits below the virtualised window, but the payload still proves the pair');
  assert.equal(chipText(win, '3'), null);
  assert.deepEqual(stripLinkText(win), ['1', '2'],
    'the banner lists the sibling that was never mounted');
});

test('the open group ignores identities learned from a closed or snoozed page', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['3', CONTACT_B]]);
  deliverIdentities(win, [['2', CONTACT_A]], { state: 'closed' });

  assert.equal(chipText(win, '1'), null,
    'a closed conversation must never count towards an open duplicate group');
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);
});

test('scrolling the whole group out of view keeps the payload-backed banner', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);
  assert.deepEqual(stripLinkText(win), ['1', '2']);

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row('3', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(stripLinkText(win), ['1', '2'],
    'the group comes from the payload now, so virtualisation cannot shrink it');
});

test('a payload-backed group still needs the open conversation to belong to it', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/3?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null,
    'the open conversation is the only one in its group');
});

test('clicking a sibling that is scrolled out never lets the browser navigate', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  const link = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .find(a => a.getAttribute('href').includes('/conversation/2'));
  assert.ok(link, 'the off-screen sibling is listed');

  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  link.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true,
    'a real navigation cold-boots Intercom, which drops the queue into All');
});

test('an off-screen sibling is reached by an in-app route change, not a page load', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  let popstates = 0;
  win.addEventListener('popstate', () => { popstates += 1; });

  const link = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .find(a => a.getAttribute('href').includes('/conversation/2'));
  link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

  assert.equal(win.location.pathname,
    `/a/inbox/demo1234/inbox/team/${TEAM}/conversation/2`,
    'the route moves to the sibling inside the same team inbox');
  assert.equal(win.location.search, '?view=List', 'the queue view survives');
  assert.equal(popstates, 1, 'the router is told the route changed');
});

test('the in-app route change keeps the folder so the queue survives', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?custom_folder_id=900613&view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  const link = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .find(a => a.getAttribute('href').includes('/conversation/2'));
  link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

  assert.equal(win.location.search, '?custom_folder_id=900613&view=List');
  assert.equal(win.location.pathname.includes(`/team/${TEAM}/`), true);
});

test('an on-screen sibling still goes through Intercom own row click', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A]]);

  let rowClicks = 0;
  let popstates = 0;
  rowFor(win, '2').addEventListener('click', () => { rowClicks += 1; });
  win.addEventListener('popstate', () => { popstates += 1; });

  const link = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .find(a => a.getAttribute('href').includes('/conversation/2'));
  link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

  assert.equal(rowClicks, 1, 'the proven path wins whenever the row is mounted');
  assert.equal(popstates, 0, 'and it does not also push a route');
});

test('a sibling reported closed leaves the banner at once', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);
  assert.deepEqual(stripLinkText(win), ['1', '2']);

  deliverConversationState(win, '2', 'closed');

  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null,
    'the group drops to one, so the banner goes');
  assert.equal(chipText(win, '1'), null, 'and the row stops claiming a duplicate');
});

test('a sibling reported open is left in the group', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  deliverConversationState(win, '2', 'open');

  assert.deepEqual(stripLinkText(win), ['1', '2']);
});

test('a snoozed sibling is dropped from the open group too', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  deliverConversationState(win, '2', 'snoozed');

  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);
});

test('closing the open conversation itself clears its own banner', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A]]);
  assert.ok(win.document.querySelector('.isa-duplicate-customer-strip'));

  deliverConversationState(win, '1', 'closed');

  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);
});

test('a bogus conversation state envelope changes nothing', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  deliverConversationState(win, '2', '<script>');
  deliverConversationState(win, 'not-an-id', 'closed');

  assert.deepEqual(stripLinkText(win), ['1', '2']);
});

test('bogus conversation ids never evict a genuinely closed conversation', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);
  deliverConversationState(win, '2', 'closed');
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);

  for (let i = 0; i < 600; i += 1) deliverConversationState(win, `not-an-id-${i}`, 'closed');
  deliverIdentities(win, [['2', CONTACT_A]]);

  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null,
    'conversation 2 is still closed, so it stays out of the group');
});

test('a sibling that reopens rejoins the group', () => {
  const win = build([row('1', TAMSIN), row('3', WREN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);

  deliverConversationState(win, '2', 'closed');
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);

  deliverConversationState(win, '2', 'open');
  deliverIdentities(win, [['2', CONTACT_A]]);

  assert.deepEqual(stripLinkText(win), ['1', '2'],
    'a reopened conversation is no longer suppressed');
});

test('a closed row still on screen is not mistaken for an unknown identity', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/1?view=List`
  });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A]]);

  deliverConversationState(win, '2', 'closed');

  assert.equal(chipText(win, '1'), null,
    'falling back to display names here would resurrect the closed pair');
  assert.equal(chipText(win, '2'), null);
});

test('all four of one customer open conversations count, with only two on screen', () => {
  const win = build([row(DARIO_OPEN[0], DARIO), row(DARIO_OPEN[1], DARIO)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/${DARIO_OPEN[0]}?view=List`,
    count: '113'
  });
  deliverIdentities(win, darioIdentities);

  assert.equal(chipText(win, DARIO_OPEN[0]), '⧉4');
  assert.equal(chipText(win, DARIO_OPEN[1]), '⧉4');
  assert.deepEqual(stripLinkText(win), ['1', '2', '3', '4']);
});

test('an unidentified row on screen no longer shrinks the group', () => {
  const win = build([
    row(DARIO_OPEN[0], DARIO),
    row(DARIO_OPEN[1], DARIO),
    row('900869203577922', 'Fresh Arrival')
  ], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/${DARIO_OPEN[0]}?view=List`,
    count: '113'
  });
  deliverIdentities(win, darioIdentities);

  assert.equal(chipText(win, DARIO_OPEN[0]), '⧉4',
    'the fresh row has no identity yet, which must not downgrade the whole inbox');
  assert.equal(chipText(win, '900869203577922'), null);
  assert.deepEqual(stripLinkText(win), ['1', '2', '3', '4']);
});

test('scrolling between the four keeps the same group on every one of them', () => {
  const win = build([row(DARIO_OPEN[0], DARIO), row(DARIO_OPEN[1], DARIO)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/${DARIO_OPEN[0]}?view=List`,
    count: '113'
  });
  deliverIdentities(win, darioIdentities);

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row(DARIO_OPEN[2], DARIO) + row(DARIO_OPEN[3], DARIO);

  for (const openId of DARIO_OPEN) {
    win.history.pushState({}, '', `/a/inbox/demo1234/inbox/team/${TEAM}/conversation/${openId}?view=List`);
    win.refreshDuplicateCustomerHighlights();

    assert.deepEqual(stripLinkText(win), ['1', '2', '3', '4'], `open ${openId}`);
    assert.equal(
      win.document.querySelector('.isa-duplicate-customer-strip a[aria-current="true"]').textContent,
      String(DARIO_OPEN.indexOf(openId) + 1),
      `the open one is flagged for ${openId}`
    );
  }
});
