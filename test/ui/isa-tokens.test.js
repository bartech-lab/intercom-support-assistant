'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');
const SHARED_RUNTIME_SRC = fs.readFileSync(path.join(SRC_DIR, 'shared-runtime.js'), 'utf8');
const WORKSPACE_CSS = fs.readFileSync(path.join(SRC_DIR, 'workspace-theme.css'), 'utf8');
const INTERCOM_URL = 'https://app.intercom.com/a/inbox';
const OTHER_URL = 'https://desk.example/chat/all';
const SHARED_NAMES = ['ink', 'ink-muted', 'surface', 'surface-2', 'hairline', 'accent', 'accent-ink'];
const TEXT_PAIRS = [['ink', 'surface'], ['ink-muted', 'surface'], ['ink', 'surface-2'], ['accent-ink', 'accent'], ['block-ink', 'block'], ['warn-ink', 'warn']];

function load(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  unrefWindowTimers(dom.window);
  const context = dom.getInternalVMContext();
  vm.runInContext(SHARED_RUNTIME_SRC, context, { filename: 'shared-runtime.js' });
  return { win: dom.window, run: code => vm.runInContext(code, context) };
}

function tokens(run, name) {
  return JSON.parse(run(`JSON.stringify(${name})`));
}

function themeOf(win) {
  return win.document.documentElement.getAttribute('data-isa-theme');
}

function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => (value <= 809 / 20000 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

function workspaceBlock(selector) {
  const start = WORKSPACE_CSS.indexOf(`${selector} {`);
  assert.notEqual(start, -1);
  const body = WORKSPACE_CSS.slice(start, WORKSPACE_CSS.indexOf('}', start));
  const values = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) values[match[1]] = match[2].trim();
  return values;
}

test('Intercom dark class decides the theme even when the page background is light', () => {
  const { win, run } = load('<!doctype html><html class="h-full dark"><head></head><body style="background-color: rgb(255, 255, 255)"></body></html>', INTERCOM_URL);
  run('isaEnsureTokens()');
  assert.equal(themeOf(win), 'dark');
});

test('Intercom without the dark class is light even when the system prefers dark and the background is dark', () => {
  const { win, run } = load('<!doctype html><html class="h-full"><head></head><body style="background-color: rgb(10, 10, 10)"></body></html>', INTERCOM_URL);
  win.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  run('isaEnsureTokens()');
  assert.equal(themeOf(win), 'light');
});

test('the theme follows Intercom when it switches after the tokens were installed', async () => {
  const { win, run } = load('<!doctype html><html class="h-full"><head></head><body></body></html>', INTERCOM_URL);
  run('isaEnsureTokens()');
  assert.equal(themeOf(win), 'light');
  win.document.documentElement.classList.add('dark');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(themeOf(win), 'dark');
  win.document.documentElement.classList.remove('dark');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(themeOf(win), 'light');
});

test('another host takes its theme the page background, not from a dark class or the system', () => {
  const light = load('<!doctype html><html class="dark"><head></head><body style="background-color: rgb(241, 242, 247)"></body></html>', OTHER_URL);
  light.win.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  light.run('isaEnsureTokens()');
  assert.equal(themeOf(light.win), 'light');

  const dark = load('<!doctype html><html><head></head><body style="background-color: rgb(20, 22, 28)"></body></html>', OTHER_URL);
  dark.run('isaEnsureTokens()');
  assert.equal(themeOf(dark.win), 'dark');
});

test('the token block is installed once, is marked as owned, and defines every token for both themes', () => {
  const { win, run } = load('<!doctype html><html><head></head><body></body></html>', INTERCOM_URL);
  run('isaEnsureTokens(); isaEnsureTokens(); isaEnsureTokens()');
  const styles = win.document.querySelectorAll('#isa-tokens-style');
  assert.equal(styles.length, 1);
  assert.equal(styles[0].hasAttribute('data-isa-own'), true);

  const css = styles[0].textContent;
  const darkStart = css.indexOf(':root[data-isa-theme="dark"]');
  assert.ok(darkStart > 0);
  const lightCss = css.slice(0, darkStart);
  const darkCss = css.slice(darkStart);
  const light = tokens(run, 'ISA_TOKENS_LIGHT');
  const dark = tokens(run, 'ISA_TOKENS_DARK');
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort());
  for (const name of Object.keys(light)) {
    assert.ok(lightCss.includes(`--isa-${name}: ${light[name]};`), `light ${name}`);
    assert.ok(darkCss.includes(`--isa-${name}: ${dark[name]};`), `dark ${name}`);
  }
});

test('every text and background token pair meets 4.5:1 in both themes', () => {
  const { run } = load('<!doctype html><html><head></head><body></body></html>', INTERCOM_URL);
  for (const name of ['ISA_TOKENS_LIGHT', 'ISA_TOKENS_DARK']) {
    const set = tokens(run, name);
    for (const [text, background] of TEXT_PAIRS) {
      const ratio = contrast(set[text], set[background]);
      assert.ok(ratio >= 4.5, `${name} ${text} on ${background} is ${ratio.toFixed(2)}`);
    }
  }
});

test('the injected tokens and the extension page stylesheet hold the same values', () => {
  const { run } = load('<!doctype html><html><head></head><body></body></html>', INTERCOM_URL);
  const light = tokens(run, 'ISA_TOKENS_LIGHT');
  const dark = tokens(run, 'ISA_TOKENS_DARK');
  const pageLight = workspaceBlock(':root');
  const pageDark = workspaceBlock(':root[data-theme="dark"]');
  for (const name of SHARED_NAMES) {
    assert.equal(light[name], pageLight[name], `light ${name}`);
    assert.equal(dark[name], pageDark[name], `dark ${name}`);
  }
});
