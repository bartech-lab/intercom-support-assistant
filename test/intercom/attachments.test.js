'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'intercom-attachments.js'), 'utf8');

function loadAttachments(html = '<!doctype html><html><head></head><body></body></html>') {
  const dom = new JSDOM(html, {
    url: 'https://app.intercom.com/a/inbox/team/123/conversation/456',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  unrefWindowTimers(dom.window);
  vm.runInContext(SOURCE, dom.getInternalVMContext(), { filename: 'intercom-attachments.js' });
  return dom.window;
}

function makeRecord(win, {
  filename,
  role = 'customer',
  date = '3d',
  size = '10 KB',
  message = true
} = {}) {
  const messageElement = message ? win.document.createElement('div') : null;
  if (messageElement) win.document.body.appendChild(messageElement);
  return { messageElement, filename, senderRole: role, date, size };
}

function makePanel(win, records, options = {}) {
  const header = win.document.createElement('header');
  win.document.body.appendChild(header);
  return win.ISA_ATTACHMENTS.createAttachmentPanel({
    headerHost: header,
    conversationId: 'one',
    records,
    ...options
  });
}

function rowNames(controller) {
  return [...controller.list.querySelectorAll('.isa-attachment-name')].map(node => node.textContent);
}

function rowMeta(controller) {
  return [...controller.list.querySelectorAll('.isa-attachment-row')]
    .map(row => (row.querySelector('.isa-attachment-meta') || {}).textContent || '');
}

test('the panel lists one row per file in stream order', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [
    makeRecord(win, { filename: 'first.pdf' }),
    makeRecord(win, { filename: 'second.png' }),
    makeRecord(win, { filename: 'third.txt' })
  ]);

  controller.open();

  assert.deepEqual(rowNames(controller), ['first.pdf', 'second.png', 'third.txt']);
  assert.equal(controller.panel.querySelector('.isa-attachment-panel-title').textContent, 'Attachments · 3');
});

test('a row shows sender, size, and age on one meta line', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [
    makeRecord(win, { filename: 'customer.pdf', role: 'customer', size: '1.25 MB', date: '3d' }),
    makeRecord(win, { filename: 'team.pdf', role: 'teammate', size: '20 KB', date: '22d' })
  ]);

  controller.open();

  assert.deepEqual(rowMeta(controller), ['Customer · 1.25 MB · 3d', 'Team · 20 KB · 22d']);
});

test('missing metadata shortens the meta line instead of printing placeholders', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [
    { filename: 'bare.bin' },
    { filename: 'sized.bin', size: '4 KB' }
  ]);

  controller.open();

  const rows = [...controller.list.querySelectorAll('.isa-attachment-row')];
  assert.equal(rows[0].querySelector('.isa-attachment-meta'), null);
  assert.equal(rows[1].querySelector('.isa-attachment-meta').textContent, '4 KB');
  assert.equal(rows[0].textContent, 'bare.bin');
});

test('a row carries the full filename in its tooltip', () => {
  const win = loadAttachments();
  const name = 'Invoice 01-JAN-26 REF 00000000 000000000000000000000.pdf';
  const controller = makePanel(win, [makeRecord(win, { filename: name })]);

  controller.open();

  assert.equal(controller.list.querySelector('.isa-attachment-row').title, name);
});

test('the panel carries no search box, sort control, or sender filters', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  controller.open();

  assert.equal(controller.panel.querySelector('input'), null);
  assert.equal(controller.panel.querySelector('select'), null);
  assert.equal(controller.panel.querySelector('[data-filter]'), null);
  assert.equal(controller.panel.querySelector('.isa-attachment-action'), null);
});

test('the button carries the paperclip, the count, and an accessible label', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [
    makeRecord(win, { filename: 'one.pdf' }),
    makeRecord(win, { filename: 'two.pdf' })
  ]);

  assert.equal(controller.button.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(controller.button.querySelector('svg').getAttribute('stroke'), 'currentColor');
  assert.equal(controller.button.querySelector('.isa-attachments-count').textContent, '2');
  assert.equal(controller.button.getAttribute('aria-label'), 'Attachments, 2 files');
  assert.equal(controller.button.textContent.includes('Attachments'), false);
});

test('a single file uses the singular accessible label', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  assert.equal(controller.button.getAttribute('aria-label'), 'Attachments, 1 file');
});

test('the button mounts before every existing header icon', () => {
  const win = loadAttachments();
  const header = win.document.createElement('header');
  const existing = win.document.createElement('button');
  header.appendChild(existing);
  win.document.body.appendChild(header);

  const controller = win.ISA_ATTACHMENTS.createAttachmentPanel({
    headerHost: header,
    conversationId: 'one',
    records: [makeRecord(win, { filename: 'one.pdf' })]
  });

  assert.equal(header.firstElementChild, controller.button);
  assert.equal(header.children.length, 2);
});

test('the button hides without files and the panel refuses to open', () => {
  const win = loadAttachments();
  const controller = makePanel(win, []);

  assert.equal(controller.button.hidden, true);
  controller.open();
  assert.equal(controller.panel.hidden, true);

  controller.setRecords([makeRecord(win, { filename: 'one.pdf' })], 'one');
  assert.equal(controller.button.hidden, false);
});

test('the panel opens under the button and stays clear of the composer', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })], {
    composerBoundary: { top: 500 }
  });
  controller.button.getBoundingClientRect = () => ({ top: 20, bottom: 44, left: 900, right: 940 });

  controller.open();

  assert.equal(controller.panel.style.width, '320px');
  assert.equal(controller.panel.style.top, '50px');
  assert.equal(controller.panel.style.left, '620px');
  assert.equal(controller.panel.style.maxHeight, '442px');
});

test('a narrow window keeps the panel on screen', () => {
  const win = loadAttachments();
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: 300 });
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);
  controller.button.getBoundingClientRect = () => ({ top: 20, bottom: 44, left: 240, right: 260 });

  controller.open();

  assert.equal(controller.panel.style.width, '284px', 'the panel shrinks to the window less an 8px margin each side');
  assert.equal(controller.panel.style.left, '8px');
});

test('a button near the left edge clamps the panel to the margin', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);
  controller.button.getBoundingClientRect = () => ({ top: 20, bottom: 44, left: 40, right: 60 });

  controller.open();

  assert.equal(controller.panel.style.width, '320px');
  assert.equal(controller.panel.style.left, '8px');
});

test('clicking a row closes the panel, scrolls to the message, and highlights it', () => {
  const win = loadAttachments();
  const record = makeRecord(win, { filename: 'report.pdf' });
  let scrollArguments = null;
  record.messageElement.scrollIntoView = options => { scrollArguments = options; };
  const controller = makePanel(win, [record]);

  controller.open();
  controller.list.querySelector('.isa-attachment-row').click();

  assert.equal(controller.panel.hidden, true);
  assert.equal(scrollArguments.block, 'center');
  assert.equal(scrollArguments.behavior, 'smooth');
  assert.equal(record.messageElement.classList.contains('isa-attachment-message-highlight'), true);
});

test('a row never opens a tab', () => {
  const win = loadAttachments();
  const opened = [];
  win.open = (...args) => opened.push(args);
  const controller = makePanel(win, [makeRecord(win, { filename: 'report.pdf' })]);

  controller.open();
  controller.list.querySelector('.isa-attachment-row').click();

  assert.deepEqual(Array.from(opened), []);
});

test('a click outside the panel dismisses it without stealing focus', () => {
  const win = loadAttachments();
  const outside = win.document.createElement('input');
  const before = win.document.createElement('input');
  win.document.body.append(before, outside);
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  before.focus();
  controller.open();
  assert.equal(controller.panel.hidden, false);
  outside.focus();
  outside.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));

  assert.equal(controller.panel.hidden, true);
  assert.equal(controller.button.getAttribute('aria-expanded'), 'false');
  assert.equal(win.document.activeElement, outside, 'focus stays where the teammate clicked');
});

test('a click inside the panel leaves it open', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  controller.open();
  controller.panel.querySelector('.isa-attachment-panel-title')
    .dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));

  assert.equal(controller.panel.hidden, false);
});

test('the button toggles the panel rather than reopening it', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  controller.button.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));
  controller.button.click();
  assert.equal(controller.panel.hidden, false);

  controller.button.dispatchEvent(new win.Event('pointerdown', { bubbles: true, composed: true }));
  controller.button.click();
  assert.equal(controller.panel.hidden, true);
});

test('scrolling the conversation dismisses the panel', () => {
  const win = loadAttachments();
  const stream = win.document.createElement('div');
  win.document.body.appendChild(stream);
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  controller.open();
  stream.dispatchEvent(new win.Event('scroll', { bubbles: false, composed: true }));

  assert.equal(controller.panel.hidden, true);
});

test('scrolling the attachment list leaves the panel open', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  controller.open();
  controller.list.dispatchEvent(new win.Event('scroll', { bubbles: false, composed: true }));

  assert.equal(controller.panel.hidden, false);
});

test('Escape closes the panel and restores focus to the button', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'report.pdf' })]);

  controller.button.focus();
  controller.open();
  controller.panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.equal(controller.panel.hidden, true);
  assert.equal(win.document.activeElement, controller.button);
});

test('Escape restores the attachment button inside a shadow root', () => {
  const win = loadAttachments();
  const host = win.document.createElement('div');
  win.document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const header = win.document.createElement('header');
  shadow.appendChild(header);
  const controller = win.ISA_ATTACHMENTS.createAttachmentPanel({
    headerHost: header,
    conversationId: 'one',
    records: [makeRecord(win, { filename: 'report.pdf' })]
  });

  controller.button.focus();
  assert.equal(win.document.activeElement, host);
  controller.open();
  controller.panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.equal(shadow.activeElement, controller.button);
  assert.equal(controller.panel.hidden, true);
  controller.destroy();
});

test('opening focuses the first row and arrows cycle through the rows', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [
    makeRecord(win, { filename: 'first.pdf' }),
    makeRecord(win, { filename: 'second.pdf' })
  ]);

  controller.open();
  const rows = [...controller.list.querySelectorAll('.isa-attachment-row')];
  assert.equal(win.document.activeElement, rows[0]);

  controller.panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(win.document.activeElement, rows[1]);
  controller.panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  assert.equal(win.document.activeElement, rows[0]);
});

test('a conversation change replaces the rows and closes the panel', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'old.pdf' })]);

  controller.open();
  controller.setConversation('two', [makeRecord(win, { filename: 'new.pdf' })]);

  assert.equal(controller.panel.hidden, true);
  assert.equal(controller.getConversationId(), 'two');
  controller.open();
  assert.deepEqual(rowNames(controller), ['new.pdf']);
});

test('a row whose message left the document closes the panel without scrolling', () => {
  const win = loadAttachments();
  const record = makeRecord(win, { filename: 'gone.pdf' });
  let scrolled = false;
  record.messageElement.scrollIntoView = () => { scrolled = true; };
  const controller = makePanel(win, [record]);

  controller.open();
  record.messageElement.remove();
  controller.list.querySelector('.isa-attachment-row').click();

  assert.equal(scrolled, false);
  assert.equal(controller.panel.hidden, true);
});

test('destroy removes the button, the panel, and its listeners', () => {
  const win = loadAttachments();
  const controller = makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);
  controller.open();
  const removed = [];
  const track = (target, label) => {
    const original = target.removeEventListener.bind(target);
    target.removeEventListener = (type, listener, capture) => {
      removed.push(`${label}:${type}:${Boolean(capture)}`);
      original(type, listener, capture);
    };
  };
  track(win.document, 'document');
  track(win, 'window');

  controller.destroy();

  assert.deepEqual(removed.sort(), ['document:pointerdown:true', 'window:resize:false', 'window:scroll:true']);
  assert.equal(controller.button.parentNode, null);
  assert.equal(controller.panel.parentNode, null);
  assert.equal(win.document.querySelector('.isa-attachments-button'), null);
});

test('the panel style ships a dark scheme through prefers-color-scheme only', () => {
  const win = loadAttachments();
  makePanel(win, [makeRecord(win, { filename: 'one.pdf' })]);

  const css = win.document.getElementById('isa-attachment-panel-style').textContent;
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.equal(/data-theme/.test(css), false);
});

test('every row carries a download link that names the file', () => {
  const win = loadAttachments();
  const record = makeRecord(win, { filename: 'report.pdf' });
  record.href = 'https://example.com/report.pdf?signature=abc';
  const controller = makePanel(win, [record]);

  controller.open();

  const link = controller.list.querySelector('.isa-attachment-download');
  assert.equal(link.getAttribute('href'), 'https://example.com/report.pdf?signature=abc');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.getAttribute('download'), 'report.pdf');
  assert.equal(link.getAttribute('aria-label'), 'Download report.pdf');
});

test('a row for an unloaded message stays downloadable but refuses to jump', () => {
  const win = loadAttachments();
  const record = makeRecord(win, { filename: 'old.pdf', message: false });
  record.href = 'https://example.com/old.pdf';
  const controller = makePanel(win, [record]);

  controller.open();

  const row = controller.list.querySelector('.isa-attachment-row');
  assert.equal(row.disabled, true);
  assert.equal(row.title, 'old.pdf\nMessage not loaded');
  assert.ok(controller.list.querySelector('.isa-attachment-download'));
});

test('a record without a usable href renders no download link', () => {
  const win = loadAttachments();
  const record = makeRecord(win, { filename: 'report.pdf' });
  record.href = 'javascript:alert(1)';
  const controller = makePanel(win, [record]);

  controller.open();

  assert.equal(controller.list.querySelector('.isa-attachment-download'), null);
});

test('arrow keys reach the download link and skip unloaded rows', () => {
  const win = loadAttachments();
  const loaded = makeRecord(win, { filename: 'one.pdf' });
  loaded.href = 'https://example.com/one.pdf';
  const unloaded = makeRecord(win, { filename: 'two.pdf', message: false });
  unloaded.href = 'https://example.com/two.pdf';
  const controller = makePanel(win, [loaded, unloaded]);

  controller.open();
  const order = [];
  for (let step = 0; step < 4; step += 1) {
    order.push(win.document.activeElement.className);
    controller.panel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  }

  assert.deepEqual(Array.from(order), [
    'isa-attachment-row',
    'isa-attachment-download',
    'isa-attachment-download',
    'isa-attachment-panel-close'
  ]);
});
