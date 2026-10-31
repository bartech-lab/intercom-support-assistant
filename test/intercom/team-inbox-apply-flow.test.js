'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';

const A = 'help@brightwell.example';
const B = 'help@kestrel-kids.example';
const TARGET = 'Support Brightwell';

function pillSpan(text) {
  return `<span class="truncate">${text}</span>`;
}

function draftPage(spans, teamInbox = 'General chats') {
  return `<div data-testid="new-conversation-view">
    <div data-testid="new-conversation-channel-picker">
      <button type="button" aria-label="Select channel" data-testid="dropdown-menu-trigger"><span><span>Email</span></span></button>
    </div>
    <div data-testid="composer-sender-area">
      <span><span>From</span></span>
      <button type="button" data-test-sender-pill="true" data-testid="popover-trigger">${spans.map(pillSpan).join('')}</button>
    </div>
    <div data-testid="draft-team-assignee">
      <span><span>Team Inbox</span></span>
      <button type="button" aria-label="Change team" data-testid="team-assignee-selector"><span><span>${teamInbox}</span></span></button>
    </div>
  </div>`;
}

function loadDraft(spans) {
  return loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(win) {
        win.document.getElementById('teammate-app-react')
          .attachShadow({ mode: 'open' }).innerHTML = draftPage(spans);
      }
    }
  );
}

function legacySender(content) {
  return `<div data-outbound-fields="">
    <div class="inbox2__new-conversation-input" data-sender-selector-field="">${content}</div>
  </div>`;
}

function legacyPill(email) {
  return `<p>From</p><div class="popover__opener"><div class="inbox2__name-and-email-pill">
    <div class="inbox2__name-and-email-pill-content">Support Sender (<span class="flex-1 truncate">${email}</span>)</div>
  </div></div>`;
}

function optionRow(inner) {
  return `<div class="rounded px-3 py-3 text-default">${inner}</div>`;
}

function namedRow(label) {
  return optionRow(`<div class="flex items-center gap-2">
    <span class="flex-shrink-0">Assign to</span>
    <div><span class="flex-grow truncate text-muted">${label}</span></div>
  </div>`);
}

function menuHtml(rows = '') {
  return `<div class="fixed inset-0 inbox2__command-k-modal js__command-k-modal">
    <div class="js-command-k-modal" data-intercom-target-action-menu="assign-to">
      <input data-command-k-input="" id="cmd-k-input" class="inbox2__command-k-modal-input"
             autocomplete="off" placeholder="Assign to" type="text">
      <div class="overflow-y-scroll" data-command-k-assignment-pane="">${rows}</div>
    </div>
  </div>`;
}

function page({ sender = '', sidebar = '', menu = '' } = {}) {
  return `<!doctype html><html><body>
    <div id="app">${sender}<aside>${sidebar}</aside></div>
    ${menu}
  </body></html>`;
}

function rig({ rows = '', teamInbox = 'General chats', withSidebar = true, sender = legacySender(legacyPill(A)) } = {}) {
  const win = loadExtension(page({
    sender,
    sidebar: withSidebar ? fx.sidebarSection({ teamInbox }) : '',
    menu: menuHtml(rows)
  }), { url: NEW_CONVERSATION_URL });

  const timers = [];
  win.setTimeout = (callback, delayMs = 0) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  win.clearTimeout = () => {};

  const log = [];

  const escapes = [];
  win.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') escapes.push(event);
  }, true);
  const enters = [];
  win.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') enters.push(event);
  }, true);

  const retryMs = win.eval('TEAM_INBOX_SELECT_RETRY_MS');
  const step = () => {
    const index = timers.findIndex(timer => timer.delayMs === retryMs);
    if (index < 0) return false;
    const [timer] = timers.splice(index, 1);
    timer.callback();
    return true;
  };
  const opener = withSidebar
    ? win.getTeamInboxValueOpener(win.findAttributeRowByLabel('Team Inbox'))
    : null;
  if (opener) opener.addEventListener('click', () => log.push('click:opener'));

  return { win, timers, log, escapes, enters, step, retryMs };
}

function setVisibleTeamInbox(win, label) {
  win.document.querySelector('[data-popover-opener="team-inbox-value"] span').textContent = label;
}

function appliedLabels(win) {
  const applied = [];
  const original = win.setTeamInboxAttribute;
  win.setTeamInboxAttribute = (label, ...rest) => {
    applied.push(label);
    return original(label, ...rest);
  };
  return applied;
}

function syncDraft(spans) {
  const win = loadDraft(spans);
  win.setTimeout = () => 0;
  win.ISA_INTERCOM_CONFIG.senderFromEmailToInbox['help@kestrel-kids.example'] = 'Support Kestrel Kids';
  const applied = appliedLabels(win);
  win.syncTeamInboxFromSender();
  return applied;
}

test('draft pill: the last span that is exactly an email wins', () => {
  assert.deepEqual(syncDraft(['Support Name', A, 'tail', B]), ['Support Kestrel Kids']);
});

test('draft pill: a "Name <email>" span is skipped for an earlier exact email', () => {
  assert.deepEqual(syncDraft([A, `Someone <${B}>`]), ['Support Brightwell']);
});

test('draft pill: an email only in the first span is found', () => {
  assert.deepEqual(syncDraft([B, 'Support Name', 'not an email']), ['Support Kestrel Kids']);
});

test('draft pill: the email is trimmed and lowercased before the mapping lookup', () => {
  assert.deepEqual(syncDraft(['Support Name', '  HELP@brightwell.example \n']), ['Support Brightwell']);
});

test('without a draft pill the sender field pill content supplies the email', () => {
  const win = loadExtension(page({
    sender: legacySender(legacyPill('HELP@brightwell.example')),
    sidebar: fx.sidebarSection({ teamInbox: 'General chats' })
  }), { url: NEW_CONVERSATION_URL });
  assert.equal(win.getSelectedSenderEmail(), A);
});

test('without a draft pill and without a pill the sender field text supplies the email', () => {
  const win = loadExtension(page({
    sender: legacySender('  HELP@kestrel-kids.example  '),
    sidebar: fx.sidebarSection({ teamInbox: 'General chats' })
  }), { url: NEW_CONVERSATION_URL });
  assert.equal(win.getSelectedSenderEmail(), B);
});

function clickTargets(win) {
  const pane = win.document.querySelector('[data-command-k-assignment-pane]');
  const targets = [];
  pane.addEventListener('click', event => targets.push(event.target), true);
  return { pane, targets };
}

test('with a named option nested deep, the click lands on the pane child row, not the inner name', () => {
  const { win } = rig({ rows: namedRow('Support Kestrel Kids') + namedRow(TARGET) });
  const { pane, targets } = clickTargets(win);
  const targetRow = [...pane.children].find(row => row.textContent.includes(TARGET));
  assert.equal(win.selectTeamInboxOption(TARGET), false);
  assert.equal(win.selectTeamInboxOption(TARGET), true);
  assert.equal(targets.length > 0, true);
  assert.equal(targets.every(target => target === targetRow), true);
  assert.equal(targets.some(target => target.parentNode !== pane), false);
});

test('without any option-name match, a leaf span with the exact text is used and its row is clicked', () => {
  const rows = optionRow('<div><div><span>Assign to</span><span>Support Kestrel Kids</span></div></div>')
    + optionRow(`<div><div><span>Assign to</span><span>${TARGET}</span></div></div>`);
  const { win } = rig({ rows });
  const { pane, targets } = clickTargets(win);
  const targetRow = [...pane.children].find(row => row.textContent.includes(TARGET));
  assert.equal(win.selectTeamInboxOption(TARGET), false);
  assert.equal(win.selectTeamInboxOption(TARGET), true);
  assert.equal(targets.length > 0, true);
  assert.equal(targets.every(target => target === targetRow), true);
});

function stepsUntilEnter(context, limit = 70) {
  let steps = 0;
  while (context.enters.length === 0 && steps < limit) {
    if (!context.step()) break;
    steps += 1;
  }
  return context.enters.length ? steps : null;
}

function startApply(context) {
  context.win.setTeamInboxAttribute(TARGET);
}

test('Enter goes to the search input as soon as an option row shows the target', () => {
  const context = rig({ rows: namedRow(TARGET) });
  const input = context.win.document.querySelector('#cmd-k-input');
  const enterTargets = [];
  input.addEventListener('keydown', event => { if (event.key === 'Enter') enterTargets.push(event.target); });
  startApply(context);
  const steps = stepsUntilEnter(context);
  assert.notEqual(steps, null);
  assert.ok(steps < context.win.eval('TEAM_INBOX_COMMIT_FALLBACK_ATTEMPTS'), `Enter after ${steps} steps`);
  assert.equal(enterTargets[0], input);
});

test('target text only inside the search input never counts, Enter waits for the fallback attempt', () => {
  const context = rig({ rows: '' });
  startApply(context);
  const steps = stepsUntilEnter(context);
  assert.equal(context.win.eval('TEAM_INBOX_COMMIT_FALLBACK_ATTEMPTS'), 8);
  assert.equal(context.win.document.querySelector('#cmd-k-input').value, TARGET);
  assert.equal(steps, 8);
});

test('target text only in a non-leaf element never counts, Enter waits for the fallback attempt', () => {
  const context = rig({ rows: optionRow(`<div class="x">${TARGET}<i></i></div>`) });
  startApply(context);
  const steps = stepsUntilEnter(context);
  assert.equal(steps, 8);
});

test('an option row naming a different inbox does not trigger an early Enter', () => {
  const context = rig({ rows: namedRow('Support Kestrel Kids') });
  startApply(context);
  assert.equal(stepsUntilEnter(context), 8);
});

function runToEnd(context, limit = 200) {
  let steps = 0;
  while (steps < limit && context.step()) steps += 1;
  return steps;
}

test('after 60 attempts with a different visible inbox, Escape closes the menu and the apply ends', () => {
  const context = rig({ rows: '' });
  startApply(context);
  const steps = runToEnd(context);
  assert.equal(steps, 60);
  assert.equal(context.escapes.length, 1);
  assert.equal(context.win.eval('applyingTeamInbox'), false);
  assert.equal(context.win.eval('inFlightTeamInboxTarget'), null);
});

test('an inbox that became correct by the last attempt is selected and no Escape is sent', () => {
  const context = rig({ rows: '' });
  startApply(context);
  for (let attempt = 1; attempt < 60; attempt += 1) assert.equal(context.step(), true);
  setVisibleTeamInbox(context.win, TARGET);
  assert.equal(context.step(), true);
  assert.equal(context.step(), false);
  assert.equal(context.escapes.length, 0);
  assert.equal(context.win.eval('applyingTeamInbox'), false);
});

test('a second apply while the first is in flight sends Escape and takes over the target', () => {
  const context = rig({ rows: '' });
  startApply(context);
  assert.equal(context.escapes.length, 0);
  const generation = context.win.eval('teamInboxApplyGeneration');
  context.win.setTeamInboxAttribute('Support Kestrel Kids');
  assert.equal(context.escapes.length, 1);
  assert.equal(context.win.eval('inFlightTeamInboxTarget'), 'Support Kestrel Kids');
  assert.equal(context.win.eval('teamInboxApplyGeneration'), generation + 1);
});

test('a missing team inbox row is skipped without an opener click and releases the apply', () => {
  const context = rig({ withSidebar: false });
  context.win.setTeamInboxAttribute(TARGET);
  assert.equal(context.log.includes('click:opener'), false);
  assert.equal(context.win.eval('applyingTeamInbox'), false);
  assert.equal(context.win.eval('inFlightTeamInboxTarget'), null);
});

test('resolveDraftSenderCompany drops only the excluded inbox, compared case-insensitively', () => {
  const context = rig();
  const { win } = context;
  const setSender = email => {
    win.document.querySelector('[data-sender-selector-field] .flex-1.truncate').textContent = email;
  };
  win.ISA_INTERCOM_CONFIG.senderFromEmailToInbox[A] = 'Support Brightwell';
  win.ISA_INTERCOM_CONFIG.senderFromEmailToInbox[B] = 'Support Kestrel Kids';
  assert.equal(win.resolveDraftSenderCompany(), 'Brightwell');
  setSender(B);
  assert.equal(win.resolveDraftSenderCompany(), 'Kestrel Kids');

  win.ISA_INTERCOM_CONFIG.excludedInboxes.push('Support BRIGHTWELL');
  setSender(A);
  assert.equal(win.resolveDraftSenderCompany(), null);
  setSender(B);
  assert.equal(win.resolveDraftSenderCompany(), 'Kestrel Kids');
});
