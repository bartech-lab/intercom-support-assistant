'use strict';

process.env.TZ = 'Europe/Warsaw';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ORIGIN, WORKSPACE, CONTACT, loadSidebar, controlsOf, enable } = require('../support/temporary-notes-harness');

const KEY = `${WORKSPACE}:${CONTACT}`;

function previewFor(fields) {
  const win = loadSidebar();
  const panel = controlsOf(win);
  Object.assign(win.ISA_TEMPORARY_NOTES_UI.getDraft(KEY), fields);
  enable(win, panel);
  return { win, panel, text: panel.preview.textContent, title: panel.preview.title };
}

function armed(fields) {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const seen = [];
  const post = win.postMessage.bind(win);
  win.postMessage = (message, origin) => { seen.push(message); return post(message, origin); };
  Object.assign(win.ISA_TEMPORARY_NOTES_UI.getDraft(KEY), fields);
  enable(win, panel);
  return seen[seen.length - 1];
}

function futureDay(daysAhead) {
  const date = new Date(Date.now() + daysAhead * 86400000);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextSpringForward() {
  for (let year = new Date().getFullYear(); ; year += 1) {
    const day = new Date(year, 2, 31);
    day.setDate(31 - day.getDay());
    if (day.getTime() > Date.now() + 86400000) return `${year}-03-${day.getDate()}`;
  }
}

test('characterization: a preset arms a relative lifetime of its own length', () => {
  const message = armed({ choice: '3600000' });
  assert.equal(message.kind, 'arm');
  assert.deepEqual({ ...message.lifetime }, { mode: 'relative', delayMs: 3600000 });
});

test('characterization: a custom delay arms amount times unit, and a custom date arms the UTC instant', () => {
  const delay = armed({ choice: 'custom-delay', amount: '36', unit: 'hours' });
  assert.deepEqual({ ...delay.lifetime }, { mode: 'relative', delayMs: 36 * 3600000 });
  const days = armed({ choice: 'custom-delay', amount: '2', unit: 'days' });
  assert.deepEqual({ ...days.lifetime }, { mode: 'relative', delayMs: 2 * 86400000 });
  const day = futureDay(10);
  const date = armed({ choice: 'custom-date', day, time: '9:05' });
  assert.deepEqual({ ...date.lifetime }, { mode: 'absolute', expiresAt: new Date(`${day}T09:05:00`).toISOString() });
});

test('characterization: an unusable lifetime disarms instead of arming', () => {
  for (const fields of [
    { choice: 'custom-delay', amount: '', unit: 'hours' },
    { choice: 'custom-delay', amount: '0', unit: 'hours' },
    { choice: 'custom-delay', amount: '5', unit: 'months' },
    { choice: 'custom-date', day: '', time: '10:00' },
    { choice: 'custom-date', day: futureDay(10), time: '' },
    { choice: 'custom-date', day: nextSpringForward(), time: '02:30' },
    { choice: 'not-a-preset' }
  ]) {
    assert.equal(armed(fields).kind, 'disarm', JSON.stringify(fields));
  }
});

test('the custom delay message gives the range in the chosen unit', () => {
  for (const amount of ['', '0', '99999']) {
    assert.equal(previewFor({ choice: 'custom-delay', amount, unit: 'days' }).text, 'Enter 1 to 3650 days.');
    assert.equal(previewFor({ choice: 'custom-delay', amount, unit: 'hours' }).text, 'Enter 1 to 87600 hours.');
  }
  assert.equal(previewFor({ choice: 'custom-delay', amount: '3650', unit: 'days' }).text.startsWith('Enter'), false,
    'the stated upper bound is itself accepted');
  assert.equal(previewFor({ choice: 'custom-delay', amount: '87600', unit: 'hours' }).text.startsWith('Enter'), false);
  assert.equal(previewFor({ choice: 'custom-delay', amount: '3651', unit: 'days' }).text, 'Enter 1 to 3650 days.');
});

test('the message for a choice that is not a preset', () => {
  assert.equal(previewFor({ choice: 'not-a-preset' }).text, 'Pick an auto-delete lifetime.');
});

test('the custom date messages, one per missing or impossible part', () => {
  const day = futureDay(10);
  assert.equal(previewFor({ choice: 'custom-date', day: '', time: '' }).text,
    'Pick a date as DD/MM/YYYY and a time as HH:MM.');
  assert.equal(previewFor({ choice: 'custom-date', day: '', time: '10:00' }).text,
    'Pick a date as DD/MM/YYYY and a time as HH:MM.');
  const clock = previewFor({ choice: 'custom-date', day, time: '' });
  assert.equal(clock.text, clock.win.ISA_FIELDS.CLOCK_ERROR);
  assert.equal(previewFor({ choice: 'custom-date', day, time: '7' }).text, clock.text);
  assert.equal(previewFor({ choice: 'custom-date', day: nextSpringForward(), time: '02:30' }).text,
    'That local time does not exist on this date. Pick another time.');
  assert.equal(previewFor({ choice: 'custom-date', day: '2020-01-01', time: '10:00' }).text,
    'Pick a date between 1 minute and 3650 days from now.');
  assert.equal(previewFor({ choice: 'custom-date', day: futureDay(3700), time: '10:00' }).text,
    'Pick a date between 1 minute and 3650 days from now.');
});

test('characterization: a usable lifetime shows the deadline summary with a local-time hint', () => {
  const shown = previewFor({ choice: 'custom-date', day: futureDay(10), time: '10:00' });
  assert.match(shown.text, /UTC/);
  assert.notEqual(shown.title, '');
  assert.equal(previewFor({ choice: 'not-a-preset' }).title, '');
});

test('a save with an unknown result tells the agent to copy the text, refresh and check', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  const state = win.ISA_TEMPORARY_NOTES_UI.getDraft(KEY);
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind: 'temporary-note-save', token: state.token,
      revision: state.revision, status: 'uncertain' }
  });
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.getPanel().status.textContent,
    'This note may already be saved. Copy your text, refresh the page and check before saving again.');
});
