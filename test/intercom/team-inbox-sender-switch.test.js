'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

const NEW_CONVERSATION_URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/new-conversation?view=List';
const MAPPED = 'help@alderpoint.example';
const UNMAPPED = 'agent.one@example.com';
const TARGET = 'Support Alderpoint';
const TEAMS = ['Urgent Alderpoint', 'Support Alderpoint', 'General chats'];

function draftPage() {
  return `<div data-testid="new-conversation-view">
    <div data-testid="composer-sender-area">
      <span><span>From</span></span>
      <button type="button" data-test-sender-pill="true"><span class="truncate">Sender</span><span class="truncate">${UNMAPPED}</span></button>
    </div>
    <div data-testid="draft-team-assignee">
      <span><span>Team Inbox</span></span>
      <button type="button" aria-label="Change team" data-testid="team-assignee-selector"><span><span>General chats</span></span></button>
    </div>
  </div>`;
}

function rig({ clicksWork = true } = {}) {
  const win = loadExtension('<!doctype html><html><body><div id="teammate-app-react"></div></body></html>', {
    url: NEW_CONVERSATION_URL,
    beforeScripts(w) {
      w.document.getElementById('teammate-app-react').attachShadow({ mode: 'open' }).innerHTML = draftPage();
    }
  });
  const doc = win.document;
  const timers = [];
  win.setTimeout = (callback, delayMs = 0) => {
    timers.push({ callback, delayMs });
    return timers.length;
  };
  win.clearTimeout = () => {};
  let opens = 0;
  const root = doc.getElementById('teammate-app-react').shadowRoot;
  const team = () => root.querySelector('[data-testid="team-assignee-selector"] span span');
  const palette = () => doc.querySelector('[data-command-palette]:not([data-state="closed"])');
  root.querySelector('[data-testid="team-assignee-selector"]').addEventListener('click', () => {
    opens += 1;
    const holder = doc.createElement('div');
    holder.innerHTML = `<div role="dialog" data-state="open" data-command-palette=""><input role="combobox" type="text"><div role="listbox">${
      TEAMS.map((name, index) => `<div id="cmdk-opt-new-conversation-assign-team-${index}" role="option"><span>${name}</span></div>`).join('')}</div></div>`;
    doc.body.appendChild(holder.firstElementChild);
  });
  doc.addEventListener('click', event => {
    const option = event.target.closest && event.target.closest('[role="option"]');
    if (!option || !clicksWork) return;
    team().textContent = option.textContent.trim();
    palette()?.setAttribute('data-state', 'closed');
  }, true);
  const settle = () => {
    for (let guard = 0; timers.length && guard < 500; guard += 1) timers.shift().callback();
  };
  const pick = (email, intercomResetsTeam = false) => {
    root.querySelector('[data-test-sender-pill] span:last-child').textContent = email;
    if (intercomResetsTeam) team().textContent = 'General chats';
    win.syncTeamInboxFromSender();
    settle();
  };
  const attempts = () => opens;
  return { win, pick, team, attempts, settle };
}

test('picking the mapped sender again after an unmapped one applies the team every time', () => {
  const r = rig();
  for (let round = 0; round < 3; round += 1) {
    r.pick(UNMAPPED, true);
    assert.equal(r.team().textContent, 'General chats');
    r.pick(MAPPED);
    assert.equal(r.team().textContent, TARGET, `round ${round + 1}`);
  }
  assert.equal(r.attempts(), 3);
});

test('repeated observer passes on an unchanged sender still stop after two failed applies', () => {
  const r = rig({ clicksWork: false });
  r.pick(MAPPED);
  for (let pass = 0; pass < 10; pass += 1) {
    r.win.eval('lastAppliedSenderEmail = null');
    r.win.syncTeamInboxFromSender();
    r.settle();
  }
  assert.equal(r.attempts(), 2);
});
