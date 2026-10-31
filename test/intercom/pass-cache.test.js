'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

function build(rows, options = {}, brand = 'Brightwell') {
  return loadExtension(fx.inboxHtml({
    list: fx.conversationList(rows, { state: 'Open', ...options }),
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Brightwell',
      conversationAttrs: [fx.conversationAttrRow('brand', 'Brand', brand)]
    })
  }));
}

function rowsFor(names) {
  return names.map((name, index) => fx.conversationListRow({
    conversationId: `${800 + index}`,
    name
  }));
}

test('conversationListRows is computed once per pass and recomputed in the next', () => {
  const win = build(rowsFor(['Ann Lee', 'Bob Ray']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  win.runWithPassCache(() => {
    assert.equal(win.conversationListRows().length, 2);
    list.insertAdjacentHTML('beforeend', fx.conversationListRow({
      conversationId: '999',
      name: 'Cyd Poe'
    }));
    assert.equal(win.conversationListRows().length, 2, 'the pass keeps its snapshot');
  });

  assert.equal(win.conversationListRows().length, 3, 'the next read sees the new row');
});

test('the pass cache is cleared even when the pass throws', () => {
  const win = build(rowsFor(['Ann Lee']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  assert.throws(() => win.runWithPassCache(() => {
    win.conversationListRows();
    throw new Error('pass exploded');
  }), /pass exploded/);

  list.insertAdjacentHTML('beforeend', fx.conversationListRow({
    conversationId: '998',
    name: 'Bob Ray'
  }));
  assert.equal(win.conversationListRows().length, 2, 'a throw did not leave a stale snapshot');
});

test('a nested pass shares the outer snapshot and does not clear it early', () => {
  const win = build(rowsFor(['Ann Lee']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  win.runWithPassCache(() => {
    assert.equal(win.conversationListRows().length, 1);
    win.runWithPassCache(() => {
      list.insertAdjacentHTML('beforeend', fx.conversationListRow({
        conversationId: '997',
        name: 'Bob Ray'
      }));
      assert.equal(win.conversationListRows().length, 1, 'the inner pass reuses the snapshot');
    });
    assert.equal(win.conversationListRows().length, 1, 'the inner pass did not clear it');
  });

  assert.equal(win.conversationListRows().length, 2);
});

test('reading outside a pass is never cached', () => {
  const win = build(rowsFor(['Ann Lee']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  assert.equal(win.conversationListRows().length, 1);
  list.insertAdjacentHTML('beforeend', fx.conversationListRow({
    conversationId: '996',
    name: 'Bob Ray'
  }));
  assert.equal(win.conversationListRows().length, 2);
});

test('getCompanyFromAttributes caches the raw and resolved answers separately', () => {
  const win = build(rowsFor(['Ann Lee']), {}, 'Unlisted Brand');

  win.runWithPassCache(() => {
    assert.equal(win.getCompanyFromAttributes(), null, 'an unlisted value resolves to nothing');
    assert.equal(win.getCompanyFromAttributes({ allowRaw: true }), 'Unlisted Brand', 'the raw answer is cached apart');
    assert.equal(win.getCompanyFromAttributes(), null);
  });
});

test('an unchanged row set reuses the duplicate identity groups', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));

  const first = win.runWithPassCache(() => win.refreshDuplicateCustomerIdentity());
  const second = win.runWithPassCache(() => win.refreshDuplicateCustomerIdentity());

  assert.ok(first, 'the first pass built groups');
  assert.equal(second, first, 'the second pass returned the same object');
});

test('a changed row set invalidates the duplicate identity groups', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));
  const list = win.document.querySelector('[data-intercom-target-conversation-list]');

  const first = win.runWithPassCache(() => win.refreshDuplicateCustomerIdentity());
  list.insertAdjacentHTML('beforeend', fx.conversationListRow({
    conversationId: '995',
    name: 'Ann Lee'
  }));
  const second = win.runWithPassCache(() => win.refreshDuplicateCustomerIdentity());

  assert.notEqual(second, first, 'a new row forced a rebuild');
  assert.equal(Array.from(second.get('ann lee')).length, 3);
});

test('an unchanged row set still re-asserts row classes that Intercom stripped', () => {
  const win = build(rowsFor(['Ann Lee', 'Ann Lee']));

  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());
  const rows = win.conversationListRows();
  assert.ok(rows.every(row => row.classList.contains('isa-duplicate-customer-row')));

  rows.forEach(row => { row.className = 'ember-view group'; });
  win.runWithPassCache(() => win.refreshDuplicateCustomerHighlights());

  assert.ok(
    win.conversationListRows().every(row => row.classList.contains('isa-duplicate-customer-row')),
    'the cached identity did not stop the decoration being re-applied'
  );
});

test('a row whose name has not rendered yet is not cached as identified', () => {
  const win = build([
    fx.conversationListRow({ conversationId: '810', name: 'Ann Lee' }),
    '<a href="/a/inbox/x/inbox/team/123/conversation/811" data-conversation-id="811"></a>'
  ]);

  const first = win.runWithPassCache(() => win.refreshDuplicateCustomerIdentity());
  const second = win.runWithPassCache(() => win.refreshDuplicateCustomerIdentity());

  assert.notEqual(second, first, 'an unnamed row forces a rebuild until it renders');
});
