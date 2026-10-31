'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('../support/helpers');

function page() {
  return loadExtension('<!doctype html><html><head><title>Intercom</title></head><body><div id="host"></div></body></html>');
}

function ownElement(win, tag, namespace) {
  const element = namespace ? win.document.createElementNS(namespace, tag) : win.document.createElement(tag);
  element.setAttribute('data-isa-own', '');
  win.document.getElementById('host').appendChild(element);
  return element;
}

function inventory(win) {
  return win.ISA_DOM_CAPTURE.buildCapture({ surface: 'intercom' }).meta.ownElements;
}

test('an own element is inventoried with whole-pixel geometry and trimmed text', () => {
  const win = page();
  const chip = ownElement(win, 'span');
  chip.className = 'isa-chip';
  chip.textContent = '  ✉ support  ';
  chip.getBoundingClientRect = () => ({ top: 10.6, left: 3.2, width: 15.5, height: 7.49 });
  const [entry] = inventory(win).filter(item => item.className === 'isa-chip');
  assert.deepEqual({ ...entry.rect }, { top: 11, left: 3, width: 16, height: 7 });
  assert.equal(entry.text, '✉ support');
});

test('an own SVG element reports no class name rather than its animated value', () => {
  const win = page();
  const icon = ownElement(win, 'svg', 'http://www.w3.org/2000/svg');
  icon.setAttribute('class', 'isa-icon');
  const [entry] = inventory(win).filter(item => item.tag === 'svg');
  assert.equal(entry.className, null);
});

test('an inventory that fails part-way yields an empty list and the capture still succeeds', () => {
  const win = page();
  ownElement(win, 'span');
  win.getComputedStyle = () => { throw new Error('detached'); };
  const capture = win.ISA_DOM_CAPTURE.buildCapture({ surface: 'intercom' });
  assert.equal(capture.ok, true);
  assert.deepEqual(Array.from(capture.meta.ownElements), []);
});

test('a capture without a conversation is named after its view', () => {
  const win = page();
  const name = win.ISA_DOM_CAPTURE.captureFilename({
    surface: 'intercom', capturedAt: '2026-10-20T08:12:44.500Z', conversationId: null, view: 'inbox-list'
  });
  assert.equal(name, 'intercom-20261020T081244-inbox-list.html');
});
