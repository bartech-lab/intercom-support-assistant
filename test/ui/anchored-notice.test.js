'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared-runtime.js'), 'utf8');

function load(html = '<!doctype html><html><head></head><body></body></html>', url = 'https://app.intercom.com/a/inbox') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  unrefWindowTimers(dom.window);
  vm.runInContext(SRC, dom.getInternalVMContext(), { filename: 'shared-runtime.js' });
  return dom.window;
}

function anchorWithRect(win, rect) {
  const el = win.document.createElement('button');
  win.document.body.appendChild(el);
  const full = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...rect };
  el.getBoundingClientRect = () => full;
  return el;
}

function setWidth(win, value) {
  Object.defineProperty(win, 'innerWidth', { value, configurable: true });
}

function notices(win) {
  return win.document.querySelectorAll('#isa-anchored-notice');
}

function px(el, prop) {
  return parseFloat(el.style[prop]);
}

const CONTENT = { title: 'Close', body: 'Do the checklist first' };
const REAL = { top: 100, bottom: 130, left: 500, right: 600, width: 100, height: 30 };

test('adds exactly one notice to the body and returns it', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, REAL), CONTENT);
  assert.equal(notices(win).length, 1);
  assert.equal(notices(win)[0], el);
  assert.equal(el.parentNode, win.document.body);
});

test('notice carries the own marker attribute with an empty value', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(el.hasAttribute('data-isa-own'), true);
  assert.equal(el.getAttribute('data-isa-own'), '');
});

test('notice has the alert role', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(el.getAttribute('role'), 'alert');
});

test('notice shows both the title and the body text', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.ok(el.textContent.includes('Close'));
  assert.ok(el.textContent.includes('Do the checklist first'));
});

test('body markup is shown literally and creates no elements', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, { title: 'T', body: '<img src=x onerror=1>' });
  assert.ok(el.textContent.includes('<img src=x onerror=1>'));
  assert.equal(win.document.querySelectorAll('img').length, 0);
});

test('title markup is shown literally and creates no elements', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, { title: '<b>x</b>', body: 'b' });
  assert.ok(el.textContent.includes('<b>x</b>'));
  assert.equal(el.querySelectorAll('b').length, 0);
});

test('title sits in a strong element and the body text follows it', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  const strong = el.querySelector('strong');
  assert.ok(strong);
  assert.equal(strong.textContent, 'Close');
  const text = el.textContent;
  assert.ok(text.indexOf('Close') < text.indexOf('Do the checklist first'));
  assert.ok(!strong.textContent.includes('Do the checklist first'));
});

test('notice uses fixed positioning with pixel top and left', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, REAL), CONTENT);
  assert.equal(el.style.position, 'fixed');
  assert.match(el.style.top, /^-?\d+(\.\d+)?px$/);
  assert.match(el.style.left, /^-?\d+(\.\d+)?px$/);
});

test('top is eight pixels below the anchor bottom', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, REAL), CONTENT);
  assert.equal(px(el, 'top'), 138);
});

test('right edge lines up with the anchor right edge', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, REAL), CONTENT);
  assert.equal(px(el, 'left'), 300);
});

test('anchor near the left edge keeps left at eight', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, { ...REAL, left: 40, right: 100, bottom: 50 }), CONTENT);
  assert.equal(px(el, 'left'), 8);
});

test('anchor beyond the right edge keeps the notice inside the viewport', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, { ...REAL, left: 1900, right: 2000 }), CONTENT);
  assert.equal(px(el, 'left'), 1024 - 300 - 8);
});

test('right clamp follows a changed viewport width', () => {
  const win = load();
  setWidth(win, 800);
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, { ...REAL, left: 1900, right: 2000 }), CONTENT);
  assert.equal(px(el, 'left'), 800 - 300 - 8);
});

test('anchor that already fits is not moved by the clamps', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, { ...REAL, right: 316 }), CONTENT);
  assert.equal(px(el, 'left'), 16);
});

test('null anchor falls back to the top of the page', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(px(el, 'top'), 16);
});

test('null anchor centres the notice horizontally', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(px(el, 'left'), (1024 - 300) / 2);
});

test('anchor with an all-zero rectangle falls back to the top and centre', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, {}), CONTENT);
  assert.equal(px(el, 'top'), 16);
  assert.equal(px(el, 'left'), (1024 - 300) / 2);
});

test('centred fallback follows a changed viewport width', () => {
  const win = load();
  setWidth(win, 1400);
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(px(el, 'left'), (1400 - 300) / 2);
});

test('narrow viewport pins left at eight with an anchor', () => {
  const win = load();
  setWidth(win, 280);
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, { ...REAL, right: 270 }), CONTENT);
  assert.equal(px(el, 'left'), 8);
});

test('narrow viewport pins left at eight without an anchor', () => {
  const win = load();
  setWidth(win, 200);
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(px(el, 'left'), 8);
});

test('narrow viewport shrinks the width to the viewport minus sixteen', () => {
  const win = load();
  setWidth(win, 280);
  const el = win.isaShowAnchoredNotice(anchorWithRect(win, { ...REAL, right: 5000 }), CONTENT);
  assert.equal(px(el, 'left'), 8);
  assert.ok(px(el, 'left') + (280 - 16) <= 280 - 8);
});

test('showing a second notice removes the first from the document', () => {
  const win = load();
  const first = win.isaShowAnchoredNotice(null, { title: 'One', body: 'first body' });
  const second = win.isaShowAnchoredNotice(null, { title: 'Two', body: 'second body' });
  assert.equal(notices(win).length, 1);
  assert.equal(first.isConnected, false);
  assert.equal(second.isConnected, true);
  assert.ok(second.textContent.includes('second body'));
  assert.ok(!win.document.body.textContent.includes('first body'));
});

test('Escape removes the notice', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, CONTENT);
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(notices(win).length, 0);
});

test('Escape on an unrelated focused input still removes the notice', () => {
  const win = load();
  const input = win.document.createElement('input');
  win.document.body.appendChild(input);
  win.isaShowAnchoredNotice(null, CONTENT);
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(notices(win).length, 0);
});

test('other keys do not remove the notice', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  for (const key of ['c', 'Enter', 'Tab', ' ']) {
    win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true }));
  }
  assert.equal(el.isConnected, true);
});

test('pointerdown outside the notice removes it', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, CONTENT);
  win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(notices(win).length, 0);
});

test('pointerdown on another page element removes the notice', () => {
  const win = load();
  const other = win.document.createElement('div');
  win.document.body.appendChild(other);
  win.isaShowAnchoredNotice(null, CONTENT);
  other.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(notices(win).length, 0);
});

test('pointerdown on the notice itself keeps it', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  el.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(el.isConnected, true);
});

test('pointerdown on text inside the notice keeps it', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  el.querySelector('strong').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(el.isConnected, true);
});

test('hide function removes the notice', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, CONTENT);
  win.isaHideAnchoredNotice();
  assert.equal(notices(win).length, 0);
});

test('hide function can be called repeatedly with nothing shown', () => {
  const win = load();
  assert.doesNotThrow(() => {
    win.isaHideAnchoredNotice();
    win.isaHideAnchoredNotice();
  });
  win.isaShowAnchoredNotice(null, CONTENT);
  win.isaHideAnchoredNotice();
  assert.doesNotThrow(() => {
    win.isaHideAnchoredNotice();
    win.isaHideAnchoredNotice();
  });
});

test('events after dismissal do not throw', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, CONTENT);
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.doesNotThrow(() => {
    win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    win.isaHideAnchoredNotice();
  });
});

test('after a replacement one Escape dismisses the new notice without throwing', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, { title: 'A', body: 'a' });
  const second = win.isaShowAnchoredNotice(null, { title: 'B', body: 'b' });
  assert.doesNotThrow(() => {
    win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(second.isConnected, false);
  assert.equal(notices(win).length, 0);
});

test('after a replacement pointerdown outside dismisses the new notice', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, { title: 'A', body: 'a' });
  const second = win.isaShowAnchoredNotice(null, { title: 'B', body: 'b' });
  win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(second.isConnected, false);
  assert.equal(notices(win).length, 0);
});

test('after a replacement pointerdown inside the new notice keeps it', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, { title: 'A', body: 'a' });
  const second = win.isaShowAnchoredNotice(null, { title: 'B', body: 'b' });
  second.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(second.isConnected, true);
});

test('a notice shown after an earlier one was dismissed still dismisses on Escape', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, { title: 'A', body: 'a' });
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const next = win.isaShowAnchoredNotice(null, { title: 'B', body: 'b' });
  assert.equal(next.isConnected, true);
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(next.isConnected, false);
});

test('a notice shown after hide stays until its own dismissal', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, { title: 'A', body: 'a' });
  win.isaHideAnchoredNotice();
  const next = win.isaShowAnchoredNotice(null, { title: 'B', body: 'b' });
  next.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(next.isConnected, true);
  win.document.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(next.isConnected, false);
});

test('showing a notice installs the shared colour token style', () => {
  const win = load();
  assert.equal(win.document.getElementById('isa-tokens-style'), null);
  win.isaShowAnchoredNotice(null, CONTENT);
  assert.ok(win.document.getElementById('isa-tokens-style'));
});

test('showing twice installs the token style only once', () => {
  const win = load();
  win.isaShowAnchoredNotice(null, CONTENT);
  win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(win.document.querySelectorAll('#isa-tokens-style').length, 1);
});

test('notice colours come from the tokens, not literals', () => {
  const win = load();
  const el = win.isaShowAnchoredNotice(null, CONTENT);
  assert.ok(el.style.border.includes('var(--isa-block)'));
  assert.ok(el.style.background.includes('var(--isa-surface)'));
  assert.ok(el.style.color.includes('var(--isa-ink)'));
});

test('window.alert is never called', () => {
  const win = load();
  win.alert = () => { throw new Error('alert used'); };
  assert.doesNotThrow(() => {
    win.isaShowAnchoredNotice(anchorWithRect(win, REAL), CONTENT);
    win.isaShowAnchoredNotice(null, CONTENT);
    win.isaHideAnchoredNotice();
  });
});

test('without a body it returns null', () => {
  const win = load('<!doctype html><html><head></head></html>');
  win.document.body.remove();
  assert.equal(win.isaShowAnchoredNotice(null, CONTENT), null);
});

test('without a body nothing is added to the document', () => {
  const win = load('<!doctype html><html><head></head></html>');
  win.document.body.remove();
  win.isaShowAnchoredNotice(null, CONTENT);
  assert.equal(win.document.querySelectorAll('#isa-anchored-notice').length, 0);
  assert.equal(win.document.documentElement.children.length, 1);
});

test('focus stays on the previously focused input', () => {
  const win = load();
  const input = win.document.createElement('input');
  win.document.body.appendChild(input);
  input.focus();
  assert.equal(win.document.activeElement, input);
  win.isaShowAnchoredNotice(anchorWithRect(win, REAL), CONTENT);
  assert.equal(win.document.activeElement, input);
});
