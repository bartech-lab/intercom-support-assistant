'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const SRC = path.join(__dirname, '..', '..', 'src');

function load() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.intercom.com/a/inbox',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  unrefWindowTimers(dom.window);
  dom.window.chrome = {
    runtime: { lastError: null },
    storage: {
      onChanged: { addListener() {} },
      local: { get(defaults, cb) { cb(defaults); } }
    }
  };
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync(path.join(SRC, 'shared-runtime.js'), 'utf8'), context, { filename: 'shared-runtime.js' });
  vm.runInContext(fs.readFileSync(path.join(SRC, 'field-input.js'), 'utf8'), context, { filename: 'field-input.js' });
  return {
    win: dom.window,
    fields: dom.window.ISA_FIELDS,
    minutes: text => vm.runInContext('isaClockMinutes', context)(text)
  };
}

const env = load();
const F = env.fields;

test('clock typing follows the keystroke table', () => {
  const cases = [
    ['', '1', '1'],
    ['1', '12', '12:'],
    ['', '7', '07:'],
    ['', '3', '03:'],
    ['', '0', '0'],
    ['', '2', '2'],
    ['1', '1:', '1'],
    ['1', '1.', '1'],
    ['2', '24', '2'],
    ['2', '23', '23:'],
    ['12:', '12:7', '12:'],
    ['12:', '12:5', '12:5'],
    ['12:5', '12:59', '12:59'],
    ['12:5', '12:60', '12:5'],
    ['12:', '12::', '12:'],
    ['12:34', '12:345', '12:34'],
    ['12:', '12', '1'],
    ['07:', '07:0', '07:0'],
    ['07:0', '07:07', '07:07'],
    ['', 'abc', ''],
    ['', 'a1', '1'],
    ['1', '1x', '1'],
    ['12:3', '12:3', '12:3'],
    ['', '', '']
  ];
  cases.forEach(([previous, raw, expected]) => {
    assert.equal(F.clockType(previous, raw), expected, `clockType(${JSON.stringify(previous)}, ${JSON.stringify(raw)})`);
  });
});

test('clock typing refuses an out-of-range digit instead of clamping it', () => {
  assert.equal(F.clockType('2', '24'), '2');
  assert.notEqual(F.clockType('2', '24'), '23:');
  assert.equal(F.clockType('07:', '07:0'), '07:0');
  assert.notEqual(F.clockType('07:', '07:0'), '23:');
  assert.equal(F.clockType('12:', '12:7'), '12:');
});

test('clock mid-field edits are not re-flowed', () => {
  const cases = [
    ['12:30', '2:30', '2:30'],
    ['2:30', '22:30', '22:30'],
    ['2:30', '52:30', '2:30']
  ];
  cases.forEach(([previous, raw, expected]) => {
    assert.equal(F.clockType(previous, raw), expected, `clockType(${JSON.stringify(previous)}, ${JSON.stringify(raw)})`);
  });
});

test('clock paste of a complete valid time is zero-padded whatever was there before', () => {
  ['7:05', '7.05', '0705', '07:05', ' 7:05 '].forEach(raw => {
    ['', '1', '12:30', '07:05'].forEach(previous => {
      if (previous === '07:05' && raw === '7:05') return;
      assert.equal(F.clockType(previous, raw), '07:05', `paste ${JSON.stringify(raw)} over ${JSON.stringify(previous)}`);
    });
  });
});

test('clock paste of an impossible time never appears as typed', () => {
  ['25:00', '1275'].forEach(raw => {
    const result = F.clockType('', raw);
    assert.notEqual(result, '25:00', raw);
    assert.notEqual(result, '12:75', raw);
    assert.notEqual(result, '1275', raw);
  });
});

test('clockParse accepts only a complete valid time and zero-pads it', () => {
  const good = [
    ['07:05', '07:05'], ['7:05', '07:05'], ['7.05', '07:05'], ['00:00', '00:00'],
    ['23:59', '23:59'], [' 9:30 ', '09:30']
  ];
  good.forEach(([text, expected]) => assert.equal(F.clockParse(text), expected, text));
  ['', '12:3', '24:00', '12:60', '1230', 'ab:cd', '12:30 PM', '12:30:00', null, undefined].forEach(text => {
    assert.equal(F.clockParse(text), null, String(text));
  });
});

test('every clockParse result is accepted by the strict stored-value reader', () => {
  assert.equal(env.minutes('07:05'), 425);
  assert.equal(env.minutes('7:05'), null);
  let checked = 0;
  for (let minute = 0; minute < 1440; minute += 1) {
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    const mm = String(m).padStart(2, '0');
    const padded = `${String(h).padStart(2, '0')}:${mm}`;
    [`${h}:${mm}`, padded].forEach(text => {
      const parsed = F.clockParse(text);
      assert.equal(parsed, padded, text);
      assert.equal(env.minutes(parsed), minute, text);
      checked += 1;
    });
  }
  assert.equal(checked, 2880);
});

test('CLOCK_ERROR is the exact message', () => {
  assert.equal(F.CLOCK_ERROR, 'Enter the time as HH:MM on a 24-hour clock, for example 22:00.');
});

test('date typing follows the keystroke table', () => {
  const cases = [
    ['', '1', '1'],
    ['', '5', '05/'],
    ['', '0', '0'],
    ['', '3', '3'],
    ['1', '15', '15/'],
    ['15/0', '15/03', '15/03/'],
    ['15/', '15/3', '15/03/'],
    ['15/', '15/1', '15/1'],
    ['15/', '15/0', '15/0'],
    ['1', '1/', '1'],
    ['15/1', '15/1/', '15/1'],
    ['3', '32', '3'],
    ['0', '00', '0'],
    ['15/1', '15/13', '15/1'],
    ['15/0', '15/00', '15/0'],
    ['15/', '15', '1'],
    ['15/03/', '15/03/2', '15/03/2'],
    ['15/03/202', '15/03/2027', '15/03/2027'],
    ['15/03/2027', '15/03/2027' + '5', '15/03/2027'],
    ['15/03/2027', '5/03/2027', '5/03/2027'],
    ['', 'ab', ''],
    ['1', '1a', '1'],
    ['31/0', '31/02', '31/02/'],
    ['1', '1.', '1'],
    ['1', '1-', '1']
  ];
  cases.forEach(([previous, raw, expected]) => {
    assert.equal(F.dayType(previous, raw), expected, `dayType(${JSON.stringify(previous)}, ${JSON.stringify(raw)})`);
  });
});

test('date paste of a complete valid date is normalised to DD/MM/YYYY', () => {
  const cases = [
    ['15/03/2027', '15/03/2027'], ['15.03.2027', '15/03/2027'], ['15-03-2027', '15/03/2027'],
    [['15', '03', '2027'].join(''), '15/03/2027'], ['5/3/2027', '05/03/2027']
  ];
  cases.forEach(([raw, expected]) => {
    ['', '1', '15/03/2027'].forEach(previous => {
      assert.equal(F.dayType(previous, raw), expected, `paste ${raw} over ${JSON.stringify(previous)}`);
    });
  });
});

test('dayParse is strict DD/MM/YYYY and checks the calendar', () => {
  const good = [['15/03/2027', '2027-03-15'], ['29/02/2028', '2028-02-29'], ['31/12/2026', '2026-12-31']];
  good.forEach(([text, expected]) => assert.equal(F.dayParse(text), expected, text));
  ['31/02/2027', '29/02/2027', '00/01/2027', '01/13/2027', '1/03/2027', '15/03/27', '', null].forEach(text => {
    assert.equal(F.dayParse(text), null, String(text));
  });
});

test('dayDisplay turns an ISO date into DD/MM/YYYY or nothing', () => {
  assert.equal(F.dayDisplay('2027-03-15'), '15/03/2027');
  assert.equal(F.dayDisplay('garbage'), '');
  assert.equal(F.dayDisplay(null), '');
});

test('whole-number typing keeps digits and cuts to the maximum length', () => {
  const cases = [
    [['12a3', 3], '123'], [['1e5', 5], '15'], [['-7', 3], '7'], [['12345', 3], '123'], [['', 3], '']
  ];
  cases.forEach(([args, expected]) => assert.equal(F.wholeType(...args), expected, JSON.stringify(args)));
});

test('whole-number parsing enforces the range and rejects non-integers', () => {
  const cases = [
    ['5', 5], ['720', 720], ['721', null], ['0', null], ['', null], [' 5 ', 5], ['5.5', null], ['1e2', null]
  ];
  cases.forEach(([text, expected]) => assert.equal(F.wholeParse(text, 1, 720), expected, JSON.stringify(text)));
});

function field(initial) {
  const input = env.win.document.createElement('input');
  input.type = 'text';
  if (initial !== undefined) input.value = initial;
  env.win.document.body.appendChild(input);
  return input;
}

function typeInto(input, value, caret, withBefore) {
  if (withBefore) input.dispatchEvent(new env.win.Event('beforeinput', { bubbles: true }));
  input.value = value;
  input.setSelectionRange(caret === undefined ? value.length : caret, caret === undefined ? value.length : caret);
  input.dispatchEvent(new env.win.Event('input', { bubbles: true }));
}

test('a bound field shows the typed result, reports it and keeps the caret at the end', () => {
  const input = field();
  const seen = [];
  F.bindTyped(input, F.clockType, value => seen.push(value));
  typeInto(input, '1');
  assert.equal(input.value, '1');
  typeInto(input, '12');
  assert.equal(input.value, '12:');
  assert.equal(seen[seen.length - 1], '12:');
  assert.equal(input.selectionStart, 3);
  typeInto(input, '12:7');
  assert.equal(input.value, '12:');
  assert.equal(seen[seen.length - 1], '12:');
  assert.equal(input.selectionStart, 3);
  assert.equal(seen.length, 3);
});

test('a bound field keeps the caret in place for a mid-field edit', () => {
  const input = field();
  F.bindTyped(input, F.clockType, () => {});
  typeInto(input, '12:30');
  assert.equal(input.value, '12:30');
  typeInto(input, '2:30', 0);
  assert.equal(input.value, '2:30');
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 0);
});

test('a refused mid-field insert moves the caret back by the inserted characters', () => {
  const input = field('2:30');
  F.bindTyped(input, F.clockType, () => {});
  typeInto(input, '52:30', 1);
  assert.equal(input.value, '2:30');
  assert.equal(input.selectionStart, 0);
});

test('a mid-field edit that is accepted shifts the caret by the length difference', () => {
  const input = field('2:30');
  F.bindTyped(input, F.clockType, () => {});
  typeInto(input, '22:30', 1);
  assert.equal(input.value, '22:30');
  assert.equal(input.selectionStart, 1);
});

test('the first previous value is the value at bind time', () => {
  const input = field('12:');
  F.bindTyped(input, F.clockType, () => {});
  typeInto(input, '12');
  assert.equal(input.value, '1');
});

test('a value set by the owning code between keystrokes is used as the previous value', () => {
  const input = field();
  const seen = [];
  F.bindTyped(input, F.clockType, value => seen.push(value));
  typeInto(input, '1', undefined, true);
  typeInto(input, '12', undefined, true);
  assert.equal(input.value, '12:');
  input.value = '';
  typeInto(input, '7', undefined, true);
  assert.equal(input.value, '07:');
  assert.equal(seen[seen.length - 1], '07:');
});

test('a redraw to a populated value is respected by the next keystroke', () => {
  const input = field();
  F.bindTyped(input, F.clockType, () => {});
  typeInto(input, '12', undefined, true);
  input.value = '2';
  typeInto(input, '24', undefined, true);
  assert.equal(input.value, '2');
});

test('a typed separator is ignored everywhere, because the field adds it on its own', () => {
  [['', ':'], ['1', '1:'], ['12:', '12::'], ['12:3', '12:3:'], ['1', '1.']].forEach(([previous, raw]) => {
    assert.equal(F.clockType(previous, raw), previous, `${JSON.stringify(raw)} after ${JSON.stringify(previous)}`);
  });
  [['', '/'], ['1', '1/'], ['15/1', '15/1/'], ['15/03/', '15/03//'], ['1', '1-']].forEach(([previous, raw]) => {
    assert.equal(F.dayType(previous, raw), previous, `${JSON.stringify(raw)} after ${JSON.stringify(previous)}`);
  });
});
