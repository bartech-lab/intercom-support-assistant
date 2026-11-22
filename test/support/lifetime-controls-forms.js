'use strict';

const { loadSidebar, savedNote, temporaryNoteCard, press, settled,
  ORIGIN, WORKSPACE, CONTACT, SAVED_NOTE_ID } = require('./temporary-notes-harness');

const NOW = Date.UTC(2026, 8, 1, 10, 0, 0, 0);
const LATER = Date.UTC(2026, 9, 1, 10, 0, 0, 0);
const NOTE_EXPIRY = '2026-09-09T07:55:12.120Z';
const NOTE_UUID = 'aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa';
const KEY = `${WORKSPACE}:${CONTACT}`;
const PLAIN_ID = '9';
const FOOTER = `Auto-delete after: 2026-09-09 07:55 UTC\n[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT}`
  + `;expires=${NOTE_EXPIRY};token=${NOTE_UUID}]`;

async function flush() {
  for (let index = 0; index < 8; index += 1) await settled();
}

function styleOf(element) {
  const style = element.style;
  if (!style || !style.length) return '';
  const pairs = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    pairs.push(`${name}:${style.getPropertyValue(name)}`);
  }
  return pairs.sort().join(';');
}

function steady(name, value) {
  if (name === 'id' || name === 'aria-controls' || name === 'aria-activedescendant' || name === 'for') {
    return value.replace(/\d+/g, 'N');
  }
  return value;
}

function describeNode(node, depth, lines) {
  const pad = '  '.repeat(depth);
  if (node.nodeType === 3) {
    if (node.textContent) lines.push(`${pad}"${node.textContent}"`);
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.localName;
  const parts = [tag];
  [...node.attributes].map(item => item.name).filter(name => name !== 'style').sort().forEach((name) => {
    parts.push(`${name}=${JSON.stringify(steady(name, node.getAttribute(name)))}`);
  });
  if (tag === 'input' || tag === 'textarea') parts.push(`value:${JSON.stringify(node.value)}`);
  if (tag === 'input' && node.type === 'checkbox') parts.push(`checked:${node.checked}`);
  if (tag === 'input' || tag === 'textarea' || tag === 'button') parts.push(`disabled:${node.disabled}`);
  if (node.tabIndex !== undefined && node.hasAttribute('role')) parts.push(`tab:${node.tabIndex}`);
  const style = styleOf(node);
  if (style) parts.push(`{${style}}`);
  lines.push(pad + parts.join(' '));
  if (tag === 'svg') return;
  node.childNodes.forEach(child => describeNode(child, depth + 1, lines));
}

function describe(form) {
  const lines = [];
  describeNode(form.root(), 0, lines);
  const doc = form.win.document;
  [...doc.body.children].filter(node => node.getAttribute('role') === 'listbox'
    || (node.getAttribute('role') === 'dialog' && node.getAttribute('aria-label') === 'Pick a date')).forEach((layer) => {
    lines.push('LAYER');
    describeNode(layer, 1, lines);
  });
  return lines;
}

function fieldsIn(root) {
  return {
    toggle: root.querySelector('input[aria-label="Auto-delete"]'),
    choice: root.querySelector('[role="combobox"][aria-label="Auto-delete lifetime"]'),
    amount: root.querySelector('input[aria-label="Auto-delete custom amount"]'),
    unit: root.querySelector('[role="combobox"][aria-label="Auto-delete custom unit"]'),
    date: root.querySelector('input[aria-label="Auto-delete date as DD/MM/YYYY"]'),
    time: root.querySelector('input[aria-label="Auto-delete time, 24-hour clock"]'),
    calendar: root.querySelector('button[aria-label="Open calendar"]')
  };
}

function actions(form) {
  const { win } = form;
  const fields = () => fieldsIn(form.root());
  form.fields = fields;
  form.setOn = (on) => {
    const { toggle } = fields();
    if (toggle.checked === on) return;
    toggle.checked = on;
    toggle.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  form.pick = (name, value) => {
    press(win, fields()[name], 'click');
    const layer = win.document.querySelector('[role="listbox"]');
    const row = layer && [...layer.querySelectorAll('[role="option"]')].find(item => item.dataset.value === value);
    if (!row) throw new Error(`no option ${value} for ${name}`);
    press(win, row, 'click');
  };
  form.type = (name, value) => {
    const input = fields()[name];
    input.value = value;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  form.leave = (name) => {
    fields()[name].dispatchEvent(new win.Event('blur'));
  };
  form.click = (name) => {
    press(win, fields()[name], 'click');
  };
  return form;
}

function intercomReply(win, kind, extra) {
  const draft = win.ISA_TEMPORARY_NOTES_UI.getDraft(KEY);
  win.handleIntercomBridgeMessage({
    source: win,
    origin: ORIGIN,
    data: { __isaic: true, version: 1, kind, token: draft.token, revision: draft.revision, ...extra }
  });
}

function intercomAdd({ paused = false } = {}) {
  const win = loadSidebar({ paused });
  win.Date.now = () => NOW;
  win.refreshTemporaryNoteControls();
  const textarea = win.document.querySelector('textarea[data-testid="note-input"]');
  const form = actions({ win, root: () => win.document.querySelector('.isa-temporary-note-controls') });
  form.write = () => {
    textarea.value = 'hello';
    textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  form.save = async (outcome) => {
    form.write();
    const status = { pending: 'pending', uncertain: 'uncertain', error: 'failed' }[outcome];
    intercomReply(win, 'temporary-note-save', { status });
  };
  return form;
}

function reply(payload, ok = true) {
  return { ok, status: ok ? 200 : 500, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
}

function intercomPanel({ adding, now = NOW }) {
  const noteId = adding ? PLAIN_ID : SAVED_NOTE_ID;
  const win = loadSidebar({ notes: adding ? savedNote(PLAIN_ID, '<p>plain note</p>') : temporaryNoteCard() });
  win.Date.now = () => now;
  let outcome = 'ok';
  win.fetch = (url, init = {}) => {
    if (!String(url).includes('/ember/inbox/notes')) return Promise.resolve(reply({}, false));
    const note = { id: Number(noteId), body: adding ? 'server text' : `server text\n\n${FOOTER}`,
      created_at: '2026-09-01T08:00:00.000Z', updated_at: '2026-09-01T08:00:00.000Z' };
    if ((init.method || 'GET') === 'GET') return Promise.resolve(reply([note]));
    if (outcome === 'pending') return new Promise(() => {});
    if (outcome === 'error') return Promise.resolve(reply({}, false));
    if (outcome === 'uncertain') return Promise.resolve(reply({ ...note, body: 'something else' }));
    return Promise.resolve(reply({ ...note, body: JSON.parse(init.body).body }));
  };
  win.refreshTemporaryNoteFooters();
  win.document.querySelector(adding ? '.isa-temporary-note-add' : '.isa-temporary-note-chip').click();
  const layer = () => win.document.querySelector('.isa-temporary-note-expiry-editor');
  const form = actions({ win, root: layer });
  form.write = () => {};
  form.save = async (kind) => {
    outcome = kind;
    [...layer().querySelectorAll('button')].find(button => button.textContent === 'Save').click();
    await flush();
  };
  return form;
}

const FORMS = {
  'intercom-add': options => intercomAdd(options),
  'intercom-change': options => intercomPanel({ adding: false, ...options }),
  'intercom-plus': options => intercomPanel({ adding: true, ...options })
};

module.exports = { FORMS, NOW, LATER, describe, flush };
