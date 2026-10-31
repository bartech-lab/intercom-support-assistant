'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const ORIGIN = 'https://app.intercom.com';

function post(win, envelope) {
  win.dispatchEvent(new win.MessageEvent('message', {
    source: win,
    origin: ORIGIN,
    data: envelope
  }));
}

test('validated inbox-count envelopes populate the network count cache', () => {
  const win = loadExtension(fx.inboxHtml());
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    counts: [{ inboxType: 'team', inboxId: '900202', count: 4 }]
  });
  assert.equal(win.networkInboxCount('team', '900202'), null,
    'unknown polling interval keeps the network count out of primary resolution');
  const observation = win.networkInboxObservation('team', '900202');
  assert.equal(observation.count, 4);
  assert.equal(typeof observation.observedAt, 'number');
  assert.ok(observation.ageMs >= 0 && observation.ageMs < 1000);
  assert.equal(observation.freshnessWindowMs, null);
  assert.equal(observation.fresh, false);
  assert.equal(win.freshNetworkInboxCount('team', '900202'), null,
    'network-primary resolution fails closed until a normal polling interval is measured');

  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    counts: [{ inboxType: 'team', inboxId: '900202', count: 'many' }]
  });
  assert.equal(win.networkInboxObservation('team', '900202').count, 4,
    'invalid entries never overwrite');

  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    counts: [{ inboxType: 'team', inboxId: '900202', count: 0 }]
  });
  assert.equal(win.networkInboxObservation('team', '900202').count, 0);
});

test('nexus frames feed the cache only through valid count objects', () => {
  const win = loadExtension(fx.inboxHtml());
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'nexus-frame',
    url: 'wss://nexus-websocket-inbox.intercom.io',
    data: JSON.stringify({
      wrapper: {
        inboxes: [
          { id: 5, inbox_type: 'admin', unread_count: 2 },
          { id: 6, inbox_type: 'BAD', unread_count: 9 }
        ]
      }
    })
  });
  assert.equal(win.networkInboxObservation('admin', '5').count, 2);
  assert.equal(win.networkInboxObservation('admin', '6'), null, 'invalid shapes store nothing');
  assert.deepEqual([...win.eval('networkInboxCountByKey').keys()], ['admin:5'], 'only the valid inbox is stored');
});

test('freshness rejects an old observation when a measured window is supplied', () => {
  const win = loadExtension(fx.inboxHtml());
  const observedAt = Date.now() - 2001;
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    observedAt,
    counts: [{ inboxType: 'team', inboxId: '900202', count: 4 }]
  });
  const observation = win.networkInboxObservation('team', '900202', {
    now: Date.now(),
    freshnessWindowMs: 1000
  });
  assert.equal(observation.observedAt, observedAt);
  assert.equal(observation.fresh, false);
  assert.equal(observation.freshnessWindowMs, 1000);

  const rollback = win.networkInboxObservation('team', '900202', {
    now: observation.observedAt - 1,
    freshnessWindowMs: 1000
  });
  assert.equal(rollback.ageMs, -1);
  assert.equal(rollback.fresh, false);
});

test('network counts require exact inbox type and id pairs', () => {
  const win = loadExtension(fx.inboxHtml());
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    counts: [
      { inboxType: 'all', inboxId: 'all', count: 6929 },
      { inboxType: 'shared', inboxId: 'all', count: 6931 }
    ]
  });
  assert.equal(win.networkInboxObservation('all', 'all').count, 6929);
  assert.equal(win.networkInboxObservation('shared', 'all').count, 6931);
  assert.equal(win.networkInboxObservation('team', 'all'), null, 'a known id under the wrong type is unknown');
  assert.equal(win.networkInboxObservation('shared', 'other'), null, 'a known type under the wrong id is unknown');
});

test('older or future observations cannot replace the cache', () => {
  const win = loadExtension(fx.inboxHtml());
  const observedAt = Date.now() - 1000;
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    observedAt,
    counts: [{ inboxType: 'team', inboxId: '900202', count: 4 }]
  });
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    observedAt: observedAt - 1,
    counts: [{ inboxType: 'team', inboxId: '900202', count: 9 }]
  });
  assert.equal(win.networkInboxObservation('team', '900202').count, 4);
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'inbox-counts',
    observedAt: Date.now() + 1000,
    counts: [{ inboxType: 'team', inboxId: '900202', count: 10 }]
  });
  assert.equal(win.networkInboxObservation('team', '900202').count, 4);
});

test('garbage nexus payloads store nothing', () => {
  const win = loadExtension(fx.inboxHtml());
  post(win, {
    __isaic: true,
    version: 1,
    kind: 'nexus-frame',
    url: 'wss://nexus-websocket-a.intercom.io',
    data: 'not json at all'
  });
  assert.equal(win.eval('networkInboxCountByKey.size'), 0);
});
