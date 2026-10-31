'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  WORKSPACE,
  CONTACT,
  ORIGIN,
  loadSidebar,
  controlsOf,
  enable,
  choose,
} = require('../support/temporary-notes-harness');

const KEY = `${WORKSPACE}:${CONTACT}`;
const OTHER_CONTACT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOT_SUBMITTED = 'Temporary note was not submitted. Check the lifetime and wait for expiry protection, then try again.';
const BUSY = 'Wait until this submission is verified before saving again.';
const NOT_ACTIVE = 'Expiry protection is not active. Check the lifetime, then try again.';
const NOT_SAVED = 'Temporary note was not saved. Your draft and lifetime are preserved. Try again.';
const PAST = 'That date has already passed. Pick a new expiry, then save again.';

function setup({ text = 'hello', temporary = true, notes } = {}) {
  const win = loadSidebar(notes ? { notes } : {});
  const panel = controlsOf(win);
  const ui = win.ISA_TEMPORARY_NOTES_UI;
  const posted = [];
  const nativePostMessage = win.postMessage.bind(win);
  win.postMessage = (message, targetOrigin) => {
    posted.push(message);
    nativePostMessage(message, targetOrigin);
  };
  if (temporary) enable(win, panel);
  const textarea = win.document.querySelector('textarea[data-testid="note-input"]');
  const type = (value) => {
    textarea.value = value;
    textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  if (text) type(text);
  const draft = () => ui.getDraft(KEY);
  const reply = (kind, extra = {}, overrides = {}) => win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind, token: draft().token, revision: draft().revision, ...extra, ...overrides }
  });
  const arm = () => reply('temporary-note-armed', { status: 'armed' });
  const observe = (event, target) => {
    let stopped = 0;
    const native = event.stopImmediatePropagation.bind(event);
    event.stopImmediatePropagation = () => { stopped += 1; native(); };
    target.dispatchEvent(event);
    return { prevented: event.defaultPrevented, stopped };
  };
  const press = (init, target = textarea) => observe(
    new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', ...init }), target);
  const focus = (type, relatedTarget = null, target = textarea) => observe(
    new win.FocusEvent(type, { bubbles: true, cancelable: true, relatedTarget }), target);
  const switchTo = (contact) => {
    win.document.querySelector('a[data-test-user-profile-link]').href = `/a/apps/${WORKSPACE}/users/${contact}`;
  };
  const toggleOff = () => {
    panel.toggle.checked = false;
    panel.toggle.dispatchEvent(new win.Event('change'));
  };
  return { win, panel, ui, posted, textarea, type, draft, reply, arm, press, focus, switchTo, toggleOff };
}

function assertBlocked(result) {
  assert.equal(result.prevented, true, 'preventDefault is called');
  assert.ok(result.stopped >= 1, 'stopImmediatePropagation is called');
}

function assertPasses(result) {
  assert.equal(result.prevented, false, 'preventDefault is not called');
  assert.equal(result.stopped, 0, 'propagation is not stopped');
}

const armRequests = t => t.posted.filter(m => m && m.__isaTempNote === true && m.kind === 'arm');

test('control: an armed, matching, enabled draft lets Enter through without an error', () => {
  const t = setup();
  t.arm();
  assertPasses(t.press());
  assert.equal(t.draft().error, '');
  assert.equal(t.ui.getPanel().status.hidden, true);
});

test('Enter is blocked with the generic error until the page hook confirms the current revision', () => {
  const t = setup();
  assertBlocked(t.press());
  assert.equal(t.draft().error, NOT_SUBMITTED);
  assert.equal(t.ui.getPanel().status.textContent, NOT_SUBMITTED);
  assert.equal(t.ui.getPanel().status.hidden, false);
});

test('only Enter without Shift and outside composition counts, even in a blocked state', () => {
  const t = setup();
  [{ shiftKey: true }, { isComposing: true }, { key: 'a' }, { key: 'Tab' }, { key: 'Escape' }].forEach((init) => {
    assertPasses(t.press(init));
  });
  assert.equal(t.draft().error, '', 'ignored keys show no error');
  assertBlocked(t.press({ shiftKey: false }));
});

test('keydown on an element other than the panel textarea is ignored in a blocked state', () => {
  const t = setup();
  const other = t.win.document.createElement('textarea');
  t.win.document.body.appendChild(other);
  assertPasses(t.press({}, other));
  assertPasses(t.press({}, t.panel.toggle));
  const inert = t.win.document.querySelectorAll('textarea[data-testid="note-input"]')[1];
  assertPasses(t.press({}, inert));
  assert.equal(t.draft().error, '');
  assertBlocked(t.press());
});

test('with temporary mode off, Enter and blur pass untouched even though nothing is armed', () => {
  const t = setup({ temporary: false });
  assertPasses(t.press());
  assertPasses(t.focus('blur'));
  assert.equal(t.ui.getPanel().status.hidden, true);
});

test('turning temporary mode off after a blocked attempt makes Enter pass again', () => {
  const t = setup();
  assertBlocked(t.press());
  t.toggleOff();
  assertPasses(t.press());
});

test('a draft edited after armed is blocked until the new revision is confirmed', () => {
  const t = setup();
  t.arm();
  assertPasses(t.press());
  const armedAt = t.draft().revision;
  t.type('hello again');
  assert.ok(t.draft().revision > armedAt, 'the edit bumps the revision');
  assertBlocked(t.press());
  assert.equal(t.draft().error, NOT_SUBMITTED);
  const last = armRequests(t).at(-1);
  assert.equal(last.revision, t.draft().revision, 'the edit re-arms the new revision');
  assert.equal(last.draft, 'hello again');
  t.arm();
  assertPasses(t.press());
});

test('an armed reply for an older revision does not unlock the edited draft', () => {
  const t = setup();
  t.type('second');
  const current = t.draft().revision;
  t.reply('temporary-note-armed', { status: 'armed' }, { revision: current - 1 });
  assertBlocked(t.press());
  t.reply('temporary-note-armed', { status: 'armed' });
  assertPasses(t.press());
});

test('an armed reply with an unknown token changes nothing', () => {
  const t = setup();
  t.reply('temporary-note-armed', { status: 'armed' }, { token: 'not-this-panel' });
  assertBlocked(t.press());
});

test('a blocked reply shows the inactive-protection message and revokes a prior armed confirmation', () => {
  const t = setup();
  t.arm();
  assertPasses(t.press());
  t.reply('temporary-note-armed', { status: 'blocked' });
  assert.equal(t.ui.getPanel().status.textContent, NOT_ACTIVE);
  assertBlocked(t.press());
});

test('the textarea text must equal the draft the panel knows', () => {
  const t = setup();
  t.arm();
  t.textarea.value = 'hello, typed without an input event';
  assertBlocked(t.press());
  assert.equal(t.draft().error, NOT_SUBMITTED);
  t.textarea.value = 'hello';
  assertPasses(t.press());
});

test('an invalid lifetime blocks Enter even when the page hook confirmed this revision', () => {
  const t = setup();
  choose(t.win, t.panel, 'custom-delay');
  t.panel.amount.value = '0';
  t.panel.amount.dispatchEvent(new t.win.Event('input'));
  t.arm();
  assertBlocked(t.press());
  assert.equal(t.draft().error, NOT_SUBMITTED);
  t.panel.amount.value = '5';
  t.panel.amount.dispatchEvent(new t.win.Event('input'));
  t.arm();
  assertPasses(t.press());
});

test('a conversation switch since the panel was built blocks Enter even when armed', () => {
  const t = setup();
  t.arm();
  assertPasses(t.press());
  t.switchTo(OTHER_CONTACT);
  assertBlocked(t.press());
  assert.equal(t.draft().error, NOT_SUBMITTED);
  t.switchTo(CONTACT);
  assertPasses(t.press());
});

for (const status of ['pending', 'uncertain']) {
  test(`a ${status} save blocks Enter with the wait message even when armed`, () => {
    const t = setup();
    t.arm();
    t.reply('temporary-note-save', { status });
    assertBlocked(t.press());
    assert.equal(t.draft().error, BUSY);
  });
}

test('blur and focusout moving focus into the temporary-note controls stop propagation only', () => {
  const t = setup();
  ['blur', 'focusout'].forEach((type) => {
    const result = t.focus(type, t.panel.toggle);
    assert.equal(result.prevented, false, `${type} is not prevented`);
    assert.equal(result.stopped, 1, `${type} propagation is stopped`);
  });
  assert.equal(t.draft().error, '');
  assert.equal(t.ui.getPanel().status.hidden, true);
});

test('blur and focusout elsewhere follow the save guard', () => {
  const t = setup();
  const outside = t.win.document.querySelector('aside');
  ['blur', 'focusout'].forEach((type) => {
    assertBlocked(t.focus(type, null));
    assertBlocked(t.focus(type, outside));
  });
  t.arm();
  ['blur', 'focusout'].forEach(type => assertPasses(t.focus(type, null)));
});

test('blur on an element other than the panel textarea is ignored', () => {
  const t = setup();
  assertPasses(t.focus('blur', null, t.win.document.body));
  assert.equal(t.draft().error, '');
});

test('a save success resets the panel and orphans the old token', () => {
  const t = setup();
  const defaultChoice = setup().draft().choice;
  choose(t.win, t.panel, String(3 * 86400000));
  assert.notEqual(t.draft().choice, defaultChoice, 'the lifetime was changed away from the default');
  t.arm();
  const oldToken = t.draft().token;
  t.reply('temporary-note-save', { status: 'success' });
  const after = t.draft();
  assert.equal(after.enabled, false);
  assert.equal(t.panel.toggle.checked, false);
  assert.equal(after.choice, defaultChoice);
  assert.equal(after.draft, '');
  assert.equal(after.error, '');
  assert.notEqual(after.token, oldToken);
  t.reply('temporary-note-save', { status: 'failed' }, { token: oldToken });
  assert.equal(t.draft().error, '', 'a late reply with the old token is ignored');
  assert.equal(t.draft().enabled, false);
});

test('a failed save keeps the draft, shows the retry message, and re-arms with a new request', () => {
  const t = setup();
  t.arm();
  t.posted.length = 0;
  t.reply('temporary-note-save', { status: 'failed', reason: 'http-500' });
  assert.equal(t.draft().error, NOT_SAVED);
  assert.equal(t.ui.getPanel().status.textContent, NOT_SAVED);
  assert.equal(t.draft().draft, 'hello');
  assert.equal(t.draft().enabled, true);
  assert.equal(armRequests(t).length, 1);
});

test('a blocked save reply with expiry-in-past shows the date message and puts an emptied draft back', () => {
  const t = setup();
  t.arm();
  t.textarea.value = '';
  t.reply('temporary-note-save', { status: 'blocked', reason: 'expiry-in-past' });
  assert.equal(t.draft().error, PAST);
  assert.equal(t.textarea.value, 'hello');
});

test('a failed save does not overwrite a textarea that still has text', () => {
  const t = setup();
  t.arm();
  t.textarea.value = 'something newer';
  t.reply('temporary-note-save', { status: 'failed' });
  assert.equal(t.textarea.value, 'something newer');
});

for (const reason of ['save-pending', 'save-uncertain']) {
  test(`a blocked save reply with ${reason} shows the retry message but does not re-arm`, () => {
    const t = setup();
    t.arm();
    t.posted.length = 0;
    t.reply('temporary-note-save', { status: 'blocked', reason });
    assert.deepEqual(armRequests(t), []);
    assert.equal(t.draft().error, NOT_SAVED);
  });
}

test('a failed save with temporary mode off does not re-arm', () => {
  const t = setup();
  t.arm();
  t.toggleOff();
  t.posted.length = 0;
  t.reply('temporary-note-save', { status: 'failed' });
  assert.deepEqual(armRequests(t), []);
});

test('a save reply with an unknown status changes nothing', () => {
  const t = setup();
  t.arm();
  const before = JSON.stringify(t.draft());
  t.reply('temporary-note-save', { status: 'mystery' });
  assert.equal(JSON.stringify(t.draft()), before);
  assertPasses(t.press());
});

test('switching conversation posts a disarm one revision higher, keeps the draft, and restores it on return', () => {
  const t = setup();
  t.arm();
  const { token, revision } = t.draft();
  t.posted.length = 0;
  t.switchTo(OTHER_CONTACT);
  t.ui.refresh();
  const disarm = t.posted.find(m => m && m.kind === 'disarm');
  assert.ok(disarm, 'a disarm is posted');
  assert.equal(disarm.contact, CONTACT);
  assert.equal(disarm.token, token);
  assert.equal(disarm.revision, revision + 1);
  assert.equal(t.draft().draft, 'hello');
  assert.equal(t.draft().enabled, true);

  t.switchTo(CONTACT);
  t.ui.refresh();
  assert.equal(t.draft().draft, 'hello');
  assert.equal(t.ui.getPanel().contact, CONTACT);
  assert.equal(t.ui.getPanel().toggle.checked, true);
});

test('two visible note textareas build no panel, while one builds it', () => {
  const single = loadSidebar();
  single.refreshTemporaryNoteControls();
  assert.equal(single.document.querySelectorAll('.isa-temporary-note-controls').length, 1);
  const two = loadSidebar({ notes: '<textarea data-testid="note-input" aria-label="Add a note"></textarea>' });
  two.refreshTemporaryNoteControls();
  assert.equal(two.document.querySelectorAll('.isa-temporary-note-controls').length, 0);
  assert.equal(two.ISA_TEMPORARY_NOTES_UI.getPanel(), null);
});
