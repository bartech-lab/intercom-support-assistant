'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'note-controls.js'), 'utf8');
const PAGE = '<!doctype html><html><body style="margin:40px">'
  + '<input id="before"><span id="light"></span><input id="after">'
  + '<div id="shadow-host"></div><p id="outside" style="margin-top:400px">outside</p></body></html>';

function mount() {
  window.changes = [];
  const build = (id, parent, extra) => {
    const control = window.ISA_NOTE_CONTROLS.createSelect(Object.assign({
      make: tag => document.createElement(tag),
      label: id,
      items: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }],
      listboxId: `${id}-list`,
      gap: 2,
      layerClass: `${id}-menu`,
      layerCss: 'position:fixed;left:0;top:0;z-index:10;background:Canvas;',
      triggerCss: 'display:inline-flex;gap:6px;min-width:96px;',
      caretOpacity: '0.7',
      styleLayer: () => {},
      rowColors: active => ({ background: active ? 'Highlight' : 'transparent', color: 'inherit' }),
      styleDisabled: () => {},
      onCommit: value => window.changes.push(`${id}:${value}`)
    }, extra));
    control.trigger.id = id;
    parent.append(control.trigger);
    return control;
  };
  window.controls = { light: build('light-select', document.getElementById('light')) };
  const root = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
  window.controls.shadow = build('shadow-select', root, { gap: 4 });
}

const SKIP = !process.env.ISA_PLAYWRIGHT_MODULE;

test.describe('note dropdown in real Chromium', { skip: SKIP }, () => {
  let browser = null;
  let page = null;

  test.before(async () => {
    const { chromium } = require(process.env.ISA_PLAYWRIGHT_MODULE);
    browser = await chromium.launch({
      executablePath: process.env.ISA_CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true
    });
  });

  test.after(async () => {
    if (browser) await browser.close();
  });

  test.beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(PAGE);
    await page.addScriptTag({ content: SOURCE });
    await page.evaluate(mount);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    page = null;
  });

  const state = name => page.evaluate((which) => {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return {
      open: window.controls[which].isOpen(),
      value: window.controls[which].value,
      focus: active ? active.id : '',
      layers: document.querySelectorAll('[role="listbox"]').length,
      changes: window.changes.slice()
    };
  }, name);

  test('a click opens the list and puts keyboard focus on the trigger; arrows and Enter commit and keep focus', async () => {
    await page.click('#light-select');
    assert.deepEqual(await state('light'), { open: true, value: 'a', focus: 'light-select', layers: 1, changes: [] });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.deepEqual(await state('light'), { open: false, value: 'c', focus: 'light-select', layers: 0, changes: ['light-select:c'] });
  });

  test('tabbing onto the trigger and pressing Space opens it; Escape closes it and focus stays', async () => {
    await page.focus('#before');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    assert.equal((await state('light')).open, true);
    await page.keyboard.press('Escape');
    assert.deepEqual(await state('light'), { open: false, value: 'a', focus: 'light-select', layers: 0, changes: [] });
  });

  test('Tab closes the list without choosing and moves focus to the next field', async () => {
    await page.click('#light-select');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    assert.deepEqual(await state('light'), { open: false, value: 'a', focus: 'after', layers: 0, changes: [] });
  });

  test('clicking a row commits it, keeps focus on the trigger and never blurs the list away first', async () => {
    await page.click('#light-select');
    await page.click('#light-select-list-option-1');
    assert.deepEqual(await state('light'), { open: false, value: 'b', focus: 'light-select', layers: 0, changes: ['light-select:b'] });
  });

  test('a click elsewhere on the page closes the list without choosing', async () => {
    await page.click('#light-select');
    await page.mouse.click(60, 300);
    const after = await state('light');
    assert.equal(after.open, false);
    assert.equal(after.layers, 0);
    assert.deepEqual(after.changes, []);
  });

  test('the list sits under its trigger, at the trigger left edge and at least as wide', async () => {
    await page.click('#light-select');
    const box = await page.evaluate(() => {
      const trigger = document.getElementById('light-select').getBoundingClientRect();
      const layer = document.querySelector('[role="listbox"]').getBoundingClientRect();
      return { gap: Math.round(layer.top - trigger.bottom), left: Math.round(layer.left - trigger.left), wide: layer.width >= trigger.width };
    });
    assert.deepEqual(box, { gap: 2, left: 0, wide: true });
  });

  test('a trigger inside a shadow root opens, takes keys, commits by click and closes on an outside click', async () => {
    await page.click('#shadow-select');
    assert.deepEqual(await state('shadow'), { open: true, value: 'a', focus: 'shadow-select', layers: 1, changes: [] });
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.deepEqual(await state('shadow'), { open: false, value: 'c', focus: 'shadow-select', layers: 0, changes: ['shadow-select:c'] });
    await page.click('#shadow-select');
    await page.click('#shadow-select-list-option-0');
    assert.equal((await state('shadow')).value, 'a');
    await page.click('#shadow-select');
    await page.mouse.click(60, 300);
    assert.equal((await state('shadow')).open, false);
  });

  test('opening one list closes the other', async () => {
    await page.click('#light-select');
    await page.click('#shadow-select');
    assert.equal((await state('light')).open, false);
    assert.deepEqual(await state('shadow'), { open: true, value: 'a', focus: 'shadow-select', layers: 1, changes: [] });
  });
});

const LIFETIME_SOURCES = ['field-input.js', 'intercom-temporary-notes.js', 'note-controls.js']
  .map(name => fs.readFileSync(path.join(__dirname, '..', '..', 'src', name), 'utf8'));

function mountLifetime() {
  const state = { enabled: true, choice: 'custom-date', amount: '36', unit: 'hours', day: '', dayInput: null,
    time: '', status: 'idle', error: '' };
  const make = tag => document.createElement(tag);
  let sequence = 0;
  const select = ({ label, items, onOpen, onChange }) => {
    sequence += 1;
    const control = window.ISA_NOTE_CONTROLS.createSelect({
      make, label, items, onOpen, listboxId: `lifetime-list-${sequence}`, gap: 2, layerClass: 'lifetime-menu',
      layerCss: 'position:fixed;left:0;top:0;z-index:10;background:Canvas;',
      triggerCss: 'display:inline-flex;gap:6px;min-width:96px;', caretOpacity: '0.7', styleLayer: () => {},
      rowColors: active => ({ background: active ? 'Highlight' : 'transparent', color: 'inherit' }),
      styleDisabled: () => {}, onCommit: value => onChange(value)
    });
    return control;
  };
  const controls = window.ISA_NOTE_CONTROLS.createLifetimeControls({
    make,
    state: () => state,
    clock: () => Date.now(),
    prefix: 'lifetime',
    select,
    items: [{ value: '3600000', label: '1 hour' }, { value: 'custom-delay', label: 'Custom delay' },
      { value: 'custom-date', label: 'Custom date' }],
    units: [{ value: 'hours', label: 'hours' }, { value: 'days', label: 'days' }],
    lifetimeInLabel: false,
    styles: { root: { css: 'display:grid;gap:6px;' }, label: '', delayWrap: '', dateWrap: '', amount: '', date: '', time: '',
      preview: { className: 'preview', css: '' }, status: '', display: { lifetime: 'inline-flex', delayWrap: 'flex', dateWrap: 'flex' } },
    resolve: () => null,
    describe: () => ({ text: '', title: '' }),
    notice: () => null,
    fieldBorder: () => '',
    onChange: () => controls.render(),
    refresh: () => controls.render()
  });
  document.getElementById('host').append(controls.root);
  controls.render();
  window.lifetimeControls = controls;
}

test.describe('auto-delete controls in real Chromium', { skip: SKIP }, () => {
  let browser = null;
  let page = null;

  test.before(async () => {
    const { chromium } = require(process.env.ISA_PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ executablePath: process.env.ISA_CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  });

  test.after(async () => {
    if (browser) await browser.close();
  });

  test.beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent('<!doctype html><html><body style="margin:40px"><input id="before"><div id="host"></div></body></html>');
    for (const content of LIFETIME_SOURCES) await page.addScriptTag({ content });
    await page.evaluate(mountLifetime);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    page = null;
  });

  const popups = () => page.evaluate(() => ({
    calendar: !document.querySelector('.lifetime-calendar').hidden,
    list: document.querySelectorAll('[role="listbox"]').length,
    reported: window.lifetimeControls.popupOpen()
  }));

  test('the calendar and a dropdown list are never open together, whichever opens second', async () => {
    await page.click('.lifetime-calendar-trigger');
    assert.deepEqual(await popups(), { calendar: true, list: 0, reported: true });
    await page.click('[role="combobox"][aria-label="Auto-delete lifetime"]');
    assert.deepEqual(await popups(), { calendar: false, list: 1, reported: true });
    await page.$eval('.lifetime-calendar-trigger', button => button.click());
    assert.deepEqual(await popups(), { calendar: true, list: 0, reported: true });
    await page.keyboard.press('Escape');
    assert.deepEqual(await popups(), { calendar: false, list: 0, reported: false });
  });

  test('Tab walks checkbox, lifetime, date, calendar button and time in that order', async () => {
    await page.focus('#before');
    const order = [];
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
    }
    assert.deepEqual(order, ['Auto-delete', 'Auto-delete lifetime', 'Auto-delete date as DD/MM/YYYY', 'Open calendar',
      'Auto-delete time, 24-hour clock']);
  });

  test('a day picked in the calendar fills the date and leaves focus in the date field', async () => {
    await page.click('.lifetime-calendar-trigger');
    await page.click('.lifetime-calendar-day[data-day$="-15"]');
    const after = await page.evaluate(() => ({
      value: document.querySelector('[aria-label="Auto-delete date as DD/MM/YYYY"]').value,
      focus: document.activeElement.getAttribute('aria-label')
    }));
    assert.match(after.value, /^15\/\d{2}\/\d{4}$/);
    assert.equal(after.focus, 'Auto-delete date as DD/MM/YYYY');
  });
});
