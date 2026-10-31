'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const {
  TEAM,
  TAMSIN,
  MERROW,
  WREN,
  build,
  row,
  rowFor,
  chipText,
} = require('../support/duplicate-conversations-harness');

test('the strip lists the whole group, counting the open conversation', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', WREN)]);
  win.refreshDuplicateCustomerHighlights();

  const strip = win.document.querySelector('.isa-duplicate-customer-strip');
  assert.ok(strip, 'strip rendered');
  assert.match(strip.textContent, /2 open conversations from this customer/);
  assert.equal(strip.getAttribute('title'),
    '2 open conversations from this customer in this inbox');
  assert.deepEqual(
    Array.from(strip.querySelectorAll('a'), a => a.textContent),
    ['1', '2'],
    'every member of the group is listed, including the one already open'
  );
});

test('the open conversation is flagged with aria-current but stays clickable', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/901?view=List`
  });
  win.refreshDuplicateCustomerHighlights();

  const links = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')];
  assert.deepEqual(links.map(a => a.textContent), ['1', '2']);
  assert.equal(links[1].getAttribute('aria-current'), 'true', 'position follows group order');
  assert.equal(links[0].getAttribute('aria-current'), null);
});

test('a group of three lists all three positions', () => {
  const win = build([row('900', MERROW), row('901', MERROW), row('902', MERROW)]);
  win.refreshDuplicateCustomerHighlights();

  const strip = win.document.querySelector('.isa-duplicate-customer-strip');
  assert.match(strip.textContent, /3 open conversations from this customer/);
  assert.deepEqual(
    Array.from(strip.querySelectorAll('a'), a => a.textContent),
    ['1', '2', '3']
  );
});

test('a strip link keeps the team inbox and folder so the queue stays navigable', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?custom_folder_id=900613&view=List`
  });
  win.refreshDuplicateCustomerHighlights();

  const hrefs = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .map(a => a.getAttribute('href'));
  assert.ok(hrefs.every(h => h.includes(`/inbox/team/${TEAM}/conversation/`)), hrefs.join(' '));
  assert.ok(hrefs.some(h => h.includes('/conversation/901')));
});

test('a strip link rebuilt from the open conversation keeps the folder query', () => {
  const folderless = id => row(id, TAMSIN)
    .replace(/href="[^"]*"/, `href="/a/inbox/demo1234/inbox/conversation/${id}?view=List"`);
  const win = build([folderless('900'), folderless('901')], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?custom_folder_id=900613&view=List`
  });
  win.refreshDuplicateCustomerHighlights();

  const hrefs = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .map(a => a.getAttribute('href'));
  assert.ok(hrefs.includes(`/a/inbox/demo1234/inbox/team/${TEAM}/conversation/901?custom_folder_id=900613&view=List`), hrefs.join(' '));
});

test('a sibling scrolled out of the list still links into the current inbox', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?custom_folder_id=900613&view=List`
  });
  win.refreshDuplicateCustomerHighlights();

  const list = win.document.querySelector('[data-intercom-target-conversation-list]');
  list.innerHTML = row('900', TAMSIN);

  assert.equal(
    win.duplicateSiblingHref('901'),
    `/a/inbox/demo1234/inbox/team/${TEAM}/conversation/901?custom_folder_id=900613&view=List`,
    'with no row to copy, the link is rebuilt from the open conversation URL so team and folder survive'
  );
});

test('clicking a strip link hands the click to Intercom\'s own row', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  let rowClicks = 0;
  rowFor(win, '901').addEventListener('click', () => { rowClicks += 1; });

  const link = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .find(a => a.getAttribute('href').includes('/conversation/901'));
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  link.dispatchEvent(event);

  assert.equal(rowClicks, 1, 'the row transitions in-app, keeping the inbox queue');
  assert.equal(event.defaultPrevented, true, 'so the browser never does a full page load');
});

test('a modified click is left alone so open-in-new-tab keeps working', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  let rowClicks = 0;
  rowFor(win, '901').addEventListener('click', () => { rowClicks += 1; });

  const link = [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')]
    .find(a => a.getAttribute('href').includes('/conversation/901'));
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
  link.dispatchEvent(event);

  assert.equal(rowClicks, 0);
  assert.equal(event.defaultPrevented, false);
});

test('a sibling link never falls back to the folder-less conversation route', () => {
  const win = build([row('900', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?custom_folder_id=900613&view=List`
  });

  const href = win.duplicateSiblingHref('900999');
  assert.ok(!href.startsWith('/a/inbox/conversation/'),
    'Intercom normalises that form to a route with no team folder, which breaks queue navigation');
  assert.match(href, new RegExp(`/inbox/team/${TEAM}/`));
});

test('a row href that lost its team folder is not trusted over the current inbox', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
    url: `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/900?custom_folder_id=900613&view=List`
  });
  rowFor(win, '901').setAttribute('href', '/a/inbox/demo1234/inbox/conversation/901?view=List');

  assert.match(win.duplicateSiblingHref('901'), new RegExp(`/inbox/team/${TEAM}/conversation/901`));
});

test('the strip is absent when the open conversation has no duplicate', () => {
  const win = build([row('900', WREN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(win.document.querySelector('.isa-duplicate-customer-strip'), null);
});

test('a repeated pass never stacks strips', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  win.refreshDuplicateCustomerHighlights();
  assert.equal(win.document.querySelectorAll('.isa-duplicate-customer-strip').length, 1);
});

test('decoration survives a list re-render through the observer trailing edge', async () => {
  const win = build([row('1', TAMSIN), row('2', WREN)]);
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  await delay(150);
  list.innerHTML = [row('1', TAMSIN), row('2', WREN), row('4', WREN)].join('\n');
  await delay(0);
  assert.equal(chipText(win, '1'), null, 'the leading pass ran on a list with no duplicate of tamsin');

  list.innerHTML = [row('1', TAMSIN), row('2', WREN), row('3', TAMSIN)].join('\n');
  await delay(0);
  assert.equal(chipText(win, '3'), null, 'the second render is inside the throttle window, so no leading pass');
  await delay(300);

  assert.equal(chipText(win, '1'), '⧉2', 'the trailing pass decorated the re-rendered list');
  assert.equal(chipText(win, '3'), '⧉2');
});
