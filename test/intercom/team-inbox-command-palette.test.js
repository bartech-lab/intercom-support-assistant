'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

const NEW_CONVERSATION_URL =
  'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';

const SENDER = 'help@alderpoint.example';
const TARGET = 'Support Alderpoint';
const OPTION_PREFIX = 'cmdk-opt-new-conversation-assign-team-';

const TEAMS = [
  'Urgent Support Alderpoint',
  'Switch Status',
  'Support Alderpoint',
  'Сases Alderpoint',
  'Support Quayside Fashion'
];

function draftPage(teamInbox) {
  return `<div data-testid="new-conversation-view">
    <div data-testid="composer-sender-area">
      <span><span>From</span></span>
      <button type="button" data-test-sender-pill="true" data-testid="popover-trigger"><span class="truncate">${SENDER}</span></button>
    </div>
    <div data-testid="draft-team-assignee">
      <span><span>Team Inbox</span></span>
      <button type="button" aria-label="Change team" data-testid="team-assignee-selector"><span><span>${teamInbox}</span></span></button>
    </div>
  </div>`;
}

function optionHtml(name, index) {
  const active = index === 0;
  return `<div><div id="${OPTION_PREFIX}${1000 + index}" role="option" aria-selected="${active}"${active ? ' data-active="true"' : ''}><span><img alt="" src="x.svg"></span><span><span>${name}</span></span></div></div>`;
}

function paletteHtml(state, options) {
  return `<div role="dialog" id="radix-_r_1j_" data-state="${state}" data-testid="dialog-content" data-command-palette="" tabindex="-1">
    <h2 data-testid="dialog-title">Command palette</h2>
    <div><div><button type="button" aria-label="Back"></button><span>${options ? 'Assign to team' : 'Commands'}</span></div>
    <div><input role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="_r_1i_" placeholder="Search…" type="text" value=""></div>
    <div><div id="_r_1i_" role="listbox" aria-label="Search results">${options}</div></div></div>
  </div>`;
}

function rig({ mode = 'palette', clicksWork = true, teamInbox = 'Unassigned chats' } = {}) {
  const win = loadExtension(
    '<!doctype html><html><body><div id="teammate-app-react"></div></body></html>',
    {
      url: NEW_CONVERSATION_URL,
      beforeScripts(w) {
        w.document.getElementById('teammate-app-react')
          .attachShadow({ mode: 'open' }).innerHTML = draftPage(teamInbox);
      }
    }
  );
  const doc = win.document;
  const timers = [];
  win.setTimeout = (callback, delayMs = 0) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  win.clearTimeout = () => {};

  const selector = () => doc.getElementById('teammate-app-react')
    .shadowRoot.querySelector('[data-testid="team-assignee-selector"]');
  const visible = () => selector().textContent.trim();
  const events = { opens: 0, typed: [], clicks: [], enters: [], selected: [], assignAttributes: [] };

  const palette = () => doc.querySelector('[data-command-palette]');
  const input = () => palette() && palette().querySelector('input');
  const render = text => {
    const names = TEAMS.filter(name => name.toLowerCase().includes(text.toLowerCase()));
    palette().querySelector('[role="listbox"]').innerHTML = names.map(optionHtml).join('');
    const first = palette().querySelector('[role="option"]');
    if (first) input().setAttribute('aria-activedescendant', first.id);
  };
  const choose = option => {
    if (!option) return;
    const name = option.textContent.trim();
    events.selected.push(name);
    selector().firstElementChild.firstElementChild.textContent = name;
    palette().setAttribute('data-state', 'closed');
    palette().setAttribute('inert', '');
  };
  const openPalette = () => {
    events.opens += 1;
    const wrapper = doc.createElement('div');
    if (mode === 'user') {
      wrapper.innerHTML = paletteHtml('open', '');
    } else if (mode === 'closed') {
      wrapper.innerHTML = paletteHtml('closed', TEAMS.map(optionHtml).join(''));
    } else {
      wrapper.innerHTML = paletteHtml('open', TEAMS.map(optionHtml).join(''));
    }
    doc.body.appendChild(wrapper.firstElementChild);
  };

  selector().addEventListener('click', () => {
    if (mode === 'old') {
      const holder = doc.createElement('div');
      holder.innerHTML = `<div class="inbox2__command-k-modal js__command-k-modal"><div data-intercom-target-action-menu="assign-to">
        <input id="cmd-k-input" data-command-k-input="" type="text">
        <div data-command-k-assignment-pane=""></div></div></div>`;
      doc.body.appendChild(holder.firstElementChild);
      events.opens += 1;
      return;
    }
    openPalette();
  });

  doc.addEventListener('input', event => {
    const target = event.target;
    if (!target || target.tagName !== 'INPUT') return;
    events.typed.push({ value: target.value, closed: target.closest('[data-command-palette]')?.getAttribute('data-state') === 'closed', user: mode === 'user' });
    if (mode === 'old') {
      const pane = doc.querySelector('[data-command-k-assignment-pane]');
      pane.innerHTML = TEAMS.filter(name => name.toLowerCase().includes(target.value.toLowerCase()))
        .map(name => `<div class="rounded px-3 py-3"><div><span>Assign to</span><div><span class="truncate">${name}</span></div></div></div>`).join('');
      return;
    }
    if (target.closest('[data-command-palette]')) render(target.value);
  }, true);

  doc.addEventListener('click', event => {
    events.clicks.push(event.target);
    if (mode === 'old') {
      const pane = doc.querySelector('[data-command-k-assignment-pane]');
      const row = pane && [...pane.children].find(child => child.contains(event.target));
      if (row) {
        selector().firstElementChild.firstElementChild.textContent = row.querySelector('.truncate').textContent;
        events.selected.push(row.querySelector('.truncate').textContent);
        doc.querySelector('.js__command-k-modal').remove();
      }
      return;
    }
    if (!clicksWork) return;
    const option = event.target.closest && event.target.closest('[role="option"]');
    if (option && option === event.target.closest('[role="option"]') && palette() && palette().contains(option)) {
      choose(option);
    }
  });

  doc.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    events.enters.push({
      target: event.target,
      active: event.target.getAttribute && event.target.getAttribute('aria-activedescendant')
    });
    if (mode === 'old') return;
    if (event.target === input()) {
      const id = event.target.getAttribute('aria-activedescendant');
      choose(id && doc.getElementById(id));
    }
  }, true);

  const retryMs = win.eval('TEAM_INBOX_SELECT_RETRY_MS');
  const maxAttempts = win.eval('TEAM_INBOX_SELECT_MAX_ATTEMPTS');
  const step = () => {
    const index = timers.findIndex(timer => timer.delayMs === retryMs);
    if (index < 0) return false;
    const [timer] = timers.splice(index, 1);
    timer.callback();
    return true;
  };
  const runToEnd = (limit = 400) => {
    let steps = 0;
    while (steps < limit && step()) steps += 1;
    return steps;
  };
  return { win, doc, events, visible, runToEnd, step, maxAttempts, palette };
}

function start(context) {
  context.win.syncTeamInboxFromSender(true);
}

test('palette: the exact team is selected, never a label that merely contains it', () => {
  const context = rig();
  start(context);
  context.runToEnd();
  assert.equal(context.visible(), TARGET);
  assert.deepEqual(Array.from(context.events.selected), [TARGET]);
});

test('palette: the exact team label is typed into the search input', () => {
  const context = rig();
  start(context);
  context.runToEnd();
  assert.equal(context.events.typed.length > 0, true);
  assert.equal(context.events.typed[0].value, TARGET);
});

test('palette: the click lands on the role=option element of the exact match', () => {
  const context = rig();
  start(context);
  context.runToEnd();
  const optionClicks = context.events.clicks;
  const inPalette = optionClicks.filter(target => target.closest && target.closest('[data-command-palette]'));
  assert.equal(inPalette.length > 0, true);
  for (const target of inPalette) {
    assert.equal(target.getAttribute('role'), 'option');
    assert.equal(target.textContent.trim(), TARGET);
  }
});

test('palette: Enter never commits while aria-activedescendant points to another team', () => {
  const context = rig({ clicksWork: false });
  start(context);
  context.runToEnd();
  const wrong = context.events.enters.filter(enter => {
    const id = enter.active;
    const option = id && context.doc.getElementById(id);
    return !option || option.textContent.trim() !== TARGET;
  });
  assert.equal(wrong.length, 0);
  assert.deepEqual(Array.from(context.events.selected), []);
  assert.notEqual(context.visible(), 'Urgent Support Alderpoint');
  assert.notEqual(context.visible(), 'Switch Status');
});

test('palette: with clicks unavailable the apply gives up and leaves the inbox unchanged', () => {
  const context = rig({ clicksWork: false });
  start(context);
  const steps = context.runToEnd();
  assert.equal(steps >= context.maxAttempts, true);
  assert.notEqual(context.visible(), TARGET);
  assert.equal(context.visible(), 'Unassigned chats');
});

test('a palette with data-state closed is ignored', () => {
  const context = rig({ mode: 'closed' });
  start(context);
  context.runToEnd();
  assert.equal(context.events.typed.filter(entry => entry.closed).length, 0);
  assert.equal(context.events.typed.length, 0);
  assert.deepEqual(Array.from(context.events.selected), []);
});

test('a user-opened command palette without assign-team options is never typed into or clicked', () => {
  const context = rig({ mode: 'user' });
  start(context);
  context.runToEnd();
  assert.equal(context.events.typed.length, 0);
  const paletteClicks = context.events.clicks.filter(target =>
    target.closest && target.closest('[data-command-palette]'));
  assert.equal(paletteClicks.length, 0);
  assert.equal(context.events.enters.filter(enter => enter.target.closest && enter.target.closest('[data-command-palette]')).length, 0);
  assert.equal(context.palette().querySelector('input').value, '');
});

test('while applying, html carries isa-assigning and the injected stylesheet hides the palette', () => {
  const context = rig();
  start(context);
  assert.equal(context.doc.documentElement.classList.contains('isa-assigning'), true);
  const css = [...context.doc.querySelectorAll('style')].map(style => style.textContent).join('\n');
  const rule = /html\.isa-assigning \[data-command-palette\][^{]*\{([^}]*)\}/.exec(css);
  assert.ok(rule);
  assert.match(rule[1], /opacity:\s*0/);
  context.runToEnd();
  assert.equal(context.doc.documentElement.classList.contains('isa-assigning'), false);
});

test('the old assign-to picker still works', () => {
  const context = rig({ mode: 'old' });
  start(context);
  context.runToEnd();
  assert.equal(context.visible(), TARGET);
  assert.deepEqual(Array.from(context.events.selected), [TARGET]);
});
