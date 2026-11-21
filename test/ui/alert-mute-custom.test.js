'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const ROOT = path.join(__dirname, '..', '..', 'src');
const NOW = new Date(2026, 0, 15, 10, 0).getTime();
const MIN = 60000;
const MESSAGE = 'Enter a whole number of minutes from 1 to 720.';
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

function load({ store = {}, compact = false } = {}) {
  const attr = compact ? ' data-isa-compact="true"' : '';
  const dom = new JSDOM(`<!doctype html><html><body><div id="isa-alert-pacing"${attr}></div></body></html>`, {
    url: 'https://example.test/popup',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  unrefWindowTimers(win);
  const writes = [];
  win.Date.now = () => NOW;
  win.chrome = {
    runtime: { lastError: null },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get(defaults, callback) {
          const result = {};
          Object.entries(defaults).forEach(([key, fallback]) => { result[key] = key in store ? store[key] : fallback; });
          callback(result);
        },
        set(items, callback) {
          writes.push(JSON.parse(JSON.stringify(items)));
          Object.assign(store, items);
          if (callback) callback();
        }
      }
    }
  };
  const ctx = dom.getInternalVMContext();
  for (const file of ['alert-sounds.js', 'alert-settings-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return { win, writes, store, doc: win.document };
}

const q = (env, selector) => env.doc.querySelector(selector);
const hidden = element => element.hidden || element.style.display === 'none' || element.getAttribute('aria-hidden') === 'true';
const open = env => q(env, 'button[data-isa="muteCustomOpen"]');
const row = env => q(env, '[data-isa="muteCustomRow"]');
const input = env => q(env, 'input[data-isa="muteCustom"]');
const set = env => q(env, 'button[data-isa="muteCustomSet"]');
const label = env => q(env, '[data-isa="muteLabel"]').textContent.trim();
const status = env => q(env, '[data-isa="pacingStatus"]').textContent;
const type = (env, value) => { input(env).value = value; };
const enter = env => input(env).dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));

const MODES = [['expanded', false], ['compact', true]];

for (const [name, compact] of MODES) {
  const start = async (store) => {
    const env = load({ compact, store });
    await settled();
    return env;
  };

  test(`${name}: Custom button sits beside the 15/30/60 buttons, collapsed, with the row hidden`, async () => {
    const env = await start();
    assert.equal(open(env).textContent.trim(), 'Custom');
    assert.equal(open(env).getAttribute('aria-expanded'), 'false');
    assert.equal(set(env).textContent.trim(), 'Mute');
    assert.equal(hidden(row(env)), true);
    assert.equal(row(env).contains(input(env)), true);
    assert.equal(row(env).contains(set(env)), true);
    assert.equal(q(env, '[data-isa="muteButtons"]').contains(open(env)), true);
  });

  test(`${name}: Custom toggles the row and aria-expanded, and writes nothing`, async () => {
    const env = await start();
    open(env).click();
    await settled();
    assert.equal(hidden(row(env)), false);
    assert.equal(open(env).getAttribute('aria-expanded'), 'true');
    open(env).click();
    await settled();
    assert.equal(hidden(row(env)), true);
    assert.equal(open(env).getAttribute('aria-expanded'), 'false');
    assert.deepEqual(env.writes, []);
  });

  for (const minutes of [1, 45, 90, 720]) {
    test(`${name}: ${minutes} minutes then Mute stores only the end time and shows the muted state`, async () => {
      const env = await start();
      open(env).click();
      type(env, String(minutes));
      set(env).click();
      await settled();
      assert.deepEqual(env.writes, [{ isaAlertMuteUntil: NOW + minutes * MIN }]);
      const until = new Date(NOW + minutes * MIN);
      const pad = n => String(n).padStart(2, '0');
      assert.equal(label(env), `Muted until ${pad(until.getHours())}:${pad(until.getMinutes())}`);
      assert.equal(hidden(row(env)), true);
      assert.equal(hidden(q(env, '[data-isa="muteButtons"]')), true);
      assert.equal(hidden(q(env, '[data-isa="unmute"]')), false);
    });
  }

  test(`${name}: 45 minutes from 10:00 reads Muted until 10:45`, async () => {
    const env = await start();
    open(env).click();
    type(env, '45');
    set(env).click();
    await settled();
    assert.equal(label(env), 'Muted until 10:45');
  });

  test(`${name}: Enter in the input does the same as Mute`, async () => {
    const env = await start();
    open(env).click();
    type(env, '20');
    enter(env);
    await settled();
    assert.deepEqual(env.writes, [{ isaAlertMuteUntil: NOW + 20 * MIN }]);
    assert.equal(label(env), 'Muted until 10:20');
    assert.equal(hidden(row(env)), true);
  });

  for (const bad of ['0', '721', '', 'abc', '1.5', '-5', '1000']) {
    test(`${name}: "${bad}" writes nothing, marks the input invalid and shows the message`, async () => {
      const env = await start();
      open(env).click();
      type(env, bad);
      set(env).click();
      await settled();
      assert.deepEqual(env.writes, []);
      assert.equal(input(env).getAttribute('aria-invalid'), 'true');
      assert.equal(status(env), MESSAGE);
      assert.equal(hidden(q(env, '[data-isa="muteButtons"]')), false);
    });
  }

  test(`${name}: Enter with a bad value is rejected the same way`, async () => {
    const env = await start();
    open(env).click();
    type(env, '721');
    enter(env);
    await settled();
    assert.deepEqual(env.writes, []);
    assert.equal(input(env).getAttribute('aria-invalid'), 'true');
  });

  test(`${name}: a valid entry after a bad one clears aria-invalid and saves`, async () => {
    const env = await start();
    open(env).click();
    type(env, 'abc');
    set(env).click();
    await settled();
    assert.equal(input(env).getAttribute('aria-invalid'), 'true');
    type(env, '30');
    set(env).click();
    await settled();
    assert.notEqual(input(env).getAttribute('aria-invalid'), 'true');
    assert.deepEqual(env.writes, [{ isaAlertMuteUntil: NOW + 30 * MIN }]);
  });

  test(`${name}: a stored active mute hides the custom row`, async () => {
    const env = await start({ isaAlertMuteUntil: NOW + 30 * MIN });
    assert.equal(hidden(row(env)), true);
  });

  test(`${name}: after Unmute the Custom button is back and the row must be opened again`, async () => {
    const env = await start();
    open(env).click();
    type(env, '10');
    set(env).click();
    await settled();
    q(env, '[data-isa="unmute"]').click();
    await settled();
    assert.equal(hidden(q(env, '[data-isa="muteButtons"]')), false);
    assert.equal(hidden(open(env)), false);
    assert.equal(hidden(row(env)), true);
    assert.equal(open(env).getAttribute('aria-expanded'), 'false');
  });
}
