'use strict';

process.env.TZ = 'Europe/Warsaw';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FORMS, LATER, describe } = require('../support/lifetime-controls-forms');

const RECORD = path.join(__dirname, 'lifetime-controls.characterization.json');
const stored = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : { lines: [], cases: {} };
const recorded = Object.fromEntries(Object.entries(stored.cases)
  .map(([name, indexes]) => [name, indexes.map(index => stored.lines[index])]));
const seen = {};

const customDate = (form, day, time) => {
  form.setOn(true);
  form.pick('choice', 'custom-date');
  form.type('date', day);
  form.type('time', time);
};

const SCENARIOS = {
  opened: () => {},
  off: form => form.setOn(false),
  'off after a custom date': (form) => {
    customDate(form, '01/10/2026', '10:00');
    form.setOn(false);
  },
  'preset one hour': (form) => {
    form.setOn(true);
    form.pick('choice', '3600000');
  },
  'custom delay of 2 days': (form) => {
    form.setOn(true);
    form.pick('choice', 'custom-delay');
    form.type('amount', '2');
    form.pick('unit', 'days');
  },
  'custom delay of zero': (form) => {
    form.setOn(true);
    form.pick('choice', 'custom-delay');
    form.type('amount', '0');
  },
  'custom delay left empty': (form) => {
    form.setOn(true);
    form.pick('choice', 'custom-delay');
    form.type('amount', '');
  },
  'custom date in range': form => customDate(form, '01/10/2026', '10:00'),
  'custom date half typed': form => customDate(form, '01/1', '10:00'),
  'custom date with no time': form => customDate(form, '01/10/2026', ''),
  'custom date with a half typed time': form => customDate(form, '01/10/2026', '7'),
  'custom date in the past': form => customDate(form, '01/01/2020', '10:00'),
  'custom date too far ahead': form => customDate(form, '01/01/2040', '10:00'),
  'custom date in a clock change gap': form => customDate(form, '28/03/2027', '02:30'),
  'a time edited down to 6:05, before leaving the field': (form) => {
    customDate(form, '01/10/2026', '16:05');
    form.type('time', '6:05');
  },
  'a time edited down to 6:05, after leaving the field': (form) => {
    customDate(form, '01/10/2026', '16:05');
    form.type('time', '6:05');
    form.leave('time');
  },
  'calendar open': (form) => {
    customDate(form, '01/10/2026', '10:00');
    form.click('calendar');
  },
  'dropdown opened over an open calendar': (form) => {
    customDate(form, '01/10/2026', '10:00');
    form.click('calendar');
    form.click('choice');
  },
  'calendar opened over an open dropdown': (form) => {
    customDate(form, '01/10/2026', '10:00');
    form.click('choice');
    form.click('calendar');
  },
  'save in flight': async (form) => {
    customDate(form, '01/10/2026', '10:00');
    await form.save('pending');
  },
  'typing while a save is in flight': async (form) => {
    customDate(form, '01/10/2026', '10:00');
    await form.save('pending');
    form.type('time', '11:00');
    form.type('date', '02/10/2026');
  },
  'save with an unknown result': async (form) => {
    customDate(form, '01/10/2026', '10:00');
    await form.save('uncertain');
  },
  'save refused': async (form) => {
    customDate(form, '01/10/2026', '10:00');
    await form.save('error');
  },
  'save refused then auto-delete switched off': async (form) => {
    customDate(form, '01/10/2026', '10:00');
    await form.save('error');
    form.setOn(false);
  },
  'save refused with a custom delay': async (form) => {
    form.setOn(true);
    form.pick('choice', 'custom-delay');
    form.type('amount', '2');
    await form.save('error');
  }
};

const VARIANTS = [
  ['intercom-add', 'cleanup paused, auto-delete on', { paused: true }, form => form.setOn(true)],
  ['intercom-change', 'deadline already passed, untouched', { now: LATER }, () => {}],
  ['intercom-change', 'deadline already passed, time retyped the same', { now: LATER }, (form) => {
    form.type('time', '09:55');
  }]
];

function check(name, lines) {
  seen[name] = lines;
  if (process.env.ISA_RECORD_CHARACTERIZATION) return;
  const before = recorded[name];
  assert.ok(before, `no recorded baseline for "${name}"`);
  const at = lines.findIndex((line, index) => line !== before[index]);
  const first = at < 0 && before.length > lines.length ? lines.length : at;
  assert.equal(first < 0 ? '' : `line ${first + 1}: ${lines[first]}`,
    first < 0 ? '' : `line ${first + 1}: ${before[first]}`, name);
}

for (const formName of Object.keys(FORMS)) {
  for (const [scenario, run] of Object.entries(SCENARIOS)) {
    const name = `${formName}: ${scenario}`;
    test(`characterization: ${name}`, async () => {
      const form = FORMS[formName]();
      await run(form);
      check(name, describe(form));
    });
  }
}

for (const [formName, scenario, options, run] of VARIANTS) {
  const name = `${formName}: ${scenario}`;
  test(`characterization: ${name}`, async () => {
    const form = FORMS[formName](options);
    await run(form);
    check(name, describe(form));
  });
}

test('characterization: the record holds exactly the cases above', () => {
  if (process.env.ISA_RECORD_CHARACTERIZATION) {
    const lines = [...new Set(Object.values(seen).flat())].sort();
    const place = new Map(lines.map((line, index) => [line, index]));
    const cases = Object.entries(seen).map(([name, found]) => `  ${JSON.stringify(name)}: [${found.map(line => place.get(line)).join(',')}]`);
    fs.writeFileSync(RECORD, `{\n "lines": ${JSON.stringify(lines, null, 1)},\n "cases": {\n${cases.join(',\n')}\n }\n}\n`);
    return;
  }
  assert.deepEqual(Object.keys(recorded).sort(), Object.keys(seen).sort());
});
