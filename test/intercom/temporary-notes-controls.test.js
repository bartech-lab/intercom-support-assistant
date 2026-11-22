'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const {
  WORKSPACE,
  CONTACT,
  loadSidebar,
  controlsOf,
  enable,
  openMenu,
  optionRows,
  choose,
} = require('../support/temporary-notes-harness');

test('the notes composer gains an auto-delete control bound to the visible contact', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  assert.ok(panel.controls, 'controls mount beside the note input');
  assert.equal(panel.toggle.checked, false, 'auto-delete starts unchecked');
  assert.equal(panel.controls.querySelectorAll('input[type="checkbox"]').length, 1,
    'the composer carries no browser-wide setting');
  assert.equal(panel.choice.hidden, true, 'the lifetime picker stays hidden until auto-delete is on');
  assert.equal(panel.preview.hidden, true);
  assert.equal(panel.status.hidden, true);
});

test('every optional control is actually unrendered while auto-delete is off', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const optional = [panel.choice, panel.amount.parentElement, panel.date.parentElement,
    panel.preview, panel.status];
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.openMenuLayer(), null, 'no listbox layer exists yet');
  optional.forEach((element) => {
    assert.equal(win.getComputedStyle(element).display, 'none',
      `${element.tagName} still occupies the panel with auto-delete off`);
  });
  assert.equal(panel.controls.querySelectorAll(':scope > *:not([hidden])').length, 1,
    'only the checkbox label row is rendered with auto-delete off');
});

test('the duplicate note composer inside the inert pane never gets a second control', () => {
  const win = loadSidebar();
  assert.equal(win.document.querySelectorAll('textarea[data-testid="note-input"]').length, 2,
    'the capture carries two composers, one of them inert');
  win.refreshTemporaryNoteControls();
  assert.equal(win.document.querySelectorAll('.isa-temporary-note-controls').length, 1,
    'only the visible composer is decorated');
  const mounted = win.document.querySelector('.isa-temporary-note-controls');
  assert.equal(mounted.closest('[inert]'), null, 'the control never lands inside the inert pane');
});

test('the dropdown offers the presets and both custom entries, with 30 days selected', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  const layer = openMenu(win, panel.choice);
  assert.deepEqual(Array.from(optionRows(layer), row => row.textContent),
    ['1 hour', '4 hours', '12 hours', '1 day', '3 days', '7 days', '30 days', '90 days',
      'Custom delay', 'Custom date']);
  const selected = optionRows(layer).find(row => row.getAttribute('aria-selected') === 'true');
  assert.equal(selected.dataset.value, String(30 * 86400000), '30 days starts selected');
  win.ISA_TEMPORARY_NOTES_UI.closeMenu();
  choose(win, panel, 'custom-delay');
  const units = openMenu(win, panel.unit);
  assert.deepEqual(Array.from(optionRows(units), row => row.textContent), ['hours', 'days']);
});

test('turning auto-delete on shows one deadline line and no cleanup notice', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  assert.equal(panel.choice.hidden, false, 'the lifetime picker appears with auto-delete');
  assert.equal(panel.choice.style.display, 'inline-flex');
  assert.equal(win.getComputedStyle(panel.choice).display, 'flex',
    'a flex item computes to the block form of its display');
  assert.match(panel.preview.textContent,
    /^Expires \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  assert.equal(panel.status.hidden, true, 'an always-on cleanup has no news to report');
  assert.equal(panel.status.textContent, '');
  assert.equal(win.getComputedStyle(panel.amount.parentElement).display, 'none',
    'a preset never reveals the custom delay inputs');
  assert.equal(win.getComputedStyle(panel.date.parentElement).display, 'none');
});

test('choosing a custom delay reveals the number and unit, and hides the date input', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-delay');
  assert.equal(panel.amount.parentElement.hidden, false);
  assert.equal(win.getComputedStyle(panel.amount.parentElement).display, 'flex');
  assert.equal(panel.date.parentElement.hidden, true);
  assert.equal(win.getComputedStyle(panel.date.parentElement).display, 'none');

  const format = at => new win.Date(at + 36 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const before = Date.now();
  panel.amount.value = '36';
  panel.amount.dispatchEvent(new win.Event('input'));
  const after = Date.now();
  assert.ok([format(before), format(after)].map(value => `Expires ${value} UTC`).includes(panel.preview.textContent),
    panel.preview.textContent);

  panel.amount.value = '0';
  panel.amount.dispatchEvent(new win.Event('input'));
  assert.match(panel.preview.textContent, /^Enter 1 to 87600 hours\.$/);
});

test('choosing a custom date reveals the picker, and hides the delay inputs', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  assert.equal(panel.date.parentElement.hidden, false);
  assert.equal(win.getComputedStyle(panel.date.parentElement).display !== 'none', true);
  assert.equal(panel.amount.parentElement.hidden, true);
  assert.equal(win.getComputedStyle(panel.amount.parentElement).display, 'none');
  assert.equal(panel.date.type, 'text', 'a typed DD/MM/YYYY box, never the browser date picker');
  assert.equal(panel.date.placeholder, 'DD/MM/YYYY');
  assert.ok(panel.date.parentElement.querySelector('button[aria-label="Open calendar"]'), 'the shared calendar sits beside the date');
  assert.equal(panel.time.type, 'text');
  assert.equal(panel.time.placeholder, 'HH:MM');
  assert.match(panel.preview.textContent, /^Pick a date as DD\/MM\/YYYY and a time as HH:MM\.$/);

  const chosen = new win.Date(Date.now() + 3 * 86400000);
  const pad = value => String(value).padStart(2, '0');
  panel.date.value = `${pad(chosen.getDate())}/${pad(chosen.getMonth() + 1)}/${chosen.getFullYear()}`;
  panel.date.dispatchEvent(new win.Event('input'));
  assert.match(panel.preview.textContent, /HH:MM on a 24-hour clock/,
    'a date alone is not a deadline');
  panel.time.value = `${pad(chosen.getHours())}:${pad(chosen.getMinutes())}`;
  panel.time.dispatchEvent(new win.Event('input'));
  assert.match(panel.preview.textContent, /^Expires \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
});

test('the custom time is a 24-hour clock and never shows AM or PM', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  const chosen = new win.Date(Date.now() + 3 * 86400000);
  const pad = value => String(value).padStart(2, '0');
  panel.date.value = `${pad(chosen.getDate())}/${pad(chosen.getMonth() + 1)}/${chosen.getFullYear()}`;
  panel.date.dispatchEvent(new win.Event('input'));

  panel.time.value = '18:45';
  panel.time.dispatchEvent(new win.Event('input'));
  assert.doesNotMatch(panel.preview.textContent, /\b[AP]M\b/i);
  assert.doesNotMatch(panel.preview.title, /\b[AP]M\b/i, 'the local-time tooltip is 24-hour too');
  assert.match(panel.preview.title, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} local time$/);

  panel.time.value = '6:05';
  panel.time.dispatchEvent(new win.Event('input'));
  assert.match(panel.preview.textContent, /^Expires /, 'a single-digit hour is padded, not rejected');

  ['24:00', '18:60'].forEach((value) => {
    panel.time.value = value;
    panel.time.dispatchEvent(new win.Event('input'));
    assert.equal(panel.time.value, '06:05', `${value} is refused and the last valid time stays`);
  });
  ['6 PM', '18', '', 'abc'].forEach((value) => {
    panel.time.value = value;
    panel.time.dispatchEvent(new win.Event('input'));
    assert.match(panel.preview.textContent, /HH:MM on a 24-hour clock/,
      `${value || '(empty)'} is not a 24-hour time`);
  });
});

test('the time field only accepts characters that can form HH:MM', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  const type = (value) => {
    panel.time.value = value;
    panel.time.dispatchEvent(new win.Event('input'));
    return panel.time.value;
  };
  assert.equal(type('6 PM'), '06:', 'letters are dropped and an hour digit above 2 is padded');
  assert.equal(type('abc'), '');
  assert.equal(type('1'), '1', 'an hour digit 0 to 2 waits for the second digit');
  assert.equal(type('18'), '18:', 'a colon is inserted after two digits');
  assert.equal(type('18:4'), '18:4');
  assert.equal(type('18:45'), '18:45');
  assert.equal(type('18:45x'), '18:45');
  assert.equal(type('18:456'), '18:45', 'the field never grows past HH:MM');
  assert.equal(type('1845'), '18:45', 'a complete paste without a colon is formatted');
  assert.equal(type('1:2:3'), '18:45', 'a second colon is refused');
  assert.equal(type('25:00'), '18:45', 'an impossible paste is refused');
});

test('a malformed or out-of-range entry marks the field, and a valid one clears the mark', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  const pad = value => String(value).padStart(2, '0');
  const soon = new win.Date(Date.now() + 3 * 86400000);
  const setDate = (date) => {
    panel.date.value = date;
    panel.date.dispatchEvent(new win.Event('input'));
  };
  const setTime = (time) => {
    panel.time.value = time;
    panel.time.dispatchEvent(new win.Event('input'));
  };
  setDate(`${pad(soon.getDate())}/${pad(soon.getMonth() + 1)}/${soon.getFullYear()}`);

  setTime('25:00');
  assert.equal(panel.time.value, '', '25:00 cannot be entered');
  setTime('18:60');
  assert.equal(panel.time.value, '', '18:60 cannot be entered');
  setTime('18:4');
  assert.equal(panel.time.getAttribute('aria-invalid'), 'true', 'an unfinished time is marked');
  setTime('18:45');
  assert.equal(panel.time.getAttribute('aria-invalid'), 'false');
  assert.equal(panel.date.getAttribute('aria-invalid'), 'false');
  assert.match(panel.preview.textContent, /^Expires /);

  const past = new win.Date(Date.now() - 86400000);
  setDate(`${pad(past.getDate())}/${pad(past.getMonth() + 1)}/${past.getFullYear()}`);
  assert.equal(panel.date.getAttribute('aria-invalid'), 'true', 'yesterday is out of range');
  assert.equal(panel.time.getAttribute('aria-invalid'), 'false', 'no time could save yesterday, so the time is not to blame');
  assert.match(panel.preview.textContent, /between 1 minute and 3650 days/);

  const far = new win.Date(Date.now() + 4000 * 86400000);
  setDate(`${pad(far.getDate())}/${pad(far.getMonth() + 1)}/${far.getFullYear()}`);
  assert.equal(panel.date.getAttribute('aria-invalid'), 'true', 'beyond 3650 days is out of range');

  setDate('');
  assert.equal(panel.date.getAttribute('aria-invalid'), 'false',
    'an empty field is incomplete, not wrong');
});

test('an out-of-range custom delay marks the number field', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-delay');
  panel.amount.value = '36';
  panel.amount.dispatchEvent(new win.Event('input'));
  assert.equal(panel.amount.getAttribute('aria-invalid'), 'false');
  panel.amount.value = '0';
  panel.amount.dispatchEvent(new win.Event('input'));
  assert.equal(panel.amount.getAttribute('aria-invalid'), 'true');
  panel.amount.value = '99999';
  panel.amount.dispatchEvent(new win.Event('input'));
  assert.equal(panel.amount.getAttribute('aria-invalid'), 'true', 'past 3650 days is rejected');
});

test('leaving the time field pads a single-digit hour', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  panel.time.value = '6:05';
  panel.time.dispatchEvent(new win.Event('input'));
  panel.time.dispatchEvent(new win.Event('blur'));
  assert.equal(panel.time.value, '06:05');
  assert.equal(win.ISA_TEMPORARY_NOTES_UI.getDraft(`${WORKSPACE}:${CONTACT}`).time, '06:05');
});

test('an armed submission is impossible while the time is malformed', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  const pad = value => String(value).padStart(2, '0');
  const soon = new win.Date(Date.now() + 3 * 86400000);
  panel.date.value = `${pad(soon.getDate())}/${pad(soon.getMonth() + 1)}/${soon.getFullYear()}`;
  panel.date.dispatchEvent(new win.Event('input'));
  const posted = [];
  const nativePostMessage = win.postMessage.bind(win);
  win.postMessage = (message, targetOrigin) => {
    posted.push(message);
    nativePostMessage(message, targetOrigin);
  };
  panel.time.value = '18';
  panel.time.dispatchEvent(new win.Event('input'));
  const requests = posted.filter(message => message && message.__isaTempNote === true);
  assert.ok(requests.length > 0, 'the malformed time reaches the page hook');
  assert.equal(requests.some(message => message.kind === 'arm'), false,
    'nothing is armed without a resolvable deadline');
  assert.equal(requests.at(-1).kind, 'disarm');
  assert.match(panel.preview.textContent, /HH:MM on a 24-hour clock/);
});

test('a settled auto-delete control is kept, not rebuilt, by further passes', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  const observer = new win.MutationObserver(() => {});
  observer.observe(win.document.body, { childList: true, subtree: true });
  win.refreshTemporaryNoteControls();
  win.refreshTemporaryNoteControls();
  const records = observer.takeRecords();
  observer.disconnect();
  assert.deepEqual(records.map(record => `${record.type}:${record.target.className || record.target.nodeName}`), []);
  assert.equal(win.document.querySelector('.isa-temporary-note-controls'), panel.controls);
  assert.equal(panel.toggle.checked, true);
});

test('the custom delay box is a digit-only text box, so e, minus and a decimal point cannot be typed', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-delay');
  assert.equal(panel.amount.type, 'text');
  assert.equal(panel.amount.inputMode, 'numeric');
  const typeInto = value => { panel.amount.value = value; panel.amount.dispatchEvent(new win.Event('input')); };
  typeInto('1e2');
  assert.equal(panel.amount.value, '12');
  typeInto('-3.5');
  assert.equal(panel.amount.value, '35');
  typeInto('12345' + '67');
  assert.equal(panel.amount.value, '12345');
});

test('the date box refuses an impossible day or month while typing', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  const type = (value) => {
    panel.date.value = value;
    panel.date.dispatchEvent(new win.Event('input'));
    return panel.date.value;
  };
  assert.equal(type('1'), '1');
  assert.equal(type('15'), '15/');
  assert.equal(type('15/1'), '15/1');
  assert.equal(type('15/13'), '15/1', 'a month past 12 is refused');
  assert.equal(type('a'), '');
  assert.equal(type('5'), '05/', 'a first day digit above 3 is padded');
});

test('picking a day in the calendar fills the date box and arms the deadline without reaching Intercom', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  enable(win, panel);
  choose(win, panel, 'custom-date');
  panel.time.value = '18:45';
  panel.time.dispatchEvent(new win.Event('input'));
  const reachedHost = [];
  panel.controls.parentElement.addEventListener('click', () => reachedHost.push('click'));
  const trigger = panel.date.parentElement.querySelector('button[aria-label="Open calendar"]');
  trigger.click();
  const panelEl = win.ISA_TEMPORARY_NOTES_UI.getPanel().calendar.panel;
  assert.equal(panelEl.hidden, false, 'the calendar opens');
  const chosen = new win.Date(Date.now() + 3 * 86400000);
  const pad = value => String(value).padStart(2, '0');
  const iso = `${chosen.getFullYear()}-${pad(chosen.getMonth() + 1)}-${pad(chosen.getDate())}`;
  let day = panelEl.querySelector(`button[data-day="${iso}"]`);
  if (!day) {
    panelEl.querySelector('button[aria-label="Next month"]').click();
    day = panelEl.querySelector(`button[data-day="${iso}"]`);
  }
  day.click();
  assert.equal(panel.date.value, `${pad(chosen.getDate())}/${pad(chosen.getMonth() + 1)}/${chosen.getFullYear()}`);
  assert.equal(panelEl.hidden, true, 'the calendar closes after a pick');
  assert.match(panel.preview.textContent, /^Expires /);
  assert.deepEqual(reachedHost, [], 'no click inside the calendar reaches the Intercom page');
});

test('a refused or unknown save shows its message in the accent colour; progress and the paused notice do not', async () => {
  const { FORMS } = require('../support/lifetime-controls-forms');
  const shown = async (outcome, options) => {
    const form = FORMS['intercom-add'](options);
    form.setOn(true);
    if (outcome) await form.save(outcome);
    const status = form.root().querySelector('[role="status"]');
    return { text: status.textContent, color: status.style.color, hidden: status.hidden };
  };
  const refused = await shown('error');
  assert.equal(refused.text, 'Temporary note was not saved. Your draft and lifetime are preserved. Try again.');
  assert.equal(refused.color, 'var(--isa-block)');
  assert.equal((await shown('uncertain')).color, 'var(--isa-block)');
  const saving = await shown('pending');
  assert.equal(saving.text, 'Saving note with expiry…');
  assert.equal(saving.color, '');
  const paused = await shown(null, { paused: true });
  assert.equal(paused.text, 'Automatic cleanup is paused in this browser.');
  assert.equal(paused.color, '');
  assert.deepEqual(await shown(null), { text: '', color: '', hidden: true });
});

test('a field that is not shown is also switched off, and comes back on when its row shows', () => {
  const win = loadSidebar();
  const panel = controlsOf(win);
  const off = () => [panel.choice.getAttribute('aria-disabled') === 'true', panel.amount.disabled,
    panel.unit.getAttribute('aria-disabled') === 'true', panel.date.disabled, panel.time.disabled,
    panel.controls.querySelector('button[aria-label="Open calendar"]').disabled];
  assert.deepEqual(off(), [true, true, true, true, true, true]);
  enable(win, panel);
  assert.deepEqual(off(), [false, true, true, true, true, true]);
  choose(win, panel, 'custom-delay');
  assert.deepEqual(off(), [false, false, false, true, true, true]);
  choose(win, panel, 'custom-date');
  assert.deepEqual(off(), [false, true, true, false, false, false]);
});
