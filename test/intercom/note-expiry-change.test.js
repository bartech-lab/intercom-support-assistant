'use strict';

process.env.TZ = 'Europe/Warsaw';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSidebar, savedNote, temporaryNoteCard, press, optionRows, settled,
  ORIGIN, WORKSPACE, CONTACT, SAVED_NOTE_ID } = require('../support/temporary-notes-harness');

const NOTE_UUID = 'aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa';
const OTHER_UUID = 'bbbbcccc-dddd-4eee-8fff-aaaabbbbcccc';
const OLD_ISO = '2026-09-09T07:55:12.120Z';
const NOW = Date.UTC(2026, 8, 1, 10, 0, 0, 0);
const NOTE = SAVED_NOTE_ID;
const UNKNOWN = 'This note may already be saved. Copy your text, refresh the page and check before saving again.';
const UNREADABLE = 'This note could not be read. Refresh the page and try again.';
const CHANGED = 'This note changed. Refresh the page and try again.';
const NOT_SAVED = 'The date was not saved. Try again.';

function markerFor({ workspace = WORKSPACE, contact = CONTACT, expires = OLD_ISO, token = NOTE_UUID } = {}) {
  return `[ISA-AUTO-DELETE:v1;workspace=${workspace};contact=${contact};expires=${expires};token=${token}]`;
}

const OLD_FOOTER = `Auto-delete after: 2026-09-09 07:55 UTC\n${markerFor()}`;

function withFooter(text, footer = OLD_FOOTER) {
  return `${text}\n\n${footer}`;
}

function reply(payload, ok = true, status = ok ? 200 : 500) {
  return { ok, status, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
}

function serverNote(body, id = NOTE) {
  return { id, body, created_at: '2026-09-01T08:00:00.000Z', updated_at: '2026-09-01T08:00:00.000Z' };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await settled();
}

function start({ notes = temporaryNoteCard(), body = withFooter('server text'), get = null, put = null,
  now = NOW } = {}) {
  const win = loadSidebar({ notes });
  win.Date.now = () => now;
  const calls = [];
  win.fetch = async (url, init = {}) => {
    const target = new URL(url);
    if (!target.pathname.startsWith('/ember/inbox/notes')) return reply({}, false, 404);
    const call = {
      method: init.method,
      url: target,
      headers: { ...(init.headers || {}) },
      body: init.body ? JSON.parse(init.body) : null
    };
    calls.push(call);
    if (call.method === 'GET') return get ? get(call) : reply([serverNote(body)]);
    if (put) return put(call);
    return reply(serverNote(call.body.body));
  };
  win.refreshTemporaryNoteFooters();
  const ctx = {
    win,
    calls,
    puts: () => calls.filter(call => call.method === 'PUT'),
    gets: () => calls.filter(call => call.method === 'GET'),
    chips: () => [...win.document.querySelectorAll('.isa-temporary-note-chip')],
    chip: () => win.document.querySelector('.isa-temporary-note-chip'),
    layers: () => [...win.document.querySelectorAll('.isa-temporary-note-expiry-editor')],
    layer: () => win.document.querySelector('.isa-temporary-note-expiry-editor'),
    open: () => {
      ctx.chip().click();
      return ctx.layer();
    }
  };
  return ctx;
}

function fieldsOf(layer) {
  const buttons = [...layer.querySelectorAll('button')];
  return {
    toggle: layer.querySelector('input[aria-label="Auto-delete"]'),
    choice: layer.querySelector('[role="combobox"][aria-label="Auto-delete lifetime"]'),
    date: layer.querySelector('input[aria-label="Auto-delete date as DD/MM/YYYY"]'),
    time: layer.querySelector('input[aria-label="Auto-delete time, 24-hour clock"]'),
    preview: layer.querySelector('.isa-temporary-note-preview'),
    status: layer.querySelector('[role="status"]'),
    cancel: buttons.find(button => button.textContent === 'Cancel'),
    save: buttons.find(button => button.textContent === 'Save')
  };
}

function typeInto(win, input, value) {
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
}

function setLocal(win, layer, day, time) {
  const fields = fieldsOf(layer);
  typeInto(win, fields.date, day);
  typeInto(win, fields.time, time);
}

function uncheck(win, layer) {
  const { toggle } = fieldsOf(layer);
  toggle.checked = false;
  toggle.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function pickPreset(win, layer, label) {
  const { choice } = fieldsOf(layer);
  press(win, choice, 'click');
  const row = optionRows(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer()).find(item => item.textContent === label);
  assert.ok(row, `no dropdown row reads ${label}`);
  press(win, row, 'click');
}

function two() {
  return temporaryNoteCard() + savedNote('9',
    `<p>other</p>\n\n<p>Auto-delete after: 2026-09-09 07:55 UTC<br>\n${markerFor()}</p>`);
}

test('a saved note chip reads Expires with UTC, is a focusable button and ends its tooltip with Click to change.', () => {
  const ui = start();
  const chip = ui.chip();
  assert.equal(ui.chips().length, 1);
  assert.match(chip.textContent, /^Expires .*UTC/);
  assert.equal(chip.getAttribute('role'), 'button');
  assert.equal(chip.tabIndex, 0);
  assert.match(chip.title, /Click to change\.$/);
});

test('clicking the chip opens one fixed dialog on the page body', () => {
  const ui = start();
  const layer = ui.open();
  assert.equal(ui.layers().length, 1);
  assert.equal(layer.parentElement, ui.win.document.body);
  assert.equal(layer.getAttribute('role'), 'dialog');
  assert.equal(layer.style.position, 'fixed');
});

test('Enter and Space on the chip open the panel', () => {
  for (const key of ['Enter', ' ']) {
    const ui = start();
    ui.chip().dispatchEvent(new ui.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    assert.equal(ui.layers().length, 1, `key ${JSON.stringify(key)} did not open the panel`);
  }
});

test('a click on the chip never reaches click, pointerdown or mousedown listeners on the body', () => {
  const ui = start();
  const seen = [];
  ['click', 'pointerdown', 'mousedown'].forEach((type) => {
    ui.win.document.body.addEventListener(type, () => seen.push(type));
  });
  press(ui.win, ui.chip(), 'pointerdown');
  press(ui.win, ui.chip(), 'mousedown');
  press(ui.win, ui.chip(), 'click');
  assert.deepEqual(seen, []);
  assert.equal(ui.layers().length, 1);
});

test('a note whose footer belongs to another contact or workspace gets no panel', () => {
  const foreign = [
    markerFor({ contact: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    markerFor({ workspace: 'otherws1' })
  ];
  for (const marker of foreign) {
    const ui = start({ notes: savedNote('777', `<p>x</p>\n\n<p>Auto-delete after: 2026-09-09 07:55 UTC<br>\n${marker}</p>`) });
    assert.equal(ui.chips().length, 1);
    ui.chip().click();
    assert.equal(ui.layers().length, 0);
  }
});

test('the panel carries the add-note controls prefilled with the current expiry in local time', () => {
  const ui = start();
  const fields = fieldsOf(ui.open());
  assert.equal(fields.toggle.checked, true);
  assert.equal(fields.choice.textContent.includes('Custom date'), true);
  assert.equal(fields.date.value, '09/09/2026');
  assert.equal(fields.time.value, '09:55');
  assert.ok(fields.preview);
  assert.equal(fields.cancel.textContent, 'Cancel');
  assert.equal(fields.save.textContent, 'Save');
});

test('unchanged, the preview shows the current deadline and Save is enabled even when it is already past', () => {
  const ui = start({ now: Date.UTC(2026, 10, 22, 12, 0, 0) });
  const fields = fieldsOf(ui.open());
  assert.match(fields.preview.textContent, /UTC/);
  assert.equal(fields.save.disabled, false);
});

test('Cancel closes the panel, sends nothing and returns focus to the chip', () => {
  const ui = start();
  fieldsOf(ui.open()).cancel.click();
  assert.equal(ui.layers().length, 0);
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.win.document.activeElement, ui.chip());
});

test('Escape closes the panel, sends nothing and returns focus to the chip', () => {
  const ui = start();
  ui.open();
  ui.win.document.dispatchEvent(new ui.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(ui.layers().length, 0);
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.win.document.activeElement, ui.chip());
});

test('a pointerdown elsewhere closes the panel and sends nothing, but one inside it does not', () => {
  const ui = start();
  const layer = ui.open();
  press(ui.win, fieldsOf(layer).preview, 'pointerdown');
  assert.equal(ui.layers().length, 1);
  press(ui.win, ui.win.document.body, 'pointerdown');
  assert.equal(ui.layers().length, 0);
  assert.equal(ui.calls.length, 0);
});

test('only one panel stays open when the same chip or another note chip is clicked', () => {
  const ui = start({ notes: two() });
  const [first, second] = ui.chips();
  first.click();
  first.click();
  assert.equal(ui.layers().length, 1);
  second.click();
  assert.equal(ui.layers().length, 1);
});

test('an emptied time field disables Save and replaces the deadline with a problem text', () => {
  const ui = start();
  const layer = ui.open();
  typeInto(ui.win, fieldsOf(layer).time, '');
  const fields = fieldsOf(layer);
  assert.equal(fields.save.disabled, true);
  assert.notEqual(fields.preview.textContent, '');
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(fields.preview.textContent), false);
});

test('saving a new date reads the note, writes the server text with the same token and updates the chip', async () => {
  const ui = start({ body: withFooter('server text') });
  const layer = ui.open();
  setLocal(ui.win, layer, '10/09/2026', '10:30');
  fieldsOf(layer).save.click();
  await flush();
  assert.equal(ui.calls.length, 2);
  const [get, put] = ui.calls;
  assert.equal(get.method, 'GET');
  assert.equal(get.url.pathname, '/ember/inbox/notes');
  assert.equal(get.url.searchParams.get('app_id'), WORKSPACE);
  assert.deepEqual(Array.from(get.url.searchParams.getAll('ids[]')), [NOTE]);
  assert.equal(put.method, 'PUT');
  assert.equal(put.url.pathname, `/ember/inbox/notes/${NOTE}`);
  assert.equal(put.url.searchParams.get('app_id'), WORKSPACE);
  assert.equal(put.headers['Content-Type'], 'application/json');
  assert.deepEqual(Object.keys(put.body).sort(), ['app_id', 'body']);
  assert.equal(put.body.app_id, WORKSPACE);
  const expected = `server text\n\nAuto-delete after: 2026-09-10 08:30 UTC\n${markerFor({ expires: '2026-09-10T08:30:00.000Z' })}`;
  assert.equal(put.body.body, expected);
  assert.equal(put.body.body.endsWith(']'), true);
  assert.equal(ui.layers().length, 0);
  assert.equal(ui.chip().textContent, 'Expires 2026-09-10 08:30 UTC');
});

test('turning auto-delete off writes exactly the server text without any footer and removes the chip', async () => {
  const ui = start({ body: withFooter('server text') });
  const layer = ui.open();
  uncheck(ui.win, layer);
  fieldsOf(layer).save.click();
  await flush();
  assert.equal(ui.puts().length, 1);
  assert.equal(ui.puts()[0].body.body, 'server text');
  assert.equal(ui.layers().length, 0);
  assert.equal(ui.chips().length, 0);
});

test('a preset writes the page clock at save time plus the preset duration', async () => {
  const ui = start({ body: withFooter('server text') });
  const layer = ui.open();
  pickPreset(ui.win, layer, '1 hour');
  fieldsOf(layer).save.click();
  await flush();
  assert.equal(ui.puts().length, 1);
  const expected = `server text\n\nAuto-delete after: 2026-09-01 11:00 UTC\n${markerFor({ expires: '2026-09-01T11:00:00.000Z' })}`;
  assert.equal(ui.puts()[0].body.body, expected);
  assert.equal(ui.chip().textContent, 'Expires 2026-09-01 11:00 UTC');
});

test('saving without any change sends no write and closes the panel, even for a past deadline', async () => {
  const ui = start({ now: Date.UTC(2026, 10, 22, 12, 0, 0) });
  const layer = ui.open();
  fieldsOf(layer).save.click();
  await flush();
  assert.equal(ui.puts().length, 0);
  assert.equal(ui.layers().length, 0);
  assert.equal(ui.chip().textContent, 'Expires 2026-09-09 07:55 UTC');
});

test('while the write is in flight both buttons are off, a second Save and an outside click do nothing, and the chip stays old', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ui = start({
    body: withFooter('server text'),
    put: async (call) => {
      await gate;
      return reply(serverNote(call.body.body));
    }
  });
  const layer = ui.open();
  setLocal(ui.win, layer, '10/09/2026', '10:30');
  const fields = fieldsOf(layer);
  fields.save.click();
  await flush();
  assert.equal(fields.save.disabled, true);
  assert.equal(fields.cancel.disabled, true);
  fields.save.click();
  press(ui.win, ui.win.document.body, 'pointerdown');
  await flush();
  assert.equal(ui.layers().length, 1);
  assert.equal(ui.gets().length, 1);
  assert.equal(ui.puts().length, 1);
  assert.equal(ui.chip().textContent, 'Expires 2026-09-09 07:55 UTC');
  release();
  await flush();
  assert.equal(ui.puts().length, 1);
  assert.equal(ui.layers().length, 0);
  assert.equal(ui.chip().textContent, 'Expires 2026-09-10 08:30 UTC');
});

async function failedSave(options) {
  const ui = start(options);
  const layer = ui.open();
  setLocal(ui.win, layer, '10/09/2026', '10:30');
  fieldsOf(layer).save.click();
  await flush();
  return { ui, layer, fields: fieldsOf(layer) };
}

function assertStillOpen(result, message) {
  assert.equal(result.ui.layers().length, 1);
  assert.equal(result.fields.status.textContent, message);
  assert.equal(result.ui.chip().textContent, 'Expires 2026-09-09 07:55 UTC');
}

test('a failed read keeps the panel open with the unreadable message and sends no write', async () => {
  const result = await failedSave({ get: () => reply({}, false, 500) });
  assertStillOpen(result, UNREADABLE);
  assert.equal(result.ui.puts().length, 0);
});

test('a read that does not contain the note keeps the panel open with the unreadable message', async () => {
  const result = await failedSave({ get: () => reply({ notes: [serverNote('other', '1')] }) });
  assertStillOpen(result, UNREADABLE);
  assert.equal(result.ui.puts().length, 0);
});

test('a server note without a usable matching footer shows the changed message and sends no write', async () => {
  const bodies = {
    'no footer': 'server text',
    'invalid footer': 'server text\n\nAuto-delete after: 2026-09-09 07:55 UTC\n[ISA-AUTO-DELETE:v1;workspace=demo1234]',
    'different token': withFooter('server text', `Auto-delete after: 2026-09-09 07:55 UTC\n${markerFor({ token: OTHER_UUID })}`),
    'other contact': withFooter('server text', `Auto-delete after: 2026-09-09 07:55 UTC\n${markerFor({ contact: 'aaaaaaaaaaaaaaaaaaaaaaaa' })}`)
  };
  for (const [name, body] of Object.entries(bodies)) {
    const result = await failedSave({ body });
    assert.equal(result.ui.layers().length, 1, name);
    assert.equal(result.fields.status.textContent, CHANGED, name);
    assert.equal(result.ui.puts().length, 0, name);
    assert.equal(result.ui.chip().textContent, 'Expires 2026-09-09 07:55 UTC', name);
  }
});

test('a refused write shows the not saved message, keeps the old chip and lets Save be clicked again', async () => {
  let refuse = true;
  const result = await failedSave({
    put: (call) => (refuse ? reply({}, false, 422) : reply(serverNote(call.body.body)))
  });
  assertStillOpen(result, NOT_SAVED);
  assert.equal(result.fields.save.disabled, false);
  refuse = false;
  result.fields.save.click();
  await flush();
  assert.equal(result.ui.puts().length, 2);
  assert.equal(result.ui.layers().length, 0);
  assert.equal(result.ui.chip().textContent, 'Expires 2026-09-10 08:30 UTC');
});

test('an accepted write that returns a different body shows the unknown result message and disables Save', async () => {
  const result = await failedSave({ put: () => reply(serverNote('something else')) });
  assertStillOpen(result, UNKNOWN);
  assert.equal(result.fields.save.disabled, true);
});

test('a rejected write or read shows the unknown result message and disables Save', async () => {
  const writeFails = await failedSave({ put: async () => { throw new Error('network'); } });
  assertStillOpen(writeFails, UNKNOWN);
  assert.equal(writeFails.fields.save.disabled, true);
  const readFails = await failedSave({ get: async () => { throw new Error('network'); } });
  assertStillOpen(readFails, UNKNOWN);
  assert.equal(readFails.fields.save.disabled, true);
});

function openEditor(ui, value, noteId = NOTE) {
  const card = ui.win.document.querySelector(`[data-testid="note-${noteId}"]`);
  const textarea = ui.win.document.createElement('textarea');
  textarea.setAttribute('aria-label', 'Edit note');
  textarea.value = value;
  card.appendChild(textarea);
  return textarea;
}

function recordPosts(win) {
  const seen = [];
  const post = win.postMessage.bind(win);
  win.postMessage = (message, origin) => {
    seen.push(message);
    return post(message, origin);
  };
  return () => seen.filter(item => item && item.__isaTempNote && /^edit-/.test(item.kind)).map(item => ({ ...item }));
}

async function changeThrough(ui, change) {
  const layer = ui.open();
  change(layer);
  fieldsOf(layer).save.click();
  await flush();
  assert.equal(ui.layers().length, 0);
}

test('after the expiry was changed, Intercom opening its editor reports the new instant and the same token', async () => {
  const ui = start({ body: withFooter('server text') });
  await changeThrough(ui, layer => setLocal(ui.win, layer, '10/09/2026', '10:30'));
  const edits = recordPosts(ui.win);
  openEditor(ui, withFooter('próba'));
  ui.win.refreshTemporaryNoteFooters();
  const posted = edits();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].kind, 'edit-keep');
  assert.equal(posted[0].noteId, NOTE);
  assert.equal(posted[0].token, NOTE_UUID);
  assert.equal(posted[0].expiresAt, '2026-09-10T08:30:00.000Z');
});

test('after auto-delete was turned off, an editor with the old footer is forgotten and its footer removed at once', async () => {
  const ui = start({ body: withFooter('server text') });
  await changeThrough(ui, layer => uncheck(ui.win, layer));
  const edits = recordPosts(ui.win);
  const textarea = openEditor(ui, withFooter('próba'));
  ui.win.refreshTemporaryNoteFooters();
  const posted = edits();
  assert.deepEqual(posted.map(item => item.kind), ['edit-forget']);
  assert.equal(posted[0].noteId, NOTE);
  assert.equal(textarea.value, 'próba');
});

function net(options = {}) {
  const ui = start({ notes: savedNote(NOTE, '<p>próba</p>'), ...options });
  const timers = [];
  const closeEditor = () => {
    const textarea = openEditor(ui, withFooter('próba'));
    ui.win.refreshTemporaryNoteFooters();
    ui.win.handleIntercomBridgeMessage({
      source: ui.win,
      origin: ORIGIN,
      data: { __isaic: true, version: 1, kind: 'temporary-note-edit', noteId: NOTE, status: 'kept', token: null, revision: null }
    });
    textarea.remove();
    ui.calls.length = 0;
    ui.win.setTimeout = (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    };
    ui.win.refreshTemporaryNoteFooters();
  };
  const checks = () => timers.filter(timer => timer.ms === 2000);
  return { ui, timers, closeEditor, checks };
}

test('the safety net checks the server 2000 ms after an editor with a hidden footer closes', async () => {
  const run = net();
  run.closeEditor();
  assert.equal(run.checks().length, 1);
  assert.equal(run.ui.calls.length, 0);
  await run.checks()[0].fn();
  assert.equal(run.ui.gets().length, 1);
  assert.equal(run.ui.gets()[0].url.searchParams.get('app_id'), WORKSPACE);
  assert.deepEqual(Array.from(run.ui.gets()[0].url.searchParams.getAll('ids[]')), [NOTE]);
});

test('the safety net writes nothing when the server body still ends with any footer', async () => {
  const bodies = [
    withFooter('server text'),
    'server text\n\nAuto-delete after: 2026-09-09 07:55 UTC\n[ISA-AUTO-DELETE:v1;workspace=demo1234]'
  ];
  for (const body of bodies) {
    const run = net({ body });
    run.closeEditor();
    await run.checks()[0].fn();
    assert.equal(run.ui.gets().length, 1);
    assert.equal(run.ui.puts().length, 0);
  }
});

test('the safety net restores the original footer onto a server body with no marker and the chip returns', async () => {
  const run = net({ body: 'edited text' });
  run.closeEditor();
  await run.checks()[0].fn();
  await flush();
  assert.equal(run.ui.puts().length, 1);
  assert.equal(run.ui.puts()[0].url.pathname, `/ember/inbox/notes/${NOTE}`);
  assert.equal(run.ui.puts()[0].body.body, `edited text\n\n${OLD_FOOTER}`);
  run.ui.win.refreshTemporaryNoteFooters();
  assert.equal(run.ui.chips().length, 1);
  assert.match(run.ui.chip().textContent, /^Expires /);
});

test('the safety net does nothing and throws nothing when the read fails or rejects', async () => {
  const failures = [() => reply({}, false, 500), async () => { throw new Error('network'); }];
  for (const get of failures) {
    const run = net({ get });
    run.closeEditor();
    await run.checks()[0].fn();
    await flush();
    assert.equal(run.ui.puts().length, 0);
  }
});

test('an editor that closes without its footer ever being hidden schedules no check and writes nothing', async () => {
  const run = net();
  const textarea = openEditor(run.ui, withFooter('próba'));
  run.ui.win.refreshTemporaryNoteFooters();
  textarea.remove();
  run.ui.win.setTimeout = (fn, ms) => {
    run.timers.push({ fn, ms });
    return run.timers.length;
  };
  run.ui.win.refreshTemporaryNoteFooters();
  const plain = openEditor(run.ui, 'ordinary note');
  run.ui.win.refreshTemporaryNoteFooters();
  plain.remove();
  run.ui.win.refreshTemporaryNoteFooters();
  await flush();
  assert.equal(run.checks().length, 0);
  assert.equal(run.ui.puts().length, 0);
  assert.equal(run.ui.gets().length, 1, 'only the read that checks the server date when the edit box opened');
});
