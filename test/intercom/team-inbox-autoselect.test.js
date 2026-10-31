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

function subjectAttrInput() {
  return `<div class="subject-attr">
    <input class="ember-text-field inbox2__conversation-attribute-input"
           placeholder="+ Add" autocomplete="off" type="text">
  </div>`;
}

function assignMenu(labels) {
  const rows = labels.map(label => `
    <div class="rounded px-3 py-3 text-default">
      <div class="flex items-center gap-2">
        <span class="inbox2__icon-no-margin"><svg></svg></span>
        <span class="flex-shrink-0">Assign to</span>
        <span class="inbox2__icon-no-margin"><svg></svg></span>
        <span class="inbox2__icon-no-margin"><img class="w-4 h-4 mr-2" src="x"></span>
        <span class="flex-grow truncate text-muted">${label}</span>
      </div>
    </div>`).join('');
  return `<div class="fixed inset-0 inbox2__command-k-modal js__command-k-modal">
    <div class="js-command-k-modal" data-intercom-target-action-menu="assign-to">
      <input data-command-k-input="" id="cmd-k-input" class="inbox2__command-k-modal-input"
             autocomplete="off" placeholder="Assign to" type="text">
      <div class="overflow-y-scroll" data-command-k-assignment-pane="">
        <occluded-content class="occluded-content"></occluded-content>
        ${rows}
      </div>
    </div>
  </div>`;
}

function pageHtml({ sender = '', sidebar = '', menu = '', nav = '', extra = '' } = {}) {
  return `<!doctype html><html><body>
    <div id="app">
      ${nav}
      ${sender}
      <aside>${sidebar}${extra}</aside>
    </div>
    ${menu}
  </body></html>`;
}

function optionClickSpy(win) {
  const clicked = [];
  win.document.querySelectorAll('[data-command-k-assignment-pane] > div.rounded').forEach(row => {
    row.addEventListener('click', () => clicked.push(row.textContent.replace(/\s+/g, ' ').trim()));
  });
  return clicked;
}

test('getSelectedSenderEmail extracts and lowercases the chosen From email', () => {
  const win = loadExtension(pageHtml({ sender: senderField('HELP@kestrel-kids.example') }));
  assert.equal(win.getSelectedSenderEmail(), 'help@kestrel-kids.example');
});

test('getSelectedSenderEmail returns null when there is no sender field', () => {
  const win = loadExtension(pageHtml({ sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell' }) }));
  assert.equal(win.getSelectedSenderEmail(), null);
});

test('getSenderInboxMapping resolves help@ senders and ignores others', () => {
  const win = loadExtension(pageHtml());
  assert.equal(win.getSenderInboxMapping('help@kestrel-kids.example'), 'Support Kestrel Kids');
  assert.equal(win.getSenderInboxMapping('HELP@brightwell.example'), 'Support Brightwell');
  assert.equal(win.getSenderInboxMapping('help@orchard-kitchen.example'), 'Support Orchard Kitchen');
  assert.equal(win.getSenderInboxMapping('support@kestrel-kids.example'), null);
  assert.equal(win.getSenderInboxMapping('nobody@example.com'), null);
});

test('getAssignSearchInput returns the modal input only when the modal is open', () => {
  const open = loadExtension(pageHtml({ menu: assignMenu(['Support Brightwell']) }));
  assert.equal(open.getAssignSearchInput()?.id, 'cmd-k-input');

  const closed = loadExtension(pageHtml({ extra: subjectAttrInput() }));
  assert.equal(closed.getAssignSearchInput(), null);
});

test('the assign search falls back to a plain input when the menu input lacks the specific attributes', () => {
  const menu = assignMenu(['Support Brightwell', 'Support Kestrel Kids']).replace(
    /<input[^>]*>/,
    '<input id="plain-input" autocomplete="off" placeholder="Assign to" type="text">'
  );
  const win = loadExtension(pageHtml({ menu }));
  const clicked = optionClickSpy(win);

  assert.equal(win.getAssignSearchInput()?.id, 'plain-input');
  assert.equal(win.selectTeamInboxOption('Support Kestrel Kids'), false);
  assert.equal(win.document.querySelector('#plain-input').value, 'Support Kestrel Kids');
  assert.equal(win.selectTeamInboxOption('Support Kestrel Kids'), true);
  assert.deepEqual(clicked, ['Assign to Support Kestrel Kids']);
});

test('selectTeamInboxOption types the label first, then clicks the exact row', () => {
  const win = loadExtension(pageHtml({
    menu: assignMenu(['Support Brightwell', 'Urgent kestrel', 'Switch Status Kestrel Kids', 'Support Kestrel Kids'])
  }));
  const clicked = optionClickSpy(win);

  assert.equal(win.selectTeamInboxOption('Support Kestrel Kids'), false);
  assert.equal(win.document.querySelector('#cmd-k-input').value, 'Support Kestrel Kids');
  assert.deepEqual(clicked, []);

  assert.equal(win.selectTeamInboxOption('Support Kestrel Kids'), true);
  assert.deepEqual(clicked, ['Assign to Support Kestrel Kids']);
});

test('selectTeamInboxOption NEVER writes a field outside the modal (round-2 regression)', () => {
  const win = loadExtension(pageHtml({
    sender: senderField('help@brightwell.example', 'Support Brightwell'),
    extra: subjectAttrInput()
  }));
  const subject = win.document.querySelector('.subject-attr input');

  assert.equal(win.selectTeamInboxOption('Support Brightwell'), false);
  assert.equal(subject.value, '');
});

test('selectTeamInboxOption never clicks an identically-named left-nav link', () => {
  const win = loadExtension(pageHtml({
    nav: '<nav><a href="/a/inbox/x/inbox/team/1?view=List">Support Kestrel Kids</a></nav>',
    menu: assignMenu(['Support Kestrel Kids'])
  }));
  win.setNativeInputValue(win.document.querySelector('#cmd-k-input'), 'Support Kestrel Kids');
  let navClicked = false;
  win.document.querySelector('nav a').addEventListener('click', () => { navClicked = true; });
  const rowClicks = optionClickSpy(win);

  assert.equal(win.selectTeamInboxOption('Support Kestrel Kids'), true);
  assert.equal(navClicked, false);
  assert.deepEqual(rowClicks, ['Assign to Support Kestrel Kids']);
});

test('selectTeamInboxOption is case/whitespace-insensitive on the label', () => {
  const win = loadExtension(pageHtml({ menu: assignMenu(['Support Saltmarsh Crafts']) }));
  win.setNativeInputValue(win.document.querySelector('#cmd-k-input'), '  support   saltmarsh   crafts ');
  const clicked = optionClickSpy(win);
  assert.equal(win.selectTeamInboxOption('  SUPPORT   saltmarsh   CRAFTS '), true);
  assert.deepEqual(clicked, ['Assign to Support Saltmarsh Crafts']);
});

test('syncTeamInboxFromSender opens the Assign-to modal when Team Inbox differs', () => {
  const win = loadExtension(pageHtml({
    sender: senderField('help@brightwell.example', 'Support Brightwell'),
    sidebar: fx.sidebarSection({ teamInbox: 'Support Saltmarsh Crafts' })
  }), { url: NEW_CONVERSATION_URL });
  win.setTimeout = () => 0;

  const opener = win.getTeamInboxValueOpener(win.findAttributeRowByLabel('Team Inbox'));
  let opened = false;
  opener.addEventListener('click', () => { opened = true; });

  win.syncTeamInboxFromSender();
  assert.equal(opened, true);
});

test('syncTeamInboxFromSender is idempotent when Team Inbox already matches', () => {
  const win = loadExtension(pageHtml({
    sender: senderField('help@brightwell.example', 'Support Brightwell'),
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell' })
  }), { url: NEW_CONVERSATION_URL });
  win.setTimeout = () => 0;
  const opener = win.getTeamInboxValueOpener(win.findAttributeRowByLabel('Team Inbox'));
  let opened = false;
  opener.addEventListener('click', () => { opened = true; });

  win.syncTeamInboxFromSender();
  assert.equal(opened, false);
});

test('the injected style hides the Assign-to modal only under html.isa-assigning', () => {
  const win = loadExtension(pageHtml());
  const style = win.document.getElementById('isa-in-progress-highlight-style');
  assert.ok(style, 'highlight style is injected at init');
  assert.match(style.textContent, /html\.isa-assigning \[data-intercom-target-action-menu="assign-to"\]/);
  assert.match(style.textContent, /opacity:\s*0\s*!important/);
});

test('setTeamInboxAttribute hides the modal while driving, and a plain page is never hidden', () => {
  const win = loadExtension(pageHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Saltmarsh Crafts' })
  }), { url: NEW_CONVERSATION_URL });
  assert.equal(win.document.documentElement.classList.contains('isa-assigning'), false);

  win.setTimeout = () => 0;
  win.setTeamInboxAttribute('Support Brightwell');
  assert.equal(win.document.documentElement.classList.contains('isa-assigning'), true);
});

test('syncTeamInboxFromSender does nothing for an unmapped sender (support@)', () => {
  const win = loadExtension(pageHtml({
    sender: senderField('support@brightwell.example', 'Brightwell'),
    sidebar: fx.sidebarSection({ teamInbox: 'Support Saltmarsh Crafts' })
  }), { url: NEW_CONVERSATION_URL });
  win.setTimeout = () => 0;
  const opener = win.getTeamInboxValueOpener(win.findAttributeRowByLabel('Team Inbox'));
  let opened = false;
  opener.addEventListener('click', () => { opened = true; });

  win.syncTeamInboxFromSender();
  assert.equal(opened, false);
});

function fakeTimers(win) {
  const queue = [];
  win.setTimeout = (callback, delayMs = 0) => {
    queue.push({ callback, delayMs });
    return queue.length;
  };
  win.clearTimeout = () => {};
  return queue;
}

test('the keyboard commit fires as soon as the target is listed, before the fallback attempt', () => {
  const win = loadExtension(pageHtml({
    sender: senderField('help@brightwell.example', 'Support Brightwell'),
    sidebar: fx.sidebarSection({ teamInbox: 'General chats' }),
    menu: assignMenu(['Support Brightwell', 'Support Kestrel Kids'])
  }), { url: NEW_CONVERSATION_URL });
  const queue = fakeTimers(win);

  const input = win.document.querySelector('#cmd-k-input');
  let enterAtStep = null;
  let step = 0;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && enterAtStep === null) enterAtStep = step;
  });

  win.setTeamInboxAttribute('Support Brightwell');
  while (enterAtStep === null && step < 60) {
    const next = queue.findIndex(timer => timer.delayMs !== win.eval('TEAM_INBOX_SUPPRESS_MS'));
    if (next < 0) break;
    const [timer] = queue.splice(next, 1);
    step += 1;
    timer.callback();
  }

  assert.notEqual(enterAtStep, null, 'Enter must be dispatched');
  assert.ok(enterAtStep < win.eval('TEAM_INBOX_COMMIT_FALLBACK_ATTEMPTS'),
    `Enter must fire on the listing check, not the fallback (fired after ${enterAtStep} retries)`);
});

test('a superseded apply cannot unhide the menu the newer apply is still driving', () => {
  const win = loadExtension(pageHtml({
    sender: senderField('help@brightwell.example', 'Support Brightwell'),
    sidebar: fx.sidebarSection({ teamInbox: 'General chats' })
  }), { url: NEW_CONVERSATION_URL });
  const queue = fakeTimers(win);
  const suppressMs = win.eval('TEAM_INBOX_SUPPRESS_MS');

  win.setTeamInboxAttribute('Support Brightwell');
  const firstSuppress = queue.find(timer => timer.delayMs === suppressMs);
  win.setTeamInboxAttribute('Support Kestrel Kids');
  const secondSuppress = queue.filter(timer => timer.delayMs === suppressMs).pop();
  assert.notEqual(firstSuppress, secondSuppress);

  firstSuppress.callback();
  assert.equal(win.document.documentElement.classList.contains('isa-assigning'), true,
    'the first apply timer leaves the newer apply suppressed');
  secondSuppress.callback();
  assert.equal(win.document.documentElement.classList.contains('isa-assigning'), false);
});
