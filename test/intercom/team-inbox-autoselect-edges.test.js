'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';

function senderField(email, name = 'Support Sample') {
  return `<div data-outbound-fields="">
    <div class="inbox2__new-conversation-input" data-sender-selector-field="">
      <p class="min-w-15 text-muted">From</p>
      <div class="popover__opener">
        <div class="inbox2__name-and-email-pill">
          <div class="inbox2__name-and-email-pill-content">${name}
            (<span class="flex-1 truncate">${email}</span>)</div>
        </div>
      </div>
    </div>
  </div>`;
}

function pageHtml({ sender = '', sidebar = '', extra = '' } = {}) {
  return `<!doctype html><html><body>
    <div id="app">${sender}<aside>${sidebar}</aside>${extra}</div>
  </body></html>`;
}

function fakeTimers(win) {
  const queue = [];
  win.setTimeout = (callback, delayMs = 0) => {
    queue.push({ callback, delayMs });
    return queue.length;
  };
  win.clearTimeout = () => {};
  return queue;
}

function drain(queue, limit = 400) {
  let steps = 0;
  while (queue.length && steps < limit) {
    queue.shift().callback();
    steps += 1;
  }
}

function dropdown(optionText) {
  return `<div class="inbox2__outbound-sender-dropdown" id="dd"><div role="button" id="opt">${optionText}</div></div>`;
}

function loadSync({ email = 'help@brightwell.example', teamInbox = 'General chats', mapping, optionText = 'Support Other (help@kestrel-kids.example)', extra } = {}) {
  const win = loadExtension(pageHtml({
    sender: senderField(email, 'Support Sender'),
    sidebar: fx.sidebarSection({ teamInbox }),
    extra: extra === undefined ? dropdown(optionText) : extra
  }), { url: NEW_CONVERSATION_URL });
  if (mapping !== undefined) win.ISA_INTERCOM_CONFIG.senderFromEmailToInbox[email] = mapping;
  const queue = fakeTimers(win);
  const applied = [];
  const original = win.setTeamInboxAttribute;
  win.setTeamInboxAttribute = (label, ...rest) => {
    applied.push(label);
    return original(label, ...rest);
  };
  return { win, queue, applied };
}

test('a whitespace-only mapped label counts as no mapping and applies nothing', () => {
  const { win, queue, applied } = loadSync({ mapping: '   ' });
  win.syncTeamInboxFromSender();
  drain(queue);
  assert.deepEqual(applied, []);
});

test('an empty mapped label counts as no mapping and applies nothing', () => {
  const { win, queue, applied } = loadSync({ mapping: '' });
  win.syncTeamInboxFromSender();
  drain(queue);
  assert.deepEqual(applied, []);
});

test('a real mapped label applies, so the blank cases above are not vacuous', () => {
  const { win, queue, applied } = loadSync();
  win.syncTeamInboxFromSender();
  drain(queue);
  assert.deepEqual(applied, ['Support Brightwell']);
});

test('a different sender mapped to the same label as an in-flight apply starts no second apply', () => {
  const { win, applied } = loadSync();
  win.ISA_INTERCOM_CONFIG.senderFromEmailToInbox['help@kestrel-kids.example'] = 'Support Brightwell';
  win.syncTeamInboxFromSender();
  assert.deepEqual(applied, ['Support Brightwell']);

  win.document.querySelector('[data-sender-selector-field] .flex-1.truncate').textContent = 'help@kestrel-kids.example';
  win.syncTeamInboxFromSender();
  win.syncTeamInboxFromSender();
  assert.deepEqual(applied, ['Support Brightwell']);
});

test('a different sender mapped to a different label supersedes the in-flight apply', () => {
  const { win, applied } = loadSync();
  win.syncTeamInboxFromSender();
  assert.deepEqual(applied, ['Support Brightwell']);

  win.document.querySelector('[data-sender-selector-field] .flex-1.truncate').textContent = 'help@kestrel-kids.example';
  win.syncTeamInboxFromSender();
  assert.deepEqual(applied, ['Support Brightwell', 'Support Kestrel Kids']);
});

function setPillEmail(win, email) {
  win.document.querySelector('[data-sender-selector-field] .flex-1.truncate').textContent = email;
}

function resetTeamInbox(win) {
  win.document.querySelector('[data-popover-opener="team-inbox-value"] span').textContent = 'General chats';
}

function click(win, selector) {
  win.document.querySelector(selector).dispatchEvent(
    new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  );
}

const A = 'help@brightwell.example';
const B = 'help@kestrel-kids.example';
const F = 'help@orchard-kitchen.example';

test('automatic syncs for one sender apply exactly twice across absent-field cycles, never a third time', () => {
  const { win, queue, applied } = loadSync({ email: A });
  assert.equal(win.eval('TEAM_INBOX_MAX_APPLIES_PER_SENDER'), 2);
  const field = win.document.querySelector('[data-outbound-fields]');
  const parent = field.parentNode;
  const next = field.nextSibling;
  const counts = [];

  const syncOnce = () => {
    win.syncTeamInboxFromSender();
    drain(queue);
    counts.push(applied.length);
  };
  const absentThenBack = () => {
    field.remove();
    win.syncTeamInboxFromSender();
    drain(queue);
    parent.insertBefore(field, next);
    resetTeamInbox(win);
  };

  syncOnce();
  absentThenBack();
  syncOnce();
  absentThenBack();
  syncOnce();
  absentThenBack();
  syncOnce();

  assert.deepEqual(counts, [1, 2, 2, 2]);
  assert.deepEqual(applied, ['Support Brightwell', 'Support Brightwell']);
});

test('a user pick after the cap was hit applies again', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Support brightwell (help@brightwell.example)' });
  const field = win.document.querySelector('[data-outbound-fields]');
  const parent = field.parentNode;
  const next = field.nextSibling;
  win.syncTeamInboxFromSender();
  drain(queue);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    field.remove();
    win.syncTeamInboxFromSender();
    drain(queue);
    parent.insertBefore(field, next);
    resetTeamInbox(win);
    win.syncTeamInboxFromSender();
    drain(queue);
  }
  assert.equal(applied.length, 2);

  setPillEmail(win, B);
  click(win, '#opt');
  setPillEmail(win, A);
  resetTeamInbox(win);
  drain(queue);
  assert.deepEqual(applied, ['Support Brightwell', 'Support Brightwell', 'Support Brightwell']);
});

test('a committed user pick of sender A re-applies after a hand change, where an automatic sync would not', () => {
  const { win, queue, applied } = loadSync({ email: B, optionText: 'Support brightwell (help@brightwell.example)' });
  click(win, '#opt');
  setPillEmail(win, A);
  drain(queue);
  assert.deepEqual(applied, ['Support Brightwell']);

  resetTeamInbox(win);
  win.syncTeamInboxFromSender();
  drain(queue);
  assert.deepEqual(applied, ['Support Brightwell']);

  click(win, '#opt');
  drain(queue);
  assert.deepEqual(applied, ['Support Brightwell', 'Support Brightwell']);
});

test('a click on the sender dropdown container itself does nothing, an option row inside it does', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Support Other (help@kestrel-kids.example)' });
  click(win, '#dd');
  assert.equal(queue.length, 0);
  setPillEmail(win, B);
  drain(queue);
  assert.deepEqual(applied, []);

  setPillEmail(win, A);
  click(win, '#opt');
  assert.ok(queue.length > 0);
  setPillEmail(win, B);
  drain(queue);
  assert.deepEqual(applied, ['Support Kestrel Kids']);
});

test('a click on a dropdown that is itself the role=button element does nothing', () => {
  const { win, queue, applied } = loadSync({
    email: A,
    extra: '<div class="inbox2__outbound-sender-dropdown" role="button" id="dd">Support Other (help@kestrel-kids.example)</div>'
  });
  click(win, '#dd');
  assert.equal(queue.length, 0);
  setPillEmail(win, B);
  drain(queue);
  assert.deepEqual(applied, []);
});

test('an option click while a team-inbox apply is in progress does nothing', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Support Other (help@kestrel-kids.example)' });
  win.syncTeamInboxFromSender();
  assert.deepEqual(applied, ['Support Brightwell']);
  const before = queue.length;

  click(win, '#opt');
  assert.equal(queue.length, before);
  assert.deepEqual(applied, ['Support Brightwell']);
});

test('a pill that shows a different new email than the clicked option is not a commit', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Support Other (help@kestrel-kids.example)' });
  click(win, '#opt');
  setPillEmail(win, F);
  drain(queue);
  assert.deepEqual(applied, []);

  const second = loadSync({ email: A, optionText: 'Support Other (help@kestrel-kids.example)' });
  click(second.win, '#opt');
  setPillEmail(second.win, B);
  drain(second.queue);
  assert.deepEqual(second.applied, ['Support Kestrel Kids']);
});

test('an option without an email is not a commit while the pill keeps the previous email', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Other sender' });
  click(win, '#opt');
  drain(queue);
  assert.deepEqual(applied, []);
});

test('an option without an email commits when the pill shows a different email', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Other sender' });
  click(win, '#opt');
  setPillEmail(win, B);
  drain(queue);
  assert.deepEqual(applied, ['Support Kestrel Kids']);
});

function runStep(queue) {
  const timer = queue.shift();
  timer.callback();
  return timer.delayMs;
}

test('the sender wait polls every 60 ms and a pill committing on the 12th retry still applies', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Support Other (help@kestrel-kids.example)' });
  assert.equal(win.eval('SENDER_SELECTION_RETRY_MS'), 60);
  assert.equal(win.eval('SENDER_SELECTION_MAX_ATTEMPTS'), 12);
  click(win, '#opt');
  assert.equal(queue.length, 1);
  assert.equal(runStep(queue), 0);
  for (let retry = 1; retry <= 11; retry += 1) {
    assert.equal(queue.length, 1);
    assert.equal(runStep(queue), 60);
  }
  assert.equal(queue.length, 1);
  assert.deepEqual(applied, []);
  setPillEmail(win, B);
  assert.equal(runStep(queue), 60);
  drain(queue);
  assert.deepEqual(applied, ['Support Kestrel Kids']);
});

test('a pill that commits only after the 12th retry is ignored', () => {
  const { win, queue, applied } = loadSync({ email: A, optionText: 'Support Other (help@kestrel-kids.example)' });
  click(win, '#opt');
  runStep(queue);
  for (let retry = 1; retry <= 12; retry += 1) runStep(queue);
  assert.equal(queue.length, 0);
  setPillEmail(win, B);
  drain(queue);
  assert.deepEqual(applied, []);
});

test('resolveDraftSenderCompany returns null when the mapped label is a Urgent inbox', () => {
  const { win } = loadSync({ mapping: 'Urgent Brightwell' });
  assert.equal(win.resolveDraftSenderCompany(), null);
});

test('resolveDraftSenderCompany returns null for an excluded inbox name regardless of case', () => {
  const { win } = loadSync({ mapping: 'Support Brightwell' });
  assert.equal(win.resolveDraftSenderCompany(), 'Brightwell');
  win.ISA_INTERCOM_CONFIG.excludedInboxes.push('support brightwell');
  assert.equal(win.resolveDraftSenderCompany(), null);
});

test('resolveDraftSenderCompany returns null when the label names no known company', () => {
  const { win } = loadSync({ mapping: 'Support Nowhere Brand' });
  assert.equal(win.resolveDraftSenderCompany(), null);
});

test('resolveDraftSenderCompany returns null for an unmapped sender', () => {
  const { win } = loadSync({ email: 'support@brightwell.example' });
  assert.equal(win.resolveDraftSenderCompany(), null);
});
