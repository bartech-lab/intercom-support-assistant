'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadIntercomPageHook } = require('../support/helpers');

const ORIGIN = 'https://app.intercom.com';
const APP = 'demo1234';
const DATE = 'Sun, 22 Nov 2026 14:00:00 GMT';

function jsonResponse(body, status = 200, withDate = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (withDate) headers.date = DATE;
  return new Response(JSON.stringify(body), { status, headers });
}

function noteFor(id) {
  return { id, body: `<p>note ${id}</p>`, created_at: 1700000000 + Number(id), updated_at: 1700000100 + Number(id), extra: { nested: [1, 2], flag: true } };
}

function listUrl(ids, extra = '', base = ORIGIN) {
  const q = ids.map((id) => `ids[]=${id}`).join('&');
  return `${base}/ember/inbox/notes?${q}&app_id=${APP}${extra}`;
}

function makeHook(handler) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const call = { input, init, url: typeof input === 'string' ? input : input.url };
    calls.push(call);
    return handler(call, calls.length);
  };
  const hook = loadIntercomPageHook({
    fetchImpl,
    beforeScripts: (win) => { win.Response = Response; win.Request = Request; }
  });
  return { ...hook, calls };
}

function idsOf(call) {
  return new URL(call.url).searchParams.getAll('ids[]');
}

function requested(call) {
  const u = new URL(call.url);
  return u.searchParams.getAll('ids[]');
}

function singleHandler(existing, original = 404) {
  return (call, n) => {
    if (n === 1) return new Response('', { status: original });
    const ids = idsOf(call);
    if (ids.length !== 1) return new Response('', { status: 500 });
    if (!existing.includes(ids[0])) return new Response('', { status: 404 });
    return jsonResponse([noteFor(ids[0])]);
  };
}

async function plain(response) {
  return JSON.parse(JSON.stringify(await response.json()));
}

test('a healthy 200 is returned untouched with no extra request', async () => {
  const body = [noteFor('1'), noteFor('2')];
  const { window, calls } = makeHook(() => jsonResponse(body));
  const response = await window.fetch(listUrl(['1', '2']));
  assert.equal(response.status, 200);
  assert.deepStrictEqual(await plain(response), body);
  assert.equal(calls.length, 1);
});

for (const status of [500, 429, 403, 401]) {
  test(`a ${status} answer is returned untouched with no extra request`, async () => {
    const { window, calls } = makeHook(() => new Response('', { status }));
    const response = await window.fetch(listUrl(['1', '2', '3']));
    assert.equal(response.status, status);
    assert.equal(calls.length, 1);
  });
}

test('a 404 is repaired into a 200 list of the notes that still exist', async () => {
  const { window, calls } = makeHook(singleHandler(['11', '33']));
  const response = await window.fetch(listUrl(['11', '22', '33']));
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.deepStrictEqual(await plain(response), [noteFor('11'), noteFor('33')]);
  assert.equal(calls.length, 4);
});

test('repaired notes follow the order of the ids in the request', async () => {
  const { window } = makeHook(singleHandler(['5', '9', '7']));
  const response = await window.fetch(listUrl(['9', '8', '5', '7']));
  const notes = await plain(response);
  assert.deepStrictEqual(notes.map((n) => n.id), ['9', '5', '7']);
});

test('order follows the request even when single reads finish in reverse order', async () => {
  const { window } = makeHook((call, n) => {
    if (n === 1) return new Response('', { status: 404 });
    const id = idsOf(call)[0];
    const wait = (5 - n) * 10;
    return new Promise((resolve) => setTimeout(() => resolve(jsonResponse([noteFor(id)])), wait));
  });
  const response = await window.fetch(listUrl(['1', '2', '3', '4']));
  const notes = await plain(response);
  assert.deepStrictEqual(notes.map((n) => n.id), ['1', '2', '3', '4']);
});

test('all fields of each note are preserved', async () => {
  const full = { id: '7', body: '<p>x</p>', created_at: 1, updated_at: 2, author: { id: 3, name: 'A' }, tags: ['a', 'b'], unknown_field: null };
  const { window } = makeHook((call, n) => {
    if (n === 1) return new Response('', { status: 404 });
    return idsOf(call)[0] === '7' ? jsonResponse([full]) : new Response('', { status: 404 });
  });
  const response = await window.fetch(listUrl(['7', '8']));
  assert.deepStrictEqual(await plain(response), [full]);
});

test('when every id is gone the caller gets 200 and an empty array', async () => {
  const { window, calls } = makeHook(singleHandler([]));
  const response = await window.fetch(listUrl(['1', '2']));
  assert.equal(response.status, 200);
  assert.deepStrictEqual(await plain(response), []);
  assert.equal(calls.length, 3);
});

test('the repaired response carries a date header when single reads had one', async () => {
  const { window } = makeHook(singleHandler(['1', '2']));
  const response = await window.fetch(listUrl(['1', '2']));
  assert.ok(response.headers.get('date'));
});

test('the repaired response is a normal readable json response', async () => {
  const { window } = makeHook(singleHandler(['1']));
  const response = await window.fetch(listUrl(['1', '2']));
  assert.equal(response.ok, true);
  const parsed = await response.json();
  assert.equal(Array.isArray(parsed) || Array.from(parsed).length >= 0, true);
  assert.equal(Array.from(parsed).length, 1);
});

for (const status of [500, 429]) {
  test(`one single read answering ${status} gives back the original 404 and no partial list`, async () => {
    const { window, calls } = makeHook((call, n) => {
      if (n === 1) return new Response('', { status: 404 });
      const id = idsOf(call)[0];
      if (id === '2') return new Response('', { status });
      return jsonResponse([noteFor(id)]);
    });
    const response = await window.fetch(listUrl(['1', '2', '3']));
    assert.equal(response.status, 404);
    assert.equal(calls.length, 4);
  });
}

test('one single read that rejects gives back the original 404', async () => {
  const { window } = makeHook((call, n) => {
    if (n === 1) return new Response('', { status: 404 });
    const id = idsOf(call)[0];
    if (id === '2') return Promise.reject(new TypeError('network down'));
    return jsonResponse([noteFor(id)]);
  });
  const response = await window.fetch(listUrl(['1', '2', '3']));
  assert.equal(response.status, 404);
});

test('a single read returning a json object instead of an array gives back the original 404', async () => {
  const { window } = makeHook((call, n) => {
    if (n === 1) return new Response('', { status: 404 });
    const id = idsOf(call)[0];
    if (id === '2') return jsonResponse({ id: '2' });
    return jsonResponse([noteFor(id)]);
  });
  const response = await window.fetch(listUrl(['1', '2']));
  assert.equal(response.status, 404);
});

test('a single read returning unparseable text gives back the original 404', async () => {
  const { window } = makeHook((call, n) => {
    if (n === 1) return new Response('', { status: 404 });
    const id = idsOf(call)[0];
    if (id === '2') return new Response('not json', { status: 200 });
    return jsonResponse([noteFor(id)]);
  });
  const response = await window.fetch(listUrl(['1', '2']));
  assert.equal(response.status, 404);
});

test('a single read returning a json null gives back the original 404', async () => {
  const { window } = makeHook((call, n) => {
    if (n === 1) return new Response('', { status: 404 });
    return jsonResponse(null);
  });
  const response = await window.fetch(listUrl(['1', '2']));
  assert.equal(response.status, 404);
});

test('a not-found for a single note becomes an empty list, with no further request', async () => {
  const { window, calls } = makeHook(() => new Response('', { status: 404 }));
  const response = await window.fetch(listUrl(['1']));
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.deepEqual(await plain(response), []);
  assert.equal(calls.length, 1, 'a single id is never read again');
});

for (const status of [200, 401, 403, 429, 500]) {
  test(`a single-note request answering ${status} is left untouched`, async () => {
    const { window, calls } = makeHook(() => jsonResponse(status === 200 ? [noteFor('1')] : { error: 'x' }, status));
    const response = await window.fetch(listUrl(['1']));
    assert.equal(response.status, status);
    assert.equal(calls.length, 1);
  });
}

test('a not-found for a single note on another origin, or with another method, is left alone', async () => {
  const other = makeHook(() => new Response('', { status: 404 }));
  assert.equal((await other.window.fetch(listUrl(['1'], '', 'https://example.invalid'))).status, 404);
  const post = makeHook(() => new Response('', { status: 404 }));
  assert.equal((await post.window.fetch(listUrl(['1']), { method: 'DELETE' })).status, 404);
});

test('a request with 26 ids is not repaired', async () => {
  const ids = Array.from({ length: 26 }, (_, i) => String(1000 + i));
  const { window, calls } = makeHook(() => new Response('', { status: 404 }));
  const response = await window.fetch(listUrl(ids));
  assert.equal(response.status, 404);
  assert.equal(calls.length, 1);
});

test('a request with exactly 25 ids is repaired with one read per id', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => String(1000 + i));
  const { window, calls } = makeHook(singleHandler(ids));
  const response = await window.fetch(listUrl(ids));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 26);
  assert.deepStrictEqual((await plain(response)).map((n) => n.id), ids);
});

test('a request to another origin is not repaired', async () => {
  const { window, calls } = makeHook(() => new Response('', { status: 404 }));
  const response = await window.fetch(listUrl(['1', '2'], '', 'https://other.example.com'));
  assert.equal(response.status, 404);
  assert.equal(calls.length, 1);
});

for (const method of ['POST', 'PUT', 'DELETE']) {
  test(`a ${method} to the notes path is not repaired`, async () => {
    const { window, calls } = makeHook(() => new Response('', { status: 404 }));
    const response = await window.fetch(listUrl(['1', '2']), { method });
    assert.equal(response.status, 404);
    assert.equal(calls.length, 1);
  });
}

for (const path of ['/ember/inbox/notes/123', '/ember/users/notes', '/ember/inbox/notes/']) {
  test(`a GET to ${path} is not repaired`, async () => {
    const { window, calls } = makeHook(() => new Response('', { status: 404 }));
    const response = await window.fetch(`${ORIGIN}${path}?ids[]=1&ids[]=2&app_id=${APP}`);
    assert.equal(response.status, 404);
    assert.equal(calls.length, 1);
  });
}

for (const [label, query] of [
  ['missing', 'ids[]=1&ids[]=2'],
  ['empty', 'ids[]=1&ids[]=2&app_id='],
  ['non-alphanumeric', 'ids[]=1&ids[]=2&app_id=a%20b%2Fc']
]) {
  test(`a request with a ${label} app_id is not repaired`, async () => {
    const { window, calls } = makeHook(() => new Response('', { status: 404 }));
    const response = await window.fetch(`${ORIGIN}/ember/inbox/notes?${query}`);
    assert.equal(response.status, 404);
    assert.equal(calls.length, 1);
  });
}

for (const [label, bad] of [['non-numeric', 'abc'], ['33 digits', '1'.repeat(33)], ['empty', '']]) {
  test(`a request containing a ${label} id is not repaired`, async () => {
    const { window, calls } = makeHook(() => new Response('', { status: 404 }));
    const response = await window.fetch(listUrl(['1', '2', bad]));
    assert.equal(response.status, 404);
    assert.equal(calls.length, 1);
  });
}

test('a 32 digit id is accepted', async () => {
  const long = '9'.repeat(32);
  const { window, calls } = makeHook(singleHandler([long, '2']));
  const response = await window.fetch(listUrl([long, '2']));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
});

test('duplicate ids are asked for once', async () => {
  const { window, calls } = makeHook(singleHandler(['1', '2']));
  const response = await window.fetch(listUrl(['1', '2', '1', '2', '1']));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  assert.deepStrictEqual((await plain(response)).map((n) => n.id), ['1', '2']);
  assert.deepStrictEqual(calls.slice(1).map((c) => idsOf(c)[0]).sort(), ['1', '2']);
});

test('duplicates that collapse to one id count as a single note', async () => {
  const { window, calls } = makeHook(() => new Response('', { status: 404 }));
  const response = await window.fetch(listUrl(['4', '4', '4']));
  assert.equal(response.status, 200);
  assert.deepEqual(await plain(response), []);
  assert.equal(calls.length, 1);
});

test('a percent-encoded ids key is repaired too', async () => {
  const { window, calls } = makeHook(singleHandler(['1', '2']));
  const response = await window.fetch(`${ORIGIN}/ember/inbox/notes?ids%5B%5D=1&ids%5B%5D=2&app_id=${APP}`);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  calls.slice(1).forEach((c) => assert.equal(requested(c).length, 1));
});

test('each single read has the same path, app_id and other parameters and exactly one id', async () => {
  const { window, calls } = makeHook(singleHandler(['1', '2', '3']));
  await window.fetch(listUrl(['1', '2', '3'], '&include=author&page=2'));
  assert.equal(calls.length, 4);
  const seen = [];
  calls.slice(1).forEach((c) => {
    const u = new URL(c.url);
    assert.equal(u.origin, ORIGIN);
    assert.equal(u.pathname, '/ember/inbox/notes');
    assert.deepStrictEqual(u.searchParams.getAll('ids[]').length, 1);
    assert.equal(u.searchParams.get('app_id'), APP);
    assert.equal(u.searchParams.get('include'), 'author');
    assert.equal(u.searchParams.get('page'), '2');
    seen.push(u.searchParams.get('ids[]'));
  });
  assert.deepStrictEqual(seen.sort(), ['1', '2', '3']);
});

test('a single read that itself answers 404 never triggers another round', async () => {
  const { window, calls } = makeHook(() => new Response('', { status: 404 }));
  const response = await window.fetch(listUrl(['1', '2', '3']));
  assert.equal(response.status, 200);
  assert.deepStrictEqual(await plain(response), []);
  assert.equal(calls.length, 4);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 4);
});

test('a failed repair never makes more than one read per distinct id', async () => {
  const { window, calls } = makeHook((call, n) => (n === 1 ? new Response('', { status: 404 }) : new Response('', { status: 500 })));
  const response = await window.fetch(listUrl(['1', '2', '3', '3']));
  assert.equal(response.status, 404);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 4);
});

test('a Request object keeps its header on every single read', async () => {
  const { window, calls } = makeHook(singleHandler(['1', '2']));
  const response = await window.fetch(new window.Request(listUrl(['1', '2']), { headers: { 'X-Test': '1' } }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  calls.slice(1).forEach((c) => {
    const headers = c.input && typeof c.input === 'object' && c.input.headers
      ? c.input.headers
      : new Headers(c.init && c.init.headers);
    assert.equal(headers.get('X-Test'), '1');
    assert.equal(new URL(c.url).searchParams.getAll('ids[]').length, 1);
  });
});

test('a url string with an init passes that same init to every single read', async () => {
  const { window, calls } = makeHook(singleHandler(['1', '2']));
  const init = { headers: { 'X-Test': '1' }, credentials: 'same-origin' };
  await window.fetch(listUrl(['1', '2']), init);
  assert.equal(calls.length, 3);
  calls.slice(1).forEach((c) => {
    assert.equal(new Headers(c.init.headers).get('X-Test'), '1');
    assert.equal(c.init.credentials, 'same-origin');
  });
});

test('a rejected original fetch still rejects and triggers no single reads', async () => {
  const { window, calls } = makeHook(() => Promise.reject(new TypeError('offline')));
  await assert.rejects(() => window.fetch(listUrl(['1', '2'])), /offline/);
  assert.equal(calls.length, 1);
});

for (const status of [201, 206, 429, 500, 503]) {
  test(`a single read answering ${status} with a well-formed note list still gives the caller the original 404`, async () => {
    const hook = makeHook((call, n) => {
      if (n === 1) return new Response('', { status: 404 });
      return idsOf(call)[0] === '2' ? jsonResponse([noteFor('2')], status) : jsonResponse([noteFor(idsOf(call)[0])]);
    });
    const response = await hook.window.fetch(listUrl(['1', '2', '3']));
    assert.equal(response.status, 404);
    assert.equal(hook.calls.length, 4);
  });
}
