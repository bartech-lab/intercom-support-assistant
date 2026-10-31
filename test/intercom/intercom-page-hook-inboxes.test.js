'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntercomPageHook, makeIntercomResponse, loadExtension } = require('../support/helpers');
const {
  ORIGIN,
  hookWith,
  relayed,
  INBOXES_URL,
} = require('../support/intercom-page-hook-harness');

test('the polled inboxes-count response relays validated per-inbox counts', async () => {
  const ctx = hookWith({
    [INBOXES_URL]: makeIntercomResponse(JSON.stringify({
      inboxes: [
        { id: 90027492, inbox_type: 'view', count: { count: 0 } },
        { id: 2, inbox_type: 'BAD TYPE', count: { count: 1 } },
        { id: 3, inbox_type: 'team', count: { count: -5 } },
        { id: 4, inbox_type: 'team', count: { count: 2.5 } },
        { id: 5, inbox_type: 'team', count: { count: 7 } }
      ]
    }), { url: INBOXES_URL })
  });
  const { envelopes } = await relayed(ctx, INBOXES_URL, { method: 'POST' });
  const countsEnvelope = envelopes.find(e => e.kind === 'inbox-counts');
  assert.ok(countsEnvelope, 'counts envelope posted');
  assert.deepEqual(
    Array.from(countsEnvelope.counts, entry => entry.inboxType),
    ['view', 'team']
  );
  assert.deepEqual(
    Array.from(countsEnvelope.counts, entry => entry.count),
    [0, 7]
  );
  assert.deepEqual(
    Array.from(countsEnvelope.counts, entry => entry.inboxId),
    ['90027492', '5']
  );
  assert.equal(typeof countsEnvelope.observedAt, 'number');
});

test('the polled inboxes response accepts a flat numeric count', async () => {
  const ctx = hookWith({
    [INBOXES_URL]: makeIntercomResponse(JSON.stringify({
      inboxes: [{ id: 'all', inbox_type: 'shared', count: 6931 }]
    }), { url: INBOXES_URL })
  });
  const { envelopes } = await relayed(ctx, INBOXES_URL, { method: 'POST' });
  const count = envelopes.find(e => e.kind === 'inbox-counts').counts[0];
  assert.equal(count.inboxType, 'shared');
  assert.equal(count.inboxId, 'all');
  assert.equal(count.count, 6931);
});

test('a non-inboxes POST is still ignored', async () => {
  const listUrl = `${ORIGIN}/ember/inbox/conversations/list?inbox_type=team&inbox_id=900202&state=open`;
  const load = () => hookWith({
    [listUrl]: makeIntercomResponse('{"conversations":[]}', { url: listUrl })
  });
  const viaGet = await relayed(load(), listUrl);
  assert.ok(viaGet.envelopes.length > 0, 'the same URL relays when the page reads it with GET');
  const viaPost = await relayed(load(), listUrl, { method: 'POST' });
  assert.equal(viaPost.envelopes.length, 0, 'only the inboxes poll widens to POST');
});

test('nexus WebSocket text frames relay as nexus-frame envelopes', () => {
  class FakeWebSocket {
    constructor(url) { this.url = url; this.listeners = {}; }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    dispatch(type, event) {
      (this.listeners[type] || []).forEach(fn => fn(event));
    }
  }
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}', {})),
    beforeScripts: win => { win.WebSocket = FakeWebSocket; }
  });
  ctx.sendReady();
  const socket = new ctx.window.WebSocket('wss://nexus-websocket-inbox.intercom.io/x');
  socket.dispatch('message', { data: JSON.stringify({ topic: 'inbox', unread_count: 3 }) });
  const envelopes = ctx.posted.filter(m => m && m.__isaic === true);
  const frame = envelopes.find(e => e.kind === 'nexus-frame');
  assert.ok(frame, 'matching frame is posted');
  assert.match(frame.url, /nexus-websocket-inbox/);
  assert.equal(JSON.parse(frame.data).unread_count, 3);
});

test('non-nexus sockets and non-text frames never relay', () => {
  class FakeWebSocket {
    constructor(url) { this.url = url; this.listeners = {}; }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    dispatch(type, event) {
      (this.listeners[type] || []).forEach(fn => fn(event));
    }
  }
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}', {})),
    beforeScripts: win => { win.WebSocket = FakeWebSocket; }
  });
  ctx.sendReady();
  const foreign = new ctx.window.WebSocket('wss://example.com/x');
  foreign.dispatch('message', { data: '{"inbox":1}' });
  const nexus = new ctx.window.WebSocket('wss://nexus-websocket-a.intercom.io/y');
  nexus.dispatch('message', { data: new Uint8Array([1]) });
  nexus.dispatch('message', { data: 'no matching words here' });
  assert.equal(ctx.posted.filter(m => m && m.__isaic === true).length, 0,
    'foreign hosts, binary frames, and unmatched text stay silent');
});

test('the hook installs once even when the script is evaluated twice', () => {
  const ctx = hookWith({});
  const wrapped = ctx.window.fetch;
  ctx.evaluateHook();
  assert.equal(ctx.window.fetch, wrapped, 'a second evaluation must not re-wrap fetch');
});

test('the WebSocket wrapper stays transparent: protocols, prototype, and static constants pass through', () => {
  const constructed = [];
  class FakeWebSocket {
    constructor(...args) { constructed.push(args); this.listeners = {}; }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}', {})),
    beforeScripts: win => { win.WebSocket = FakeWebSocket; }
  });
  const Wrapped = ctx.window.WebSocket;
  const withProtocols = new Wrapped('wss://nexus-websocket-a.intercom.io/y', ['v1.nexus']);
  const without = new Wrapped('wss://nexus-websocket-a.intercom.io/z');

  assert.notEqual(Wrapped, FakeWebSocket, 'the constructor is wrapped');
  assert.deepEqual(constructed, [['wss://nexus-websocket-a.intercom.io/y', ['v1.nexus']], ['wss://nexus-websocket-a.intercom.io/z']]);
  assert.ok(withProtocols instanceof Wrapped);
  assert.ok(without instanceof FakeWebSocket);
  assert.deepEqual([Wrapped.CONNECTING, Wrapped.OPEN, Wrapped.CLOSING, Wrapped.CLOSED], [0, 1, 2, 3]);
});

test('a nexus frame longer than the 4 MiB payload cap is not relayed, one at the cap is', () => {
  class FakeWebSocket {
    constructor(url) { this.url = url; this.listeners = {}; }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    dispatch(type, event) {
      (this.listeners[type] || []).forEach(fn => fn(event));
    }
  }
  const ctx = loadIntercomPageHook({
    fetchImpl: () => Promise.resolve(makeIntercomResponse('{}', {})),
    beforeScripts: win => { win.WebSocket = FakeWebSocket; }
  });
  ctx.sendReady();
  const socket = new ctx.window.WebSocket('wss://nexus-websocket-inbox.intercom.io/x');
  const frame = length => 'inbox' + 'x'.repeat(length - 5);
  socket.dispatch('message', { data: frame(4 * 1024 * 1024 + 1) });
  assert.equal(ctx.posted.filter(m => m && m.__isaic === true && m.kind === 'nexus-frame').length, 0);
  socket.dispatch('message', { data: frame(4 * 1024 * 1024) });
  assert.equal(ctx.posted.filter(m => m && m.__isaic === true && m.kind === 'nexus-frame').length, 1);
});
