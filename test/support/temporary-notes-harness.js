'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const { loadExtension, loadIntercomPageHook, makeIntercomResponse, makeChromeStub } = require('./helpers');

const settled = () => new Promise(resolve => setTimeout(resolve, 0));

const ORIGIN = 'https://app.intercom.com';

const WORKSPACE = 'demo1234';

const CONTACT = '9007c24da170bbadc8e2598d';

const CONVERSATION_URL = `${ORIGIN}/a/inbox/${WORKSPACE}/inbox/team/1/conversation/900401386132981`;

const CREATE_URL = `${ORIGIN}/ember/inbox/notes?app_id=${WORKSPACE}`;

const SAVED_NOTE_ID = '900661995';

const SAVED_NOTE_MARKER = `[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT}`
  + ';expires=2026-09-09T07:55:12.120Z;token=aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa]';

function savedNote(id, bodyHtml) {
  return `<div class="flex w-full gap-1 items-start" data-testid="note-${id}">
    <div class="min-w-0 flex-1 break-words text-support" data-testid="note-body">${bodyHtml}</div>
  </div>`;
}

function temporaryNoteCard() {
  return savedNote(SAVED_NOTE_ID,
    `<p>próba</p>\n\n<p>Auto-delete after: 2026-09-09 07:55 UTC<br>\n${SAVED_NOTE_MARKER}</p>`);
}

function notesSection(extra = '') {
  return `<div data-test-sidebar-section-item="notes" data-sidebar-section-id="notes">
    <div data-testid="notes-section">
      <textarea data-testid="note-input" placeholder="Add a note" aria-label="Add a note"></textarea>
      ${extra}
    </div>
  </div>`;
}

function sidebarHtml(extra = '') {
  return `<!doctype html><html><body>
    <aside data-test-conversation-details-sidebar="true">
      <a data-test-user-profile-link="true" href="/a/apps/${WORKSPACE}/users/${CONTACT}">Customer</a>
      ${notesSection(extra)}
      <div class="absolute inset-0 bg-base-module overflow-y-auto z-30 translate-x-full pointer-events-none" role="region" inert="" style="transition: transform 200ms ease-out;">
        ${notesSection()}
      </div>
    </aside>
    <button data-test-conversation-details-sidebar-collapse-button="true" aria-label="Hide right menu"></button>
  </body></html>`;
}

function loadSidebar({ paused = false, notes = '' } = {}) {
  const chromeStub = makeChromeStub();
  if (paused) chromeStub.__store.isaPauseAutomaticNoteCleanup = true;
  const win = loadExtension(sidebarHtml(notes), { url: CONVERSATION_URL, chromeStub });
  win.__chrome = chromeStub;
  return win;
}

function controlsOf(win) {
  win.refreshTemporaryNoteControls();
  const controls = win.document.querySelector('.isa-temporary-note-controls');
  return {
    controls,
    toggle: controls.querySelector('input[aria-label="Auto-delete"]'),
    choice: controls.querySelector('[role="combobox"][aria-label="Auto-delete lifetime"]'),
    amount: controls.querySelector('input[aria-label="Auto-delete custom amount"]'),
    unit: controls.querySelector('[role="combobox"][aria-label="Auto-delete custom unit"]'),
    date: controls.querySelector('input[aria-label="Auto-delete date"]'),
    time: controls.querySelector('input[aria-label="Auto-delete time, 24-hour clock"]'),
    preview: controls.querySelector('div.isa-temporary-note-preview'),
    status: controls.querySelector('div[role="status"]')
  };
}

function enable(win, panel) {
  panel.toggle.checked = true;
  panel.toggle.dispatchEvent(new win.Event('change'));
}

function press(win, element, type, init = {}) {
  element.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

function openMenu(win, trigger) {
  press(win, trigger, 'click');
  return win.ISA_TEMPORARY_NOTES_UI.openMenuLayer();
}

function optionRows(layer) {
  return [...layer.querySelectorAll('[role="option"]')];
}

function choose(win, panel, value) {
  const layer = openMenu(win, panel.choice);
  const row = optionRows(layer).find(item => item.dataset.value === value);
  assert.ok(row, `no option carries ${value}`);
  press(win, row, 'click');
}

module.exports = {
  settled,
  ORIGIN,
  WORKSPACE,
  CONTACT,
  CONVERSATION_URL,
  CREATE_URL,
  SAVED_NOTE_ID,
  savedNote,
  temporaryNoteCard,
  loadSidebar,
  controlsOf,
  enable,
  press,
  openMenu,
  optionRows,
  choose,
};
