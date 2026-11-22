'use strict';

process.env.TZ = 'Europe/Warsaw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSidebar, savedNote, temporaryNoteCard, WORKSPACE, CONTACT } = require('../support/temporary-notes-harness');

const NOW = Date.parse('2026-11-22T14:00:00.000Z');
const PLAIN_ID = '9';
const BROKEN = '<p>text</p><p>[ISA-AUTO-DELETE:v1;broken]</p>';

function setup({ serverBody = 'server text', notes = savedNote(PLAIN_ID, '<p>plain note</p>') } = {}) {
  const win = loadSidebar({ notes });
  win.Date.now = () => NOW;
  const calls = [];
  let body = serverBody;
  win.fetch = async (url, init = {}) => {
    const reply = payload => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) });
    if (!String(url).includes('/ember/inbox/notes')) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
    const method = init.method || 'GET';
    calls.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const note = { id: Number(PLAIN_ID), body, created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z' };
    if (method === 'PUT') { body = JSON.parse(init.body).body; return reply({ ...note, body }); }
    return reply([note]);
  };
  win.refreshTemporaryNoteFooters();
  const card = id => win.document.querySelector(`[data-testid="note-${id}"] [data-testid="note-body"]`);
  const layer = () => win.document.querySelector('.isa-temporary-note-expiry-editor');
  const button = text => [...layer().querySelectorAll('button')].find(item => item.textContent === text);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return { win, calls, card, layer, button, settle };
}

test('a note with no auto-delete offers "+ Auto-delete" once; a note that has it, or carries a broken marker, does not', () => {
  const t = setup({ notes: savedNote(PLAIN_ID, '<p>plain note</p>') + temporaryNoteCard() + savedNote('11', BROKEN) });
  t.win.refreshTemporaryNoteFooters();
  const offers = Array.from(t.win.document.querySelectorAll('.isa-temporary-note-add'), node => node.closest('[data-testid^="note-"]:not([data-testid="note-body"])').getAttribute('data-testid'));
  assert.deepEqual(offers, [`note-${PLAIN_ID}`]);
  const offer = t.card(PLAIN_ID).querySelector('.isa-temporary-note-add');
  assert.equal(offer.textContent, '+ Auto-delete');
  assert.equal(offer.getAttribute('role'), 'button');
  assert.equal(offer.tabIndex, 0);
});

test('adding auto-delete saves the server text plus a new footer and shows the expiry line', async () => {
  const t = setup();
  t.card(PLAIN_ID).querySelector('.isa-temporary-note-add').click();
  assert.equal(t.layer().getAttribute('aria-label'), 'Add auto-delete');
  assert.equal(t.layer().querySelector('[role="combobox"]').firstChild.textContent, '30 days');
  assert.equal(t.layer().querySelector('input[aria-label="Auto-delete"]').checked, true);
  t.button('Save').click();
  await t.settle();
  await t.settle();
  assert.deepEqual(t.calls.map(call => call.method), ['GET', 'PUT']);
  const put = t.calls[1];
  assert.match(put.url, new RegExp(`/ember/inbox/notes/${PLAIN_ID}\\?app_id=${WORKSPACE}$`));
  const expires = new Date(NOW + 30 * 86400000).toISOString();
  const match = /^server text\n\nAuto-delete after: 2026-12-22 14:00 UTC\n\[ISA-AUTO-DELETE:v1;workspace=([^;]+);contact=([^;]+);expires=([^;]+);token=([0-9a-f-]{36})\]$/.exec(put.body.body);
  assert.ok(match, put.body.body);
  assert.deepEqual([match[1], match[2], match[3]], [WORKSPACE, CONTACT, expires]);
  assert.equal(put.body.app_id, WORKSPACE);
  assert.equal(t.layer(), null);
  assert.match(t.card(PLAIN_ID).querySelector('.isa-temporary-note-chip').textContent, /^Expires 2026-12-22 14:00 UTC$/);
  assert.equal(t.card(PLAIN_ID).querySelector('.isa-temporary-note-add'), null);
});

test('a note that gained auto-delete data elsewhere is refused, never given a second footer', async () => {
  const withFooter = 'server text\n\nAuto-delete after: 2026-12-01 10:00 UTC\n[ISA-AUTO-DELETE:v1;workspace=demo1234;contact=9007c24da170bbadc8e2598d;expires=2026-12-01T10:00:00.000Z;token=aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa]';
  for (const serverBody of [withFooter, 'text [ISA-AUTO-DELETE:v1;broken]']) {
    const t = setup({ serverBody });
    t.card(PLAIN_ID).querySelector('.isa-temporary-note-add').click();
    t.button('Save').click();
    await t.settle();
    await t.settle();
    assert.deepEqual(t.calls.map(call => call.method), ['GET']);
    assert.equal(t.layer().querySelector('[role="status"]').textContent, 'This note changed. Refresh the page and try again.');
    assert.ok(t.card(PLAIN_ID).querySelector('.isa-temporary-note-add'));
  }
});

test('unticking Auto-delete in the add panel and saving changes nothing', async () => {
  const t = setup();
  t.card(PLAIN_ID).querySelector('.isa-temporary-note-add').click();
  const toggle = t.layer().querySelector('input[aria-label="Auto-delete"]');
  toggle.checked = false;
  toggle.dispatchEvent(new t.win.Event('change'));
  t.button('Save').click();
  await t.settle();
  await t.settle();
  assert.deepEqual(t.calls.map(call => call.method), ['GET']);
  assert.equal(t.layer(), null);
  assert.equal(t.card(PLAIN_ID).querySelector('.isa-temporary-note-chip'), null);
  assert.ok(t.card(PLAIN_ID).querySelector('.isa-temporary-note-add'));
});

test('the style rule makes the host tooltip layer click-through', () => {
  const t = setup();
  const css = t.win.document.getElementById('isa-temporary-note-edit-style').textContent;
  assert.match(css, /\[data-base-ui-portal\] > \[role="presentation"\]:has\(> \[role="tooltip"\]\[data-testid="tooltip-content"\]\) \{ pointer-events: none !important; \}/);
});
