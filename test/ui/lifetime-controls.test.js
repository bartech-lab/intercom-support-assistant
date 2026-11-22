'use strict';

process.env.TZ = 'Europe/Warsaw';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { unrefWindowTimers } = require('../support/helpers');

const read = name => fs.readFileSync(path.join(__dirname, '..', '..', 'src', name), 'utf8');
const SOURCES = ['shared-runtime.js', 'intercom-temporary-notes.js', 'field-input.js', 'note-controls.js']
  .map(name => ({ name, text: read(name) }));

const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const ACCENT = 'var(--isa-block)';
const FIELD_BORDER = 'rgb(1, 2, 3)';
const CONTEXT = { marker: 'render-context' };

const ITEMS = [
  { value: '3600000', label: '1 hour' },
  { value: '86400000', label: '1 day' },
  { value: 'custom-delay', label: 'Custom delay' },
  { value: 'custom-date', label: 'Custom date' }
];
const UNITS = [
  { value: 'hours', label: 'hours' },
  { value: 'days', label: 'days' }
];
const DISPLAY = { lifetime: 'inline-block', delayWrap: 'inline-flex', dateWrap: 'flex' };
const STYLES = {
  root: { className: 'cfg-root', css: 'margin-left:1px;' },
  label: 'margin-left:2px;',
  delayWrap: 'margin-left:3px;',
  dateWrap: 'margin-left:4px;',
  amount: 'margin-left:5px;',
  date: 'margin-left:6px;',
  time: 'margin-left:7px;',
  preview: { className: 'cfg-preview', css: 'margin-left:8px;' },
  status: 'margin-left:9px;',
  display: DISPLAY
};

function baseState(overrides) {
  return Object.assign({
    enabled: true,
    choice: '3600000',
    amount: '',
    unit: 'hours',
    day: '',
    dayInput: null,
    time: '',
    status: 'idle',
    error: ''
  }, overrides);
}

function normalized(win, css) {
  const element = win.document.createElement('div');
  element.style.cssText = css;
  return element.style.cssText;
}

function fakeSelectFactory(win, record) {
  return (config) => {
    const trigger = win.document.createElement('div');
    trigger.setAttribute('data-fake-select', config.label);
    const fake = {
      config,
      trigger,
      values: [],
      disabledCalls: [],
      opened: false,
      setValue(value) { fake.values.push(value); },
      setDisabled(flag) { fake.disabledCalls.push(flag); },
      isOpen: () => fake.opened
    };
    record.push(fake);
    return fake;
  };
}

function realSelectFactory(win) {
  let counter = 0;
  return (config) => {
    counter += 1;
    return win.ISA_NOTE_CONTROLS.createSelect({
      make: tag => win.document.createElement(tag),
      label: config.label,
      items: config.items,
      onOpen: config.onOpen,
      listboxId: `lifetime-listbox-${counter}`,
      gap: 2,
      layerClass: 'test-layer',
      layerCss: 'position:fixed;',
      triggerCss: '',
      caretOpacity: '1',
      styleLayer() {},
      rowColors: () => ({ background: '', color: '' }),
      styleDisabled() {},
      onCommit: config.onChange
    });
  };
}

function setup(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = unrefWindowTimers(dom.window);
  const context = dom.getInternalVMContext();
  SOURCES.forEach(source => vm.runInContext(source.text, context, { filename: source.name }));

  const holder = { current: options.state || baseState() };
  const log = { onChange: [], refresh: 0, notice: [], describe: [], made: [], selectConfigs: [] };
  const fakes = [];
  const control = { resolve: options.resolve || (() => ({ expiresAt: 'EXPIRES' })), notice: options.notice || (() => null) };
  const make = (tag) => {
    const element = win.document.createElement(tag);
    element.setAttribute('data-made', 'yes');
    log.made.push(tag);
    return element;
  };
  const selectFactory = options.realSelect ? realSelectFactory(win) : fakeSelectFactory(win, fakes);
  const config = {
    make,
    state: () => holder.current,
    clock: options.clock || (() => NOW),
    prefix: 'zz',
    select: (selectConfig) => {
      log.selectConfigs.push(selectConfig);
      return selectFactory(selectConfig);
    },
    items: ITEMS,
    units: UNITS,
    lifetimeInLabel: options.lifetimeInLabel === true,
    styles: STYLES,
    resolve: state => control.resolve(state),
    describe: (expiresAt) => {
      log.describe.push(expiresAt);
      return { text: `ends ${expiresAt}`, title: `title ${expiresAt}` };
    },
    notice: (state, ctx) => {
      log.notice.push({ state, ctx });
      return control.notice(state, ctx);
    },
    fieldBorder: () => FIELD_BORDER,
    onChange: () => { log.onChange.push(JSON.stringify(holder.current)); },
    refresh: () => { log.refresh += 1; }
  };
  const controls = win.ISA_NOTE_CONTROLS.createLifetimeControls(config);
  win.document.body.append(controls.root);
  return { win, holder, log, fakes, control, controls, root: controls.root, nodes: controls.nodes, config };
}

function fire(win, element, type) {
  element.dispatchEvent(new win.Event(type, { bubbles: true }));
}

function typeInto(win, input, value) {
  input.value = value;
  fire(win, input, 'input');
}

function shown(element, display = '') {
  return element.hidden === false && element.style.display === display;
}

function hidden(element) {
  return element.hidden === true && element.style.display === 'none';
}

function openCalendar(ctx) {
  ctx.nodes.calendar.trigger.click();
  assert.equal(ctx.nodes.calendar.isOpen(), true);
}

function dayButton(ctx, day) {
  return ctx.win.document.querySelector(`.zz-calendar-day[data-day="${day}"]`);
}

function dateState(overrides) {
  return baseState(Object.assign({ choice: 'custom-date', day: '2026-10-01', time: '10:00' }, overrides));
}

test('without lifetimeInLabel the root holds label, trigger, delay, date, preview, status in that order', () => {
  const ctx = setup({ lifetimeInLabel: false });
  const { root, nodes, fakes } = ctx;
  assert.deepEqual(Array.from(root.children), [
    nodes.label, fakes[0].trigger, nodes.delayWrap, nodes.dateWrap, nodes.preview, nodes.status
  ]);
  assert.equal(nodes.label.contains(fakes[0].trigger), false);
  assert.equal(nodes.choice, fakes[0]);
  assert.equal(nodes.unit, fakes[1]);
});

test('with lifetimeInLabel the trigger sits inside the label after the text and not beside it', () => {
  const ctx = setup({ lifetimeInLabel: true });
  const { root, nodes, fakes } = ctx;
  assert.deepEqual(Array.from(root.children), [
    nodes.label, nodes.delayWrap, nodes.dateWrap, nodes.preview, nodes.status
  ]);
  const kids = Array.from(nodes.label.childNodes);
  assert.equal(kids.length, 3);
  assert.equal(kids[0], nodes.toggle);
  assert.equal(kids[1].nodeType, 3);
  assert.equal(kids[1].data, 'Auto-delete');
  assert.equal(kids[2], fakes[0].trigger);
});

test('label without lifetimeInLabel holds only the checkbox and the text', () => {
  const ctx = setup();
  const kids = Array.from(ctx.nodes.label.childNodes);
  assert.equal(kids.length, 2);
  assert.equal(kids[0], ctx.nodes.toggle);
  assert.equal(kids[1].data, 'Auto-delete');
});

test('delay wrap and date wrap hold their text and inputs in order', () => {
  const ctx = setup();
  const { nodes } = ctx;
  const delayKids = Array.from(nodes.delayWrap.childNodes);
  assert.equal(delayKids.length, 3);
  assert.equal(delayKids[0].nodeType, 3);
  assert.equal(delayKids[0].data, 'Delete after');
  assert.equal(delayKids[1], nodes.amount);
  assert.equal(delayKids[2], nodes.unit.trigger);
  assert.deepEqual(Array.from(nodes.dateWrap.children), [nodes.date, nodes.calendar.wrap, nodes.time]);
});

test('select is called exactly twice, lifetime first then unit, with the configured lists', () => {
  const ctx = setup();
  assert.equal(ctx.log.selectConfigs.length, 2);
  assert.equal(ctx.log.selectConfigs[0].label, 'Auto-delete lifetime');
  assert.equal(ctx.log.selectConfigs[0].items, ITEMS);
  assert.equal(ctx.log.selectConfigs[1].label, 'Auto-delete custom unit');
  assert.equal(ctx.log.selectConfigs[1].items, UNITS);
  assert.equal(typeof ctx.log.selectConfigs[0].onOpen, 'function');
  assert.equal(typeof ctx.log.selectConfigs[1].onOpen, 'function');
});

test('inputs carry their types, limits, placeholders and aria labels', () => {
  const { nodes } = setup();
  assert.equal(nodes.toggle.type, 'checkbox');
  assert.equal(nodes.toggle.getAttribute('aria-label'), 'Auto-delete');
  const expected = [
    [nodes.amount, 5, null, 'Auto-delete custom amount'],
    [nodes.date, 10, 'DD/MM/YYYY', 'Auto-delete date as DD/MM/YYYY'],
    [nodes.time, 5, 'HH:MM', 'Auto-delete time, 24-hour clock']
  ];
  expected.forEach(([input, max, placeholder, label]) => {
    assert.equal(input.type, 'text');
    assert.equal(input.inputMode, 'numeric');
    assert.equal(input.maxLength, max);
    assert.equal(input.getAttribute('aria-label'), label);
    if (placeholder !== null) assert.equal(input.placeholder, placeholder);
  });
  assert.equal(nodes.status.getAttribute('role'), 'status');
});

test('configured class names and css land on the right elements', () => {
  const ctx = setup();
  const { win, root, nodes } = ctx;
  assert.equal(root.className, 'cfg-root');
  assert.equal(root.style.cssText, normalized(win, STYLES.root.css));
  assert.equal(nodes.label.style.cssText, normalized(win, STYLES.label));
  assert.equal(nodes.delayWrap.style.cssText, normalized(win, STYLES.delayWrap));
  assert.equal(nodes.dateWrap.style.cssText, normalized(win, STYLES.dateWrap));
  assert.equal(nodes.amount.style.cssText, normalized(win, STYLES.amount));
  assert.equal(nodes.date.style.cssText, normalized(win, STYLES.date));
  assert.equal(nodes.time.style.cssText, normalized(win, STYLES.time));
  assert.equal(nodes.preview.className, 'cfg-preview');
  assert.equal(nodes.preview.style.cssText, normalized(win, STYLES.preview.css));
  assert.equal(nodes.status.style.cssText, normalized(win, STYLES.status));
});

test('calendar gets the prefix, the open-calendar label and a trigger inside the date wrap', () => {
  const { nodes } = setup();
  assert.equal(nodes.calendar.wrap.className, 'zz-calendar-wrap');
  assert.equal(nodes.calendar.trigger.className, 'zz-calendar-trigger');
  assert.equal(nodes.calendar.trigger.getAttribute('aria-label'), 'Open calendar');
  assert.equal(nodes.calendar.panel.className, 'zz-calendar');
  assert.equal(nodes.dateWrap.contains(nodes.calendar.trigger), true);
});

test('every element the component creates goes through make', () => {
  const { root, log } = setup({ lifetimeInLabel: true });
  const own = Array.from(root.querySelectorAll('*')).filter((element) => {
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
    return !element.hasAttribute('data-fake-select');
  });
  assert.equal(own.length > 10, true);
  own.concat([root]).forEach((element) => {
    assert.equal(element.getAttribute('data-made'), 'yes', `${element.tagName}.${element.className} not from make`);
  });
  assert.equal(log.made.length >= own.length, true);
});

test('creating the controls renders nothing', () => {
  const ctx = setup();
  assert.equal(ctx.fakes[0].values.length, 0);
  assert.equal(ctx.fakes[0].disabledCalls.length, 0);
  assert.equal(ctx.log.notice.length, 0);
  assert.equal(ctx.log.describe.length, 0);
  assert.equal(ctx.log.onChange.length, 0);
  assert.equal(ctx.log.refresh, 0);
});

test('disabled flags follow enabled, choice and lock for every combination', () => {
  const statuses = [
    ['pending', true], ['uncertain', true], ['idle', false], ['', false], ['saved', false], ['failed', false], [undefined, false]
  ];
  [true, false].forEach((enabled) => {
    ['3600000', 'custom-delay', 'custom-date'].forEach((choice) => {
      statuses.forEach(([status, locked]) => {
        const ctx = setup({ state: baseState({ enabled, choice, status }) });
        ctx.controls.render(CONTEXT);
        const label = `enabled=${enabled} choice=${choice} status=${status}`;
        const lifetimeOff = locked || !enabled;
        const delayOff = lifetimeOff || choice !== 'custom-delay';
        const dateOff = lifetimeOff || choice !== 'custom-date';
        assert.equal(ctx.nodes.toggle.disabled, locked, `toggle ${label}`);
        assert.equal(ctx.fakes[0].disabledCalls.at(-1), lifetimeOff, `lifetime ${label}`);
        assert.equal(ctx.nodes.amount.disabled, delayOff, `amount ${label}`);
        assert.equal(ctx.fakes[1].disabledCalls.at(-1), delayOff, `unit ${label}`);
        assert.equal(ctx.nodes.date.disabled, dateOff, `date ${label}`);
        assert.equal(ctx.nodes.time.disabled, dateOff, `time ${label}`);
        assert.equal(ctx.nodes.calendar.trigger.disabled, dateOff, `calendar ${label}`);
      });
    });
  });
});

test('render writes values into the checkbox, selects and inputs', () => {
  const ctx = setup({
    state: baseState({ choice: 'custom-delay', amount: '12', unit: 'days', time: '08:30', day: '2026-10-01' })
  });
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.toggle.checked, true);
  assert.equal(ctx.fakes[0].values.at(-1), 'custom-delay');
  assert.equal(ctx.fakes[1].values.at(-1), 'days');
  assert.equal(ctx.nodes.amount.value, '12');
  assert.equal(ctx.nodes.time.value, '08:30');
  assert.equal(ctx.nodes.date.value, '01/10/2026');
});

test('date box shows the raw typed text when dayInput is set and the formatted day when it is null', () => {
  const ctx = setup({ state: dateState({ dayInput: '15/03/20', day: '' }) });
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.date.value, '15/03/20');
  ctx.holder.current.dayInput = null;
  ctx.holder.current.day = '2027-03-15';
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.date.value, '15/03/2027');
  ctx.holder.current.dayInput = '';
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.date.value, '');
});

test('render reads the object state() returns now, not the one it returned before', () => {
  const ctx = setup({ state: baseState({ enabled: false, amount: '1' }) });
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.toggle.checked, false);
  assert.equal(hidden(ctx.fakes[0].trigger), true);
  ctx.holder.current = baseState({ enabled: true, choice: 'custom-delay', amount: '77', status: 'pending' });
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.toggle.checked, true);
  assert.equal(ctx.nodes.toggle.disabled, true);
  assert.equal(ctx.nodes.amount.value, '77');
  assert.equal(shown(ctx.fakes[0].trigger, DISPLAY.lifetime), true);
  assert.equal(ctx.fakes[0].values.at(-1), 'custom-delay');
});

test('lifetime trigger, delay wrap and date wrap show only for the matching choice and restore their display', () => {
  const ctx = setup({ state: baseState({ enabled: false }) });
  const trigger = ctx.fakes[0].trigger;
  const states = [
    [{ enabled: false, choice: 'custom-delay' }, false, false, false],
    [{ enabled: true, choice: '3600000' }, true, false, false],
    [{ enabled: true, choice: 'custom-delay' }, true, true, false],
    [{ enabled: true, choice: 'custom-date' }, true, false, true],
    [{ enabled: true, choice: '86400000' }, true, false, false],
    [{ enabled: true, choice: 'custom-delay' }, true, true, false],
    [{ enabled: false, choice: 'custom-date' }, false, false, false],
    [{ enabled: true, choice: 'custom-date' }, true, false, true]
  ];
  states.forEach(([patch, lifetimeOn, delayOn, dateOn], index) => {
    Object.assign(ctx.holder.current, patch);
    ctx.controls.render(CONTEXT);
    const label = `step ${index} ${JSON.stringify(patch)}`;
    assert.equal(lifetimeOn ? shown(trigger, DISPLAY.lifetime) : hidden(trigger), true, `lifetime ${label}`);
    assert.equal(delayOn ? shown(ctx.nodes.delayWrap, DISPLAY.delayWrap) : hidden(ctx.nodes.delayWrap), true, `delay ${label}`);
    assert.equal(dateOn ? shown(ctx.nodes.dateWrap, DISPLAY.dateWrap) : hidden(ctx.nodes.dateWrap), true, `date ${label}`);
  });
});

test('preview shows the described deadline and its title when resolve gives a result', () => {
  const ctx = setup({ resolve: () => ({ expiresAt: 'T-42' }) });
  ctx.controls.render(CONTEXT);
  assert.equal(shown(ctx.nodes.preview), true);
  assert.equal(ctx.nodes.preview.textContent, 'ends T-42');
  assert.equal(ctx.nodes.preview.title, 'title T-42');
  assert.deepEqual(Array.from(ctx.log.describe), ['T-42']);
});

test('preview shows the lifetime problem with an empty title when resolve gives null', () => {
  const cases = [
    [baseState({ choice: '3600000' }), 'Pick an auto-delete lifetime.'],
    [baseState({ choice: 'custom-delay', unit: 'days' }), null],
    [dateState({ time: '25:00' }), 'Pick a date between 1 minute and 3650 days from now.'],
    [dateState({ day: '', time: '10:00' }), 'Pick a date as DD/MM/YYYY and a time as HH:MM.']
  ];
  cases.forEach(([state, literal]) => {
    const ctx = setup({ state, resolve: () => null });
    ctx.controls.render(CONTEXT);
    const expected = literal || ctx.win.ISA_NOTE_CONTROLS.lifetimeProblem(state);
    assert.equal(expected.length > 0, true);
    assert.equal(ctx.nodes.preview.textContent, expected);
    assert.equal(ctx.nodes.preview.title, '');
    assert.equal(ctx.log.describe.length, 0);
    assert.equal(shown(ctx.nodes.preview), true);
  });
});

test('preview is hidden, empty and loses its title when auto-delete is switched off', () => {
  const ctx = setup();
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.preview.title, 'title EXPIRES');
  ctx.holder.current.enabled = false;
  ctx.controls.render(CONTEXT);
  assert.equal(hidden(ctx.nodes.preview), true);
  assert.equal(ctx.nodes.preview.textContent, '');
  assert.equal(ctx.nodes.preview.title, '');
  ctx.holder.current.enabled = true;
  ctx.controls.render(CONTEXT);
  assert.equal(shown(ctx.nodes.preview), true);
  assert.equal(ctx.nodes.preview.textContent, 'ends EXPIRES');
});

test('a stale title does not survive a switch from a resolved preview to a problem', () => {
  const ctx = setup();
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.preview.title, 'title EXPIRES');
  ctx.control.resolve = () => null;
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.preview.title, '');
  assert.equal(ctx.nodes.preview.textContent, 'Pick an auto-delete lifetime.');
});

function validity(ctx) {
  const mark = input => [input.getAttribute('aria-invalid'), input.style.borderColor];
  return { date: mark(ctx.nodes.date), time: mark(ctx.nodes.time), amount: mark(ctx.nodes.amount) };
}

const VALID = ['false', FIELD_BORDER];
const INVALID = ['true', ACCENT];

test('custom-date: valid day, valid time, in range marks nothing', () => {
  const ctx = setup({ state: dateState() });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: VALID });
});

test('custom-date: valid day with an invalid time marks only the time, even when out of range', () => {
  const ctx = setup({ state: dateState({ time: '25:00' }), resolve: state => (state.time === '23:59' ? { expiresAt: 'late' } : null) });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: INVALID, amount: VALID });
});

test('custom-date: a day that no hour can save is marked before a usable time is typed, and the time is not', () => {
  for (const time of ['', '25:00', '7']) {
    const ctx = setup({ state: dateState({ time }), resolve: () => null });
    ctx.controls.render(CONTEXT);
    assert.deepEqual(validity(ctx), { date: INVALID, time: time === '' ? VALID : INVALID, amount: VALID }, time);
  }
  const probed = [];
  const ctx = setup({ state: dateState({ time: '' }), resolve: (state) => { probed.push(state.time); return null; } });
  ctx.controls.render(CONTEXT);
  assert.equal(probed.includes('00:00') && probed.includes('23:59'), true);
  assert.equal(ctx.holder.current.time, '', 'probing never writes the state');
});

test('custom-date: a day no hour can save marks only the date, even with a valid time', () => {
  const ctx = setup({ state: dateState(), resolve: () => null });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: INVALID, time: VALID, amount: VALID });
  assert.equal(ctx.nodes.preview.textContent, 'Pick a date between 1 minute and 3650 days from now.');
});

test('custom-date: a day whose later hours save but whose chosen time does not marks only the time', () => {
  const ctx = setup({ state: dateState({ time: '10:00' }), resolve: state => (state.time >= '12:00' ? { expiresAt: 'x' } : null) });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: INVALID, amount: VALID });
  assert.equal(ctx.nodes.preview.textContent, 'Pick a time at least 1 minute from now.');
});

test('custom-date: a day whose early hours save but whose chosen time does not keeps the range message', () => {
  const ctx = setup({ state: dateState({ time: '20:00' }), resolve: state => (state.time <= '12:00' ? { expiresAt: 'x' } : null) });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: INVALID, amount: VALID });
  assert.equal(ctx.nodes.preview.textContent, 'Pick a date between 1 minute and 3650 days from now.');
});

test('custom-date: a missing day leaves the time valid and an empty date box unmarked', () => {
  const ctx = setup({ state: dateState({ day: '', dayInput: null }), resolve: () => null });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: VALID });
});

test('custom-date: a typed but unparseable day marks the date and leaves a valid time alone', () => {
  const ctx = setup({ state: dateState({ day: '', dayInput: '31/02/2027' }), resolve: () => null });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: INVALID, time: VALID, amount: VALID });
});

test('custom-date: an empty time is never marked and does not mark a valid day', () => {
  const ctx = setup({ state: dateState({ time: '' }), resolve: state => (state.time === '00:00' ? { expiresAt: 'early' } : null) });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: VALID });
});

test('custom-date: both fields wrong are both marked', () => {
  const ctx = setup({ state: dateState({ day: '', dayInput: '3', time: '99:99' }), resolve: () => null });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: INVALID, time: INVALID, amount: VALID });
});

test('custom-delay: a non-empty amount is marked when resolve is null and valid otherwise', () => {
  const ctx = setup({ state: baseState({ choice: 'custom-delay', amount: '0' }), resolve: () => null });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: INVALID });
  ctx.holder.current.amount = '';
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: VALID });
  ctx.control.resolve = () => ({ expiresAt: 'x' });
  ctx.holder.current.amount = '5';
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: VALID });
});

test('a preset choice never marks any field even with garbage in them and resolve null', () => {
  const ctx = setup({
    state: baseState({ choice: '3600000', amount: '0', dayInput: '99', time: '99:99', day: '' }),
    resolve: () => null
  });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: VALID });
});

test('validity is computed even when auto-delete is off, and a marked field returns to the field border', () => {
  const ctx = setup({ state: dateState({ enabled: false }), resolve: () => null });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: INVALID, time: VALID, amount: VALID });
  ctx.control.resolve = () => ({ expiresAt: 'x' });
  ctx.controls.render(CONTEXT);
  assert.deepEqual(validity(ctx), { date: VALID, time: VALID, amount: VALID });
});

test('status line shows the notice text, plain colour for a note and accent for an error', () => {
  const ctx = setup({ notice: () => ({ text: 'Saved fine', error: false }) });
  ctx.controls.render(CONTEXT);
  assert.equal(shown(ctx.nodes.status), true);
  assert.equal(ctx.nodes.status.textContent, 'Saved fine');
  assert.equal(ctx.nodes.status.style.color, '');
  ctx.control.notice = () => ({ text: 'Broke', error: true });
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.status.textContent, 'Broke');
  assert.equal(ctx.nodes.status.style.color, ACCENT);
  ctx.control.notice = () => ({ text: 'Fine again', error: false });
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.nodes.status.style.color, '');
});

test('status line is hidden and emptied when notice returns null', () => {
  const ctx = setup({ notice: () => ({ text: 'Broke', error: true }) });
  ctx.controls.render(CONTEXT);
  ctx.control.notice = () => null;
  ctx.controls.render(CONTEXT);
  assert.equal(hidden(ctx.nodes.status), true);
  assert.equal(ctx.nodes.status.textContent, '');
  assert.equal(ctx.nodes.status.style.color, '');
});

test('notice receives the current state object and exactly the context passed to render', () => {
  const ctx = setup();
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.log.notice.length, 1);
  assert.equal(ctx.log.notice[0].ctx, CONTEXT);
  assert.equal(ctx.log.notice[0].state, ctx.holder.current);
  const second = baseState({ enabled: false });
  const other = { other: 'context' };
  ctx.holder.current = second;
  ctx.controls.render(other);
  assert.equal(ctx.log.notice.at(-1).ctx, other);
  assert.equal(ctx.log.notice.at(-1).state, second);
});

test('checkbox change writes enabled, clears the error and calls onChange once without rendering', () => {
  const ctx = setup({ state: baseState({ enabled: false, error: 'old' }) });
  ctx.nodes.toggle.checked = true;
  fire(ctx.win, ctx.nodes.toggle, 'change');
  assert.equal(ctx.holder.current.enabled, true);
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, 1);
  assert.equal(JSON.parse(ctx.log.onChange[0]).enabled, true);
  assert.equal(ctx.log.refresh, 0);
  assert.equal(ctx.fakes[0].values.length, 0);
  assert.equal(ctx.log.notice.length, 0);
  ctx.nodes.toggle.checked = false;
  fire(ctx.win, ctx.nodes.toggle, 'change');
  assert.equal(ctx.holder.current.enabled, false);
  assert.equal(ctx.log.onChange.length, 2);
});

test('lifetime and unit dropdown commits write choice and unit, clear the error and call onChange once each', () => {
  const ctx = setup({ state: baseState({ error: 'old' }) });
  ctx.fakes[0].config.onChange('custom-delay');
  assert.equal(ctx.holder.current.choice, 'custom-delay');
  assert.equal(ctx.holder.current.unit, 'hours');
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, 1);
  ctx.holder.current.error = 'again';
  ctx.fakes[1].config.onChange('days');
  assert.equal(ctx.holder.current.unit, 'days');
  assert.equal(ctx.holder.current.choice, 'custom-delay');
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, 2);
  assert.equal(ctx.log.refresh, 0);
});

test('while locked, checkbox and dropdowns call refresh and leave the state and onChange alone', () => {
  ['pending', 'uncertain'].forEach((status) => {
    const ctx = setup({ state: baseState({ status, error: 'keep', enabled: false }) });
    const before = JSON.stringify(ctx.holder.current);
    ctx.nodes.toggle.checked = true;
    fire(ctx.win, ctx.nodes.toggle, 'change');
    assert.equal(ctx.log.refresh, 1, status);
    ctx.fakes[0].config.onChange('custom-date');
    assert.equal(ctx.log.refresh, 2, status);
    ctx.fakes[1].config.onChange('days');
    assert.equal(ctx.log.refresh, 3, status);
    assert.equal(JSON.stringify(ctx.holder.current), before, status);
    assert.equal(ctx.log.onChange.length, 0, status);
  });
});

test('an unknown status does not lock the controls', () => {
  const ctx = setup({ state: baseState({ status: 'failed', enabled: false }) });
  ctx.nodes.toggle.checked = true;
  fire(ctx.win, ctx.nodes.toggle, 'change');
  ctx.fakes[0].config.onChange('86400000');
  assert.equal(ctx.holder.current.enabled, true);
  assert.equal(ctx.holder.current.choice, '86400000');
  assert.equal(ctx.log.refresh, 0);
  assert.equal(ctx.log.onChange.length, 2);
});

test('typing in the amount box masks to digits, caps at five, writes amount and clears the error', () => {
  const ctx = setup({ state: baseState({ choice: 'custom-delay', error: 'old' }) });
  typeInto(ctx.win, ctx.nodes.amount, '1a2b3x4y5z6');
  assert.equal(ctx.holder.current.amount, '12345');
  assert.equal(ctx.holder.current.error, '');
  assert.equal(JSON.parse(ctx.log.onChange[0]).amount, '12345');
  assert.equal(ctx.log.onChange.length, 1);
  assert.equal(ctx.fakes[0].values.length, 0);
});

test('typing a full date writes dayInput and the parsed day', () => {
  const ctx = setup({ state: dateState({ day: '', time: '', error: 'old' }) });
  typeInto(ctx.win, ctx.nodes.date, '15/03/2027');
  assert.equal(ctx.holder.current.dayInput, '15/03/2027');
  assert.equal(ctx.holder.current.day, '2027-03-15');
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, 1);
  assert.equal(JSON.parse(ctx.log.onChange[0]).day, '2027-03-15');
});

test('editing a complete date into an incomplete one clears day but keeps the typed text', () => {
  const ctx = setup({ state: dateState({ day: '', time: '' }) });
  typeInto(ctx.win, ctx.nodes.date, '15/03/2027');
  typeInto(ctx.win, ctx.nodes.date, '15/03/202');
  assert.equal(ctx.holder.current.dayInput, '15/03/202');
  assert.equal(ctx.holder.current.day, '');
  assert.equal(ctx.log.onChange.length, 2);
});

test('typing a calendar-impossible date keeps the text and leaves day empty', () => {
  const ctx = setup({ state: dateState({ day: '2026-10-01', time: '' }) });
  typeInto(ctx.win, ctx.nodes.date, '31/02/2027');
  assert.equal(ctx.holder.current.dayInput, '31/02/2027');
  assert.equal(ctx.holder.current.day, '');
});

test('typing in the time box masks through the clock mask and writes time', () => {
  const ctx = setup({ state: dateState({ time: '', error: 'old' }) });
  typeInto(ctx.win, ctx.nodes.time, '2230');
  assert.equal(ctx.holder.current.time, '22:30');
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, 1);
  typeInto(ctx.win, ctx.nodes.time, 'ab');
  assert.equal(ctx.holder.current.time, '');
  assert.equal(ctx.log.onChange.length, 2);
});

test('while locked, typing in any field writes nothing and does not call onChange', () => {
  ['pending', 'uncertain'].forEach((status) => {
    const ctx = setup({
      state: dateState({ status, amount: '7', day: '2026-10-01', dayInput: null, time: '10:00', error: 'keep' })
    });
    const before = JSON.stringify(ctx.holder.current);
    typeInto(ctx.win, ctx.nodes.amount, '99');
    typeInto(ctx.win, ctx.nodes.date, '15/03/2027');
    typeInto(ctx.win, ctx.nodes.time, '2230');
    assert.equal(JSON.stringify(ctx.holder.current), before, status);
    assert.equal(ctx.log.onChange.length, 0, status);
  });
});

test('blur pads a time edited from 16:05 down to 6:05', () => {
  const ctx = setup({ state: dateState({ time: '', error: 'old' }) });
  typeInto(ctx.win, ctx.nodes.time, '16:05');
  assert.equal(ctx.holder.current.time, '16:05');
  typeInto(ctx.win, ctx.nodes.time, '6:05');
  assert.equal(ctx.holder.current.time, '6:05');
  ctx.holder.current.error = 'again';
  const calls = ctx.log.onChange.length;
  fire(ctx.win, ctx.nodes.time, 'blur');
  assert.equal(ctx.holder.current.time, '06:05');
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, calls + 1);
});

test('blur leaves an already canonical time and an unparseable time alone', () => {
  const ctx = setup({ state: dateState({ time: '16:05' }) });
  ctx.controls.render(CONTEXT);
  fire(ctx.win, ctx.nodes.time, 'blur');
  assert.equal(ctx.holder.current.time, '16:05');
  ctx.holder.current.time = '25:61';
  ctx.holder.current.error = 'keep';
  ctx.controls.render(CONTEXT);
  fire(ctx.win, ctx.nodes.time, 'blur');
  assert.equal(ctx.holder.current.time, '25:61');
  assert.equal(ctx.holder.current.error, 'keep');
  assert.equal(ctx.log.onChange.length, 0);
});

test('blur while locked does not pad the time and does not call onChange', () => {
  const ctx = setup({ state: dateState({ time: '6:05', status: 'pending', error: 'keep' }) });
  ctx.controls.render(CONTEXT);
  fire(ctx.win, ctx.nodes.time, 'blur');
  assert.equal(ctx.holder.current.time, '6:05');
  assert.equal(ctx.holder.current.error, 'keep');
  assert.equal(ctx.log.onChange.length, 0);
});

test('events act on the object state() returns at event time, not an earlier one', () => {
  const first = baseState({ choice: 'custom-delay', amount: '1', time: '6:05' });
  const ctx = setup({ state: first });
  ctx.controls.render(CONTEXT);
  const second = baseState({ choice: 'custom-delay', amount: '2', time: '6:05', enabled: false });
  ctx.holder.current = second;
  typeInto(ctx.win, ctx.nodes.amount, '55');
  assert.equal(second.amount, '55');
  assert.equal(first.amount, '1');
  ctx.nodes.toggle.checked = true;
  fire(ctx.win, ctx.nodes.toggle, 'change');
  assert.equal(second.enabled, true);
  assert.equal(first.enabled, true);
  ctx.holder.current = baseState({ enabled: false });
  ctx.fakes[0].config.onChange('custom-date');
  assert.equal(ctx.holder.current.choice, 'custom-date');
  assert.equal(first.choice, 'custom-delay');
  assert.equal(second.choice, 'custom-delay');
  ctx.holder.current = second;
  fire(ctx.win, ctx.nodes.time, 'blur');
  assert.equal(second.time, '06:05');
  assert.equal(first.time, '6:05');
});

test('lock is judged on the state at event time in both directions', () => {
  const free = baseState({ amount: '1' });
  const locked = baseState({ amount: '2', status: 'pending' });
  const ctx = setup({ state: free });
  ctx.controls.render(CONTEXT);
  ctx.holder.current = locked;
  typeInto(ctx.win, ctx.nodes.amount, '9');
  ctx.fakes[0].config.onChange('custom-delay');
  assert.equal(locked.amount, '2');
  assert.equal(locked.choice, '3600000');
  assert.equal(ctx.log.onChange.length, 0);
  assert.equal(ctx.log.refresh, 1);
  ctx.holder.current = free;
  ctx.controls.render(CONTEXT);
  ctx.holder.current = baseState({ amount: '3' });
  typeInto(ctx.win, ctx.nodes.amount, '8');
  assert.equal(ctx.holder.current.amount, '8');
  assert.equal(ctx.log.onChange.length, 1);
});

test('picking a day in the calendar writes day, resets dayInput, clears the error and focuses the date box', () => {
  const ctx = setup({ state: dateState({ day: '', dayInput: '15/0', time: '', error: 'old' }) });
  ctx.controls.render(CONTEXT);
  openCalendar(ctx);
  dayButton(ctx, '2026-09-20').click();
  assert.equal(ctx.holder.current.day, '2026-09-20');
  assert.equal(ctx.holder.current.dayInput, null);
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, 1);
  assert.equal(JSON.parse(ctx.log.onChange[0]).dayInput, null);
  assert.equal(ctx.win.document.activeElement, ctx.nodes.date);
  assert.equal(ctx.nodes.calendar.isOpen(), false);
});

test('the Today button picks the day of the configured clock', () => {
  const clock = () => Date.parse('2030-05-17T12:00:00.000Z');
  const ctx = setup({ state: dateState({ day: '' }), clock });
  ctx.controls.render(CONTEXT);
  openCalendar(ctx);
  ctx.win.document.querySelector('.zz-calendar-today').click();
  assert.equal(ctx.holder.current.day, '2030-05-17');
  assert.equal(ctx.holder.current.dayInput, null);
  assert.equal(ctx.log.onChange.length, 1);
});

test('the Clear button picks an empty day and resets dayInput', () => {
  const ctx = setup({ state: dateState({ day: '2026-10-01', dayInput: '01/10/2026' }) });
  ctx.controls.render(CONTEXT);
  openCalendar(ctx);
  ctx.win.document.querySelector('.zz-calendar-clear').click();
  assert.equal(ctx.holder.current.day, '');
  assert.equal(ctx.holder.current.dayInput, null);
  assert.equal(ctx.log.onChange.length, 1);
  assert.equal(ctx.win.document.activeElement, ctx.nodes.date);
});

test('a calendar pick while locked writes nothing and does not call onChange', () => {
  ['pending', 'uncertain'].forEach((status) => {
    const ctx = setup({ state: dateState({ day: '2026-10-01', dayInput: '01/10', error: 'keep' }) });
    ctx.controls.render(CONTEXT);
    openCalendar(ctx);
    ctx.holder.current = dateState({ status, day: '2026-10-01', dayInput: '01/10', error: 'keep' });
    dayButton(ctx, '2026-10-20').click();
    assert.equal(ctx.holder.current.day, '2026-10-01', status);
    assert.equal(ctx.holder.current.dayInput, '01/10', status);
    assert.equal(ctx.holder.current.error, 'keep', status);
    assert.equal(ctx.log.onChange.length, 0, status);
  });
});

test('a calendar pick writes to the state returned at pick time', () => {
  const first = dateState({ day: '' });
  const ctx = setup({ state: first });
  ctx.controls.render(CONTEXT);
  openCalendar(ctx);
  const second = dateState({ day: '' });
  ctx.holder.current = second;
  dayButton(ctx, '2026-09-21').click();
  assert.equal(second.day, '2026-09-21');
  assert.equal(first.day, '');
});

test('render passes the day to the calendar so the picked day shows as pressed', () => {
  const ctx = setup({ state: dateState({ day: '2026-09-14' }) });
  ctx.controls.render(CONTEXT);
  openCalendar(ctx);
  assert.equal(dayButton(ctx, '2026-09-14').getAttribute('aria-pressed'), 'true');
  assert.equal(dayButton(ctx, '2026-09-15').getAttribute('aria-pressed'), 'false');
});

test('render closes an open calendar when the choice leaves custom-date, auto-delete turns off or the form locks', () => {
  const patches = [{ choice: '3600000' }, { enabled: false }, { status: 'pending' }, { status: 'uncertain' }];
  patches.forEach((patch) => {
    const ctx = setup({ state: dateState() });
    ctx.controls.render(CONTEXT);
    openCalendar(ctx);
    ctx.controls.render(CONTEXT);
    assert.equal(ctx.nodes.calendar.isOpen(), true, 'an unchanged render keeps it open');
    Object.assign(ctx.holder.current, patch);
    ctx.controls.render(CONTEXT);
    assert.equal(ctx.nodes.calendar.isOpen(), false, JSON.stringify(patch));
    assert.equal(ctx.nodes.calendar.panel.hidden, true, JSON.stringify(patch));
  });
});

test('opening either dropdown list closes the open calendar', () => {
  [0, 1].forEach((index) => {
    const ctx = setup({ state: dateState() });
    ctx.controls.render(CONTEXT);
    openCalendar(ctx);
    ctx.fakes[index].config.onOpen();
    assert.equal(ctx.nodes.calendar.isOpen(), false, `select ${index}`);
  });
});

test('with real selects, opening a dropdown closes the calendar and opening the calendar closes the dropdown', () => {
  const ctx = setup({ state: dateState({ choice: 'custom-date' }), realSelect: true });
  const { win, nodes } = ctx;
  ctx.controls.render(CONTEXT);
  openCalendar(ctx);
  nodes.choice.trigger.click();
  assert.equal(nodes.choice.isOpen(), true);
  assert.equal(nodes.calendar.isOpen(), false);
  assert.equal(ctx.controls.popupOpen(), true);
  nodes.calendar.trigger.click();
  assert.equal(nodes.calendar.isOpen(), true);
  assert.equal(nodes.choice.isOpen(), false);
  assert.equal(win.ISA_NOTE_CONTROLS.openSelectLayer(), null);
  ctx.holder.current.choice = 'custom-delay';
  ctx.controls.render(CONTEXT);
  nodes.unit.trigger.click();
  assert.equal(nodes.unit.isOpen(), true);
  assert.equal(nodes.calendar.isOpen(), false);
  assert.equal(nodes.calendar.panel.hidden, true);
});

test('popupOpen is true while either dropdown or the calendar is open and false otherwise', () => {
  const ctx = setup({ state: dateState() });
  ctx.controls.render(CONTEXT);
  assert.equal(ctx.controls.popupOpen(), false);
  ctx.fakes[0].opened = true;
  assert.equal(ctx.controls.popupOpen(), true);
  ctx.fakes[0].opened = false;
  ctx.fakes[1].opened = true;
  assert.equal(ctx.controls.popupOpen(), true);
  ctx.fakes[1].opened = false;
  assert.equal(ctx.controls.popupOpen(), false);
  openCalendar(ctx);
  assert.equal(ctx.controls.popupOpen(), true);
  ctx.nodes.calendar.close();
  assert.equal(ctx.controls.popupOpen(), false);
});

test('a real dropdown commit writes the choice once, and a commit after the form locked only asks for a refresh', () => {
  const ctx = setup({ state: baseState({ error: 'old' }), realSelect: true });
  const { win, nodes } = ctx;
  ctx.controls.render(CONTEXT);
  nodes.choice.trigger.click();
  win.ISA_NOTE_CONTROLS.openSelectLayer().querySelector('[data-value="86400000"]').click();
  assert.equal(ctx.holder.current.choice, '86400000');
  assert.equal(ctx.holder.current.error, '');
  assert.equal(ctx.log.onChange.length, 1);
  assert.equal(ctx.controls.popupOpen(), false);
  nodes.choice.trigger.click();
  const layer = win.ISA_NOTE_CONTROLS.openSelectLayer();
  ctx.holder.current = baseState({ status: 'pending', choice: '86400000' });
  layer.querySelector('[data-value="custom-delay"]').click();
  assert.equal(ctx.holder.current.choice, '86400000');
  assert.equal(ctx.log.onChange.length, 1);
  assert.equal(ctx.log.refresh, 1);
});

test('a display set from outside while a row is shown comes back after the row is hidden and shown again', () => {
  const ctx = setup({ state: baseState({ enabled: true, choice: 'custom-delay' }) });
  ctx.controls.render();
  ctx.nodes.delayWrap.style.display = 'table';
  ctx.holder.current.choice = 'custom-date';
  ctx.controls.render();
  assert.equal(ctx.nodes.delayWrap.style.display, 'none');
  assert.equal(ctx.nodes.delayWrap.hidden, true);
  ctx.holder.current.choice = 'custom-delay';
  ctx.controls.render();
  assert.equal(ctx.nodes.delayWrap.style.display, 'table');
  assert.equal(ctx.nodes.delayWrap.hidden, false);
  assert.equal(ctx.nodes.delayWrap.hasAttribute('data-isa-display'), false, 'nothing is written into the DOM to remember it');
});
