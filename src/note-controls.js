'use strict';

(function installNoteControls(global) {
  let openMenu = null;

  function closeSelect() {
    const menu = openMenu;
    if (!menu) return;
    openMenu = null;
    menu.layer.remove();
    menu.control.trigger.setAttribute('aria-expanded', 'false');
    menu.control.trigger.removeAttribute('aria-activedescendant');
    global.removeEventListener('scroll', menu.reposition, true);
    global.removeEventListener('resize', menu.reposition);
    global.document.removeEventListener('pointerdown', menu.onOutside, true);
  }

  function openSelectLayer() {
    return openMenu ? openMenu.layer : null;
  }

  function selectOwnedBy(root) {
    return Boolean(openMenu && root && root.contains(openMenu.control.trigger));
  }

  function selectTriggerLost() {
    const menu = openMenu;
    if (!menu) return false;
    if (menu.control.trigger.isConnected && menu.layer.isConnected) return false;
    closeSelect();
    return true;
  }

  function placeMenu(control, layer) {
    if (selectTriggerLost()) return;
    const gap = control.config.gap;
    const rect = control.trigger.getBoundingClientRect();
    const width = Math.max(layer.offsetWidth, rect.width);
    const height = layer.offsetHeight;
    const room = global.innerHeight - rect.bottom;
    const above = room < height + gap && rect.top > room;
    const left = Math.max(4, Math.min(rect.left, global.innerWidth - width - 4));
    const top = above ? Math.max(4, rect.top - height - gap) : rect.bottom + gap;
    layer.style.left = `${Math.round(left)}px`;
    layer.style.top = `${Math.round(top)}px`;
    layer.style.minWidth = `${Math.round(rect.width)}px`;
  }

  function markActive(control, index) {
    const menu = openMenu;
    if (!menu || menu.control !== control) return;
    menu.activeIndex = index;
    menu.rows.forEach((row, position) => {
      const active = position === index;
      const colors = control.config.rowColors(active);
      row.setAttribute('aria-selected', active ? 'true' : 'false');
      row.style.background = colors.background;
      row.style.color = colors.color;
      if (active) {
        control.trigger.setAttribute('aria-activedescendant', row.id);
        if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function commitMenu(control, index) {
    const item = control.items[index];
    closeSelect();
    control.trigger.focus();
    if (!item || item.value === control.value) return;
    control.setValue(item.value);
    control.config.onCommit(item.value);
  }

  function openSelect(control) {
    if (control.disabled) return;
    closeSelect();
    const config = control.config;
    if (typeof config.onOpen === 'function') config.onOpen();
    const layer = config.make('div');
    layer.className = config.layerClass;
    layer.id = control.listboxId;
    layer.setAttribute('role', 'listbox');
    layer.setAttribute('aria-label', control.label);
    layer.style.cssText = config.layerCss;
    config.styleLayer(layer);
    const rows = control.items.map((item, index) => {
      const row = config.make('div');
      row.id = `${control.listboxId}-option-${index}`;
      row.setAttribute('role', 'option');
      row.dataset.value = item.value;
      row.textContent = item.label;
      row.style.cssText = 'padding:2px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;';
      row.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      row.addEventListener('pointerenter', () => markActive(control, index));
      row.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitMenu(control, index);
      });
      layer.append(row);
      return row;
    });
    ['pointerup', 'mousedown', 'mouseup', 'touchstart'].forEach((type) => {
      layer.addEventListener(type, event => event.stopPropagation());
    });
    const reposition = () => placeMenu(control, layer);
    const onOutside = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (path.includes(layer) || path.includes(control.trigger)) return;
      closeSelect();
    };
    global.document.body.append(layer);
    openMenu = { control, layer, rows, activeIndex: -1, reposition, onOutside, search: '', searchAt: 0 };
    control.trigger.setAttribute('aria-expanded', 'true');
    placeMenu(control, layer);
    global.addEventListener('scroll', reposition, true);
    global.addEventListener('resize', reposition);
    global.document.addEventListener('pointerdown', onOutside, true);
    const selected = control.items.findIndex(item => item.value === control.value);
    markActive(control, selected < 0 ? 0 : selected);
  }

  function stepMenu(control, delta) {
    const menu = openMenu;
    if (!menu || menu.control !== control) return;
    const last = control.items.length - 1;
    markActive(control, Math.max(0, Math.min(last, menu.activeIndex + delta)));
  }

  function typeaheadMenu(control, key) {
    const menu = openMenu;
    if (!menu || menu.control !== control) return;
    const now = Date.now();
    menu.search = now - menu.searchAt > 500 ? key.toLowerCase() : menu.search + key.toLowerCase();
    menu.searchAt = now;
    const found = control.items.findIndex(item => item.label.toLowerCase().startsWith(menu.search));
    if (found >= 0) markActive(control, found);
  }

  function createSelect(config) {
    const trigger = config.make('div');
    const valueNode = config.make('span');
    const caret = config.make('span');
    const control = {
      config,
      label: config.label,
      items: config.items,
      trigger,
      value: '',
      disabled: false,
      listboxId: config.listboxId
    };
    if (config.triggerClass) trigger.className = config.triggerClass;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', control.listboxId);
    trigger.setAttribute('aria-label', control.label);
    trigger.tabIndex = 0;
    trigger.style.cssText = config.triggerCss;
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    caret.style.opacity = config.caretOpacity;
    trigger.append(valueNode, caret);
    control.setValue = (value) => {
      const item = control.items.find(entry => entry.value === value);
      if (!item) return false;
      control.value = item.value;
      valueNode.textContent = item.label;
      return true;
    };
    control.setDisabled = (disabled) => {
      control.disabled = disabled === true;
      trigger.setAttribute('aria-disabled', control.disabled ? 'true' : 'false');
      trigger.tabIndex = control.disabled ? -1 : 0;
      config.styleDisabled(trigger, control.disabled);
      if (control.disabled && control.isOpen()) closeSelect();
    };
    control.isOpen = () => Boolean(openMenu && openMenu.control === control);
    control.open = () => openSelect(control);
    trigger.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (control.disabled) return;
      if (control.isOpen()) closeSelect();
      else openSelect(control);
      trigger.focus();
    });
    trigger.addEventListener('keydown', (event) => {
      if (control.disabled) return;
      const open = control.isOpen();
      const key = event.key;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(key)) {
        handled();
        return openSelect(control);
      }
      if (!open) return;
      if (key === 'ArrowDown') { handled(); return stepMenu(control, 1); }
      if (key === 'ArrowUp') { handled(); return stepMenu(control, -1); }
      if (key === 'Home') { handled(); return markActive(control, 0); }
      if (key === 'End') { handled(); return markActive(control, control.items.length - 1); }
      if (key === 'Escape') { handled(); return closeSelect(); }
      if (key === 'Tab') return closeSelect();
      if (key === 'Enter' || key === ' ') {
        handled();
        return commitMenu(control, openMenu.activeIndex);
      }
      if (key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        handled();
        return typeaheadMenu(control, key);
      }
    });
    trigger.addEventListener('blur', () => {
      if (control.isOpen()) closeSelect();
    });
    control.setValue(control.items[0] ? control.items[0].value : '');
    return control;
  }

  const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function localMinute(day, time) {
    const clock = global.ISA_FIELDS.clockParse(time);
    return DAY_PATTERN.test(String(day ?? '')) && clock ? `${day}T${clock}` : null;
  }

  function lifetime(fields) {
    const notes = global.ISA_TEMPORARY_NOTES;
    if (fields.choice === 'custom-date') {
      const local = localMinute(fields.day, fields.time);
      const expiresAt = local === null ? null : notes.localMinuteToUtcIso(local);
      return expiresAt ? { mode: 'absolute', expiresAt } : null;
    }
    const delayMs = fields.choice === 'custom-delay'
      ? notes.delayFromUnits(fields.amount, fields.unit)
      : notes.normalizeDelayMs(fields.choice);
    return delayMs === null ? null : { mode: 'relative', delayMs };
  }

  function delayProblem(unit) {
    const notes = global.ISA_TEMPORARY_NOTES;
    const size = notes?.delayUnits?.[unit];
    const most = Math.floor(notes?.maxLifetimeMs / size);
    return most >= 1 ? `Enter 1 to ${most} ${unit}.` : 'Enter a whole number.';
  }

  function lifetimeProblem(fields) {
    if (fields.choice === 'custom-delay') return delayProblem(fields.unit);
    if (fields.choice !== 'custom-date') return 'Pick an auto-delete lifetime.';
    const local = localMinute(fields.day, fields.time);
    if (!local && DAY_PATTERN.test(String(fields.day ?? ''))) return global.ISA_FIELDS.CLOCK_ERROR;
    if (!local) return 'Pick a date as DD/MM/YYYY and a time as HH:MM.';
    if (global.ISA_TEMPORARY_NOTES?.localMinuteToUtcIso?.(local) === null) {
      return 'That local time does not exist on this date. Pick another time.';
    }
    return RANGE_PROBLEM;
  }

  const RANGE_PROBLEM = 'Pick a date between 1 minute and 3650 days from now.';
  const TOO_SOON_PROBLEM = 'Pick a time at least 1 minute from now.';

  const UNCERTAIN_SAVE = 'This note may already be saved. Copy your text, refresh the page and check before saving again.';

  const ACCENT = 'var(--isa-block)';

  function isLocked(state) {
    return state.status === 'pending' || state.status === 'uncertain';
  }

  const shownDisplay = new WeakMap();

  function setShown(element, shown, display) {
    const now = element.style.display;
    if (now && now !== 'none') shownDisplay.set(element, now);
    element.hidden = !shown;
    element.style.display = shown ? shownDisplay.get(element) || display : 'none';
  }

  function textInput(make, { maxLength, label, css, placeholder }) {
    const input = make('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = maxLength;
    if (placeholder) input.placeholder = placeholder;
    input.style.cssText = css;
    input.setAttribute('aria-label', label);
    return input;
  }

  function markValidity(element, valid, border) {
    const invalid = !valid && String(element.value ?? '') !== '';
    element.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    element.style.borderColor = invalid ? ACCENT : border;
  }

  function createLifetimeControls(config) {
    const fields = global.ISA_FIELDS;
    const { make, styles } = config;
    const current = config.state;
    const root = make('div');
    if (styles.root.className) root.className = styles.root.className;
    root.style.cssText = styles.root.css;
    const label = make('label');
    label.style.cssText = styles.label;
    const toggle = make('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('aria-label', 'Auto-delete');

    const change = write => (value) => {
      const state = current();
      if (isLocked(state)) return config.refresh();
      write(state, value);
      state.error = '';
      config.onChange();
    };
    const typed = write => (value) => {
      const state = current();
      if (isLocked(state)) return;
      write(state, value);
      state.error = '';
      config.onChange();
    };

    const choice = config.select({ label: 'Auto-delete lifetime', items: config.items,
      onOpen: () => calendar.close(), onChange: change((state, value) => { state.choice = value; }) });
    label.append(toggle, 'Auto-delete');
    if (config.lifetimeInLabel) label.append(choice.trigger);
    const delayWrap = make('div');
    delayWrap.style.cssText = styles.delayWrap;
    const amount = textInput(make, { maxLength: 5, label: 'Auto-delete custom amount', css: styles.amount });
    const unit = config.select({ label: 'Auto-delete custom unit', items: config.units,
      onOpen: () => calendar.close(), onChange: change((state, value) => { state.unit = value; }) });
    delayWrap.append('Delete after', amount, unit.trigger);
    const dateWrap = make('div');
    dateWrap.style.cssText = styles.dateWrap;
    const date = textInput(make, { maxLength: 10, label: 'Auto-delete date as DD/MM/YYYY', css: styles.date, placeholder: 'DD/MM/YYYY' });
    const time = textInput(make, { maxLength: 5, label: 'Auto-delete time, 24-hour clock', css: styles.time, placeholder: 'HH:MM' });
    const calendar = fields.createCalendar({
      make,
      clock: config.clock,
      anchor: date,
      prefix: config.prefix,
      onOpen: closeSelect,
      onPick: (iso) => {
        const state = current();
        if (isLocked(state)) return;
        state.day = iso;
        state.dayInput = null;
        state.error = '';
        config.onChange();
        date.focus();
      }
    });
    dateWrap.append(date, calendar.wrap, time);
    const preview = make('div');
    preview.className = styles.preview.className;
    preview.style.cssText = styles.preview.css;
    const status = make('div');
    status.setAttribute('role', 'status');
    status.style.cssText = styles.status;
    root.append(label);
    if (!config.lifetimeInLabel) root.append(choice.trigger);
    root.append(delayWrap, dateWrap, preview, status);

    toggle.addEventListener('change', change((state) => { state.enabled = toggle.checked; }));
    fields.bindTyped(amount, (previous, raw) => fields.wholeType(raw, 5), typed((state, value) => { state.amount = value; }));
    fields.bindTyped(date, fields.dayType, typed((state, value) => {
      state.dayInput = value;
      state.day = fields.dayParse(value) || '';
    }));
    fields.bindTyped(time, fields.clockType, typed((state, value) => { state.time = value; }));
    time.addEventListener('blur', () => {
      const state = current();
      const normalized = fields.clockParse(state.time);
      if (isLocked(state) || normalized === null || normalized === state.time) return;
      state.time = normalized;
      state.error = '';
      config.onChange();
    });

    function render(context) {
      const state = current();
      const locked = isLocked(state);
      const delayOff = locked || !state.enabled || state.choice !== 'custom-delay';
      const dateOff = locked || !state.enabled || state.choice !== 'custom-date';
      const display = styles.display;
      toggle.checked = state.enabled;
      toggle.disabled = locked;
      choice.setValue(state.choice);
      choice.setDisabled(locked || !state.enabled);
      setShown(choice.trigger, state.enabled, display.lifetime);
      amount.value = state.amount;
      unit.setValue(state.unit);
      amount.disabled = delayOff;
      unit.setDisabled(delayOff);
      date.value = state.dayInput === null ? fields.dayDisplay(state.day) : state.dayInput;
      date.disabled = dateOff;
      calendar.trigger.disabled = dateOff;
      calendar.setSelected(state.day);
      if (dateOff) calendar.close();
      time.value = state.time;
      time.disabled = dateOff;
      setShown(delayWrap, state.enabled && state.choice === 'custom-delay', display.delayWrap);
      setShown(dateWrap, state.enabled && state.choice === 'custom-date', display.dateWrap);
      setShown(preview, state.enabled, '');
      const resolved = config.resolve(state);
      const described = resolved ? config.describe(resolved.expiresAt) : null;
      const dayValid = DAY_PATTERN.test(String(state.day ?? ''));
      const timeValid = fields.clockParse(state.time) !== null;
      const custom = state.choice === 'custom-date' && dayValid && resolved === null;
      const savesAt = clock => config.resolve(Object.assign({}, state, { time: clock })) !== null;
      const startSaves = custom && savesAt('00:00');
      const endSaves = custom && savesAt('23:59');
      const dayOutside = custom && !startSaves && !endSaves;
      const tooSoon = custom && timeValid && endSaves;
      const problem = dayOutside ? lifetimeProblem(Object.assign({}, state, { time: '00:00' }))
        : tooSoon && lifetimeProblem(state) === RANGE_PROBLEM ? TOO_SOON_PROBLEM : lifetimeProblem(state);
      preview.textContent = !state.enabled ? '' : described ? described.text : problem;
      preview.title = state.enabled && described ? described.title : '';
      const rangeValid = state.choice !== 'custom-date' || resolved !== null;
      const border = config.fieldBorder();
      markValidity(date, state.choice !== 'custom-date' || (dayValid && !dayOutside), border);
      markValidity(time, state.choice !== 'custom-date' || (timeValid && (rangeValid || dayOutside || !dayValid)), border);
      markValidity(amount, state.choice !== 'custom-delay' || resolved !== null, border);
      const notice = config.notice(state, context);
      setShown(status, Boolean(notice), '');
      status.textContent = notice ? notice.text : '';
      status.style.color = notice && notice.error ? ACCENT : '';
    }

    return {
      root,
      nodes: { label, toggle, choice, delayWrap, amount, unit, dateWrap, date, calendar, time, preview, status },
      render,
      popupOpen: () => choice.isOpen() || unit.isOpen() || calendar.isOpen()
    };
  }

  global.ISA_NOTE_CONTROLS = {
    createSelect, closeSelect, openSelectLayer, selectOwnedBy, selectTriggerLost, lifetime, lifetimeProblem, UNCERTAIN_SAVE,
    createLifetimeControls
  };
}(typeof window !== 'undefined' ? window : globalThis));
