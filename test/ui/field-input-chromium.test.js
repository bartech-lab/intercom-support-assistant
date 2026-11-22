'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'field-input.js'), 'utf8');
const PAGE = '<!doctype html><html><body><input id="time"><input id="day"></body></html>';

function bindBoth() {
  window.ISA_FIELDS.bindTyped(document.getElementById('time'), window.ISA_FIELDS.clockType);
  window.ISA_FIELDS.bindTyped(document.getElementById('day'), window.ISA_FIELDS.dayType);
}

const SKIP = !process.env.ISA_PLAYWRIGHT_MODULE;

test.describe('typed fields in real Chromium', { skip: SKIP }, () => {
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
    await page.evaluate(bindBoth);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    page = null;
  });

  const state = selector => page.$eval(selector, el => ({ value: el.value, caret: el.selectionStart }));
  const caretAt = (selector, position) => page.$eval(selector, (el, at) => { el.focus(); el.setSelectionRange(at, at); }, position);

  test('typing a time key by key adds the colon and keeps the caret at the end', async () => {
    await page.click('#time');
    await page.keyboard.type('1230');
    assert.deepEqual(await state('#time'), { value: '12:30', caret: 5 });
  });

  test('a refused digit in the middle of a time leaves the value and the caret where they were', async () => {
    await page.click('#time');
    await page.keyboard.type('1230');
    await caretAt('#time', 4);
    await page.keyboard.type('9');
    assert.deepEqual(await state('#time'), { value: '12:30', caret: 4 });
    await caretAt('#time', 1);
    await page.keyboard.type('7');
    assert.deepEqual(await state('#time'), { value: '12:30', caret: 1 });
  });

  test('deleting an hour digit in the middle keeps the minutes and the caret', async () => {
    await page.click('#time');
    await page.keyboard.type('1230');
    await caretAt('#time', 1);
    await page.keyboard.press('Backspace');
    assert.deepEqual(await state('#time'), { value: '2:30', caret: 0 });
    await page.keyboard.type('2');
    assert.deepEqual(await state('#time'), { value: '22:30', caret: 1 });
  });

  test('one Backspace after the automatic colon removes the colon and the digit before it', async () => {
    await page.click('#time');
    await page.keyboard.type('13');
    assert.deepEqual(await state('#time'), { value: '13:', caret: 3 });
    await page.keyboard.press('Backspace');
    assert.deepEqual(await state('#time'), { value: '1', caret: 1 });
  });

  test('typing a date key by key adds both slashes, and a middle edit keeps the caret', async () => {
    await page.click('#day');
    await page.keyboard.type('1503');
    await page.keyboard.type('2027');
    assert.deepEqual(await state('#day'), { value: '15/03/2027', caret: 10 });
    await caretAt('#day', 2);
    await page.keyboard.press('Backspace');
    assert.deepEqual(await state('#day'), { value: '1/03/2027', caret: 1 });
    await page.keyboard.type('8');
    assert.deepEqual(await state('#day'), { value: '18/03/2027', caret: 2 });
    await page.keyboard.type('9');
    assert.deepEqual(await state('#day'), { value: '18/03/2027', caret: 2 });
  });
  const clippedCalendar = () => page.evaluate(() => {
    const box = document.createElement('div');
    box.style.cssText = 'width:200px;height:60px;overflow:hidden;transform:translateX(0);margin:20px;';
    document.body.append(box);
    const field = document.createElement('input');
    const calendar = window.ISA_FIELDS.createCalendar({
      make: tag => document.createElement(tag), clock: () => Date.now(), anchor: field, prefix: 'probe', onPick: () => {}
    });
    box.append(field, calendar.wrap);
    calendar.trigger.click();
    const rect = calendar.panel.getBoundingClientRect();
    const points = [[rect.left + 3, rect.top + 3], [rect.right - 3, rect.bottom - 3], [rect.left + rect.width / 2, rect.bottom - 3]];
    return {
      tall: rect.height > 150,
      visible: points.every(([x, y]) => calendar.panel.contains(document.elementFromPoint(x, y))),
      inside: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    };
  });

  test('the open calendar is fully visible inside a small clipping, transformed container', async () => {
    assert.deepEqual(await clippedCalendar(), { tall: true, visible: true, inside: true });
  });

  test('Tab from the open calendar button walks into the calendar and out again past it', async () => {
    const result = await page.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'probe-date';
      const after = document.createElement('input');
      after.id = 'probe-after';
      const calendar = window.ISA_FIELDS.createCalendar({
        make: tag => document.createElement(tag), clock: () => Date.now(), anchor: field, prefix: 'probe', onPick: () => {}
      });
      document.body.prepend(field, calendar.wrap, after);
      window.probe = calendar;
      calendar.trigger.click();
      calendar.trigger.focus();
      return calendar.isOpen();
    });
    assert.equal(result, true);
    const where = () => page.evaluate(() => {
      const el = document.activeElement;
      return el.id || el.getAttribute('aria-label') || el.className;
    });
    await page.keyboard.press('Tab');
    assert.equal(await where(), 'Previous month');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await where(), 'Open calendar');
    await page.keyboard.press('Tab');
    await page.evaluate(() => document.querySelector('.probe-calendar-today').focus());
    await page.keyboard.press('Tab');
    assert.equal(await where(), 'probe-after', 'leaving the last control moves on to the field after the button');
    assert.equal(await page.evaluate(() => window.probe.isOpen()), false);
  });
});
