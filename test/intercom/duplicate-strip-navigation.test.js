'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');
const {
  TEAM,
  TAMSIN,
  WREN,
  build,
  row,
  rowFor,
  CONTACT_A,
  CONTACT_B,
  deliverIdentities,
} = require('../support/duplicate-conversations-harness');

const BASE = '/a/inbox/demo1234/inbox/team/' + TEAM;
const urlFor = (id, query = '?view=List') =>
  `https://app.intercom.com${BASE}/conversation/${id}${query}`;

const stripOf = win => win.document.querySelector('.isa-duplicate-customer-strip');
const linksOf = win => [...win.document.querySelectorAll('.isa-duplicate-customer-strip a')];
const textsOf = win => linksOf(win).map(a => a.textContent);
const listOf = win => win.document.querySelector('[data-intercom-target-conversation-list]');
const click = (link, win, init = {}) => {
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  link.dispatchEvent(event);
  return event;
};
const linkTo = (win, id) => linksOf(win).find(a => a.getAttribute('href').includes(`/conversation/${id}?`));

function buildOffscreen(url = urlFor('1')) {
  const win = build([row('1', TAMSIN), row('3', WREN)], { url });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);
  return win;
}

test('the strip is the first child of the composer container parent', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  const container = win.document.querySelector('[data-testid="composer-orchestrator"]');
  assert.ok(container);
  const strip = stripOf(win);
  assert.ok(strip);
  assert.equal(container.parentElement.firstElementChild, strip);
  assert.equal(strip.nextElementSibling, container);
});

test('without a composer container nothing renders and nothing throws', () => {
  const win = loadExtension(fx.inboxHtml({
    list: fx.conversationList([row('900', TAMSIN), row('901', TAMSIN)], { state: 'Open', count: '27' })
  }), { url: urlFor('900') });

  assert.doesNotThrow(() => win.refreshDuplicateCustomerHighlights());
  assert.doesNotThrow(() => win.refreshDuplicateCustomerHighlights());
  assert.equal(stripOf(win), null);
});

test('links are numbered in member order and the second member open flags the second link', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)], { url: urlFor('901') });
  win.refreshDuplicateCustomerHighlights();

  const links = linksOf(win);
  assert.deepEqual(links.map(a => a.textContent), ['1', '2', '3']);
  assert.deepEqual(links.map(a => a.getAttribute('aria-current')), [null, 'true', null]);
  assert.deepEqual(links.map(a => a.getAttribute('href').match(/conversation\/(\d+)/)[1]), ['900', '901', '902']);
});

test('only support-origin members get the envelope and an arrival title', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN), row('903', TAMSIN)]);
  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.rememberInboundAddresses('902', ['help@brightwell.example']);
  win.refreshDuplicateCustomerHighlights();

  const links = linksOf(win);
  assert.deepEqual(links.map(a => a.textContent), ['1', '2 ✉', '3', '4']);
  assert.equal(links[1].getAttribute('title'), 'Arrived at support@brightwell.example');
  for (const i of [0, 2, 3]) {
    assert.equal(/Arrived at/.test(links[i].getAttribute('title') || ''), false, `link ${i + 1} has no arrival title`);
  }
});

test('the strip title and label count the group', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  const strip = stripOf(win);
  assert.match(strip.getAttribute('title'), /^3 open conversations from this customer/);
  assert.match(strip.textContent, /3 open conversations from this customer/);
});

test('the strip carries a group marker', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.equal(stripOf(win).hasAttribute('data-isa-duplicate-group'), true);
});

test('re-rendering the same members and support set keeps the same strip element', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.refreshDuplicateCustomerHighlights();
  const first = stripOf(win);

  const removed = [];
  const observer = new win.MutationObserver(records => {
    for (const r of records) removed.push(...r.removedNodes);
  });
  observer.observe(first.parentElement, { childList: true });
  win.refreshDuplicateCustomerHighlights();
  win.refreshDuplicateCustomerHighlights();
  const records = observer.takeRecords();
  for (const r of records) removed.push(...r.removedNodes);
  observer.disconnect();

  assert.equal(stripOf(win), first);
  assert.equal(removed.includes(first), false);
  assert.equal(first.parentElement.querySelectorAll('.isa-duplicate-customer-strip').length, 1);
});

test('a change in members replaces the strip', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const first = stripOf(win);

  listOf(win).innerHTML = row('900', TAMSIN) + row('901', TAMSIN) + row('902', TAMSIN);
  win.refreshDuplicateCustomerHighlights();

  assert.notEqual(stripOf(win), first);
  assert.equal(first.isConnected, false);
  assert.deepEqual(textsOf(win), ['1', '2', '3']);
});

test('a change in which members are support replaces the strip', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const first = stripOf(win);

  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.refreshDuplicateCustomerHighlights();

  assert.notEqual(stripOf(win), first);
  assert.equal(first.isConnected, false);
  assert.deepEqual(textsOf(win), ['1', '2 ✉']);
});

test('a sibling row href with the team inbox is used as is', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  const custom = `/a/inbox/demo1234/inbox/team/555/conversation/901?custom_folder_id=9&view=Other`;
  rowFor(win, '901').setAttribute('href', custom);

  assert.equal(win.duplicateSiblingHref('901'), custom);
});

test('a sibling row href without the team inbox is replaced by the current path with the sibling id', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)], {
    url: urlFor('900', '?custom_folder_id=900613&view=List')
  });
  rowFor(win, '901').setAttribute('href', '/a/inbox/demo1234/inbox/conversation/901?view=List');

  assert.equal(win.duplicateSiblingHref('901'),
    `${BASE}/conversation/901?custom_folder_id=900613&view=List`);
});

test('a plural conversations segment is replaced by the sibling id, keeping the query', () => {
  const win = buildOffscreen(`https://app.intercom.com${BASE}/conversations/1?custom_folder_id=7&view=List`);

  assert.match(win.duplicateSiblingHref('2'), new RegExp(`^${BASE}/conversations?/2\\?custom_folder_id=7&view=List$`));
});

test('with no conversation segment the sibling is appended after trailing slashes are stripped', () => {
  const win = build([row('900', TAMSIN)], { url: `https://app.intercom.com${BASE}///` });
  assert.equal(win.duplicateSiblingHref('2'), `${BASE}/conversation/2`);
});

test('a path with inner double slashes keeps them when the sibling is appended', () => {
  const win = build([row('900', TAMSIN)], { url: 'https://app.intercom.com/a//inbox//team/' + TEAM + '/' });
  assert.equal(win.duplicateSiblingHref('2'), `/a//inbox//team/${TEAM}/conversation/2`);
});

test('a click that is already default-prevented does nothing', async () => {
  const win = buildOffscreen();
  const before = win.history.length;
  const path = win.location.pathname;
  let popstates = 0;
  win.addEventListener('popstate', () => { popstates += 1; });
  win.document.addEventListener('click', e => e.preventDefault(), true);

  click(linkTo(win, '2'), win);
  await delay(450);

  assert.equal(win.history.length, before);
  assert.equal(win.location.pathname, path);
  assert.equal(popstates, 0);
});

test('a click that is already default-prevented leaves a mounted sibling row alone', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  let rowClicks = 0;
  rowFor(win, '901').addEventListener('click', () => { rowClicks += 1; });
  win.document.addEventListener('click', e => e.preventDefault(), true);

  click(linkTo(win, '901'), win);

  assert.equal(rowClicks, 0);
});

test('non-primary buttons and each modifier key do nothing', async () => {
  const cases = [
    { button: 1 },
    { button: 2 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true }
  ];
  for (const init of cases) {
    const win = buildOffscreen();
    const before = win.history.length;
    const path = win.location.pathname;
    let popstates = 0;
    win.addEventListener('popstate', () => { popstates += 1; });

    const event = click(linkTo(win, '2'), win, init);
    await delay(0);

    const label = JSON.stringify(init);
    assert.equal(event.defaultPrevented, false, label);
    assert.equal(win.history.length, before, label);
    assert.equal(win.location.pathname, path, label);
    assert.equal(popstates, 0, label);
  }
});

test('a modified click leaves a mounted sibling row alone', () => {
  for (const init of [{ metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
    win.refreshDuplicateCustomerHighlights();
    let rowClicks = 0;
    rowFor(win, '901').addEventListener('click', () => { rowClicks += 1; });

    const event = click(linkTo(win, '901'), win, init);

    assert.equal(rowClicks, 0, JSON.stringify(init));
    assert.equal(event.defaultPrevented, false, JSON.stringify(init));
  }
});

test('a plain click on a mounted second sibling clicks its row and pushes no history', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  const clicks = { 901: 0, 902: 0 };
  rowFor(win, '901').addEventListener('click', () => { clicks[901] += 1; });
  rowFor(win, '902').addEventListener('click', () => { clicks[902] += 1; });
  const before = win.history.length;

  const event = click(linkTo(win, '902'), win);

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(clicks, { 901: 0, 902: 1 });
  assert.equal(win.history.length, before);
});

test('a plain click on an unmounted sibling pushes the href keeping history state and fires popstate with it', () => {
  const win = buildOffscreen(urlFor('1', '?custom_folder_id=900613&view=List'));
  win.history.replaceState({ marker: 'kept' }, '');
  const before = win.history.length;
  const popped = [];
  win.addEventListener('popstate', e => popped.push(e.state));

  const event = click(linkTo(win, '2'), win);

  assert.equal(event.defaultPrevented, true);
  assert.equal(win.history.length, before + 1);
  assert.equal(win.location.pathname + win.location.search,
    `${BASE}/conversation/2?custom_folder_id=900613&view=List`);
  assert.deepEqual(win.history.state, { marker: 'kept' });
  assert.equal(popped.length, 1);
  assert.deepEqual(popped[0], { marker: 'kept' });
});

test('after 400 ms the appeared sibling row is clicked when the open conversation is not the sibling', async () => {
  const win = buildOffscreen();
  let rowClicks = 0;
  const original = win.location.pathname + win.location.search;

  click(linkTo(win, '2'), win);
  win.history.replaceState(win.history.state, '', original);
  listOf(win).insertAdjacentHTML('beforeend', row('2', TAMSIN));
  rowFor(win, '2').addEventListener('click', () => { rowClicks += 1; });

  await delay(150);
  assert.equal(rowClicks, 0, 'not before the 400 ms wait');
  await delay(400);
  assert.equal(rowClicks, 1);
});

test('the late click does not happen when the open conversation already is the sibling', async () => {
  const win = buildOffscreen();
  let rowClicks = 0;

  click(linkTo(win, '2'), win);
  assert.match(win.location.pathname, /\/conversation\/2$/);
  listOf(win).insertAdjacentHTML('beforeend', row('2', TAMSIN));
  rowFor(win, '2').addEventListener('click', () => { rowClicks += 1; });

  await delay(550);
  assert.equal(rowClicks, 0);
});

test('the late click does nothing when the sibling row never appeared', async () => {
  const win = buildOffscreen();
  const original = win.location.pathname + win.location.search;

  click(linkTo(win, '2'), win);
  win.history.replaceState(win.history.state, '', original);
  await delay(550);

  assert.equal(win.location.pathname + win.location.search, original);
  assert.ok(stripOf(win));
});

test('a remembered member that scrolled out of the list stays while the open conversation is unchanged', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)], { url: urlFor('901') });
  win.refreshDuplicateCustomerHighlights();

  listOf(win).innerHTML = row('900', TAMSIN) + row('901', TAMSIN) + row('903', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(textsOf(win), ['1', '2', '3']);
  assert.ok(linkTo(win, '902'));
  assert.equal(linksOf(win)[1].getAttribute('aria-current'), 'true');
});

test('a remembered member still listed under another customer is dropped while a scrolled-out one stays', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();

  listOf(win).innerHTML = row('900', TAMSIN) + row('901', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(textsOf(win), ['1', '2']);
  assert.ok(linkTo(win, '900'));
  assert.ok(linkTo(win, '902'));
  assert.equal(linkTo(win, '901'), undefined);
});

test('switching the open conversation discards the previous strip memory', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(textsOf(win), ['1', '2']);

  win.history.pushState({}, '', `${BASE}/conversation/903?view=List`);
  listOf(win).innerHTML = row('903', TAMSIN) + row('904', TAMSIN);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(textsOf(win), ['1', '2']);
  assert.equal(linkTo(win, '900'), undefined);
  assert.equal(linkTo(win, '901'), undefined);
  assert.ok(linkTo(win, '903'));
  assert.ok(linkTo(win, '904'));
});

test('switching to a conversation with no group leaves no strip from the old memory', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', WREN)]);
  win.refreshDuplicateCustomerHighlights();

  win.history.pushState({}, '', `${BASE}/conversation/902?view=List`);
  listOf(win).innerHTML = row('902', WREN);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(stripOf(win), null);
});

test('with grouping data present but no group for the open conversation there is no strip', () => {
  const win = build([row('1', TAMSIN), row('2', TAMSIN), row('3', WREN)], { url: urlFor('3') });
  deliverIdentities(win, [['1', CONTACT_A], ['2', CONTACT_A], ['3', CONTACT_B]]);
  win.refreshDuplicateCustomerHighlights();

  assert.ok(win.document.querySelector('.isa-duplicate-customer-chip'), 'the pair on screen is grouped');
  assert.equal(stripOf(win), null);
});

test('opening another customer while the old group stays in the list shows no strip', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', WREN)]);
  win.refreshDuplicateCustomerHighlights();
  assert.deepEqual(textsOf(win), ['1', '2']);

  win.history.pushState({}, '', `${BASE}/conversation/902?view=List`);
  win.refreshDuplicateCustomerHighlights();

  assert.equal(stripOf(win), null);
});

test('an arrival known before the strip renders gets no envelope', () => {
  const win = build([row('900', TAMSIN), row('901', TAMSIN), row('902', TAMSIN)]);
  win.rememberInboundAddresses('902', ['help@brightwell.example']);
  win.rememberInboundAddresses('901', ['support@brightwell.example']);
  win.refreshDuplicateCustomerHighlights();

  assert.deepEqual(textsOf(win), ['1', '2 ✉', '3']);
  assert.equal(linksOf(win)[2].getAttribute('title') || '', '');
});
