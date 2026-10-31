const temporaryNoteDrafts = new Map();
let temporaryNotePanel = null;
let temporaryNoteCleanupPaused = false;
let temporaryNoteUiInitialized = false;
let temporaryNoteRestoring = false;
let temporaryNoteOpenMenuState = null;
let temporaryNoteSelectSeq = 0;

const TEMPORARY_NOTE_MENU_GAP = 2;
const TEMPORARY_NOTE_INVALID_COLOR = 'rgb(214, 84, 84)';
const TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE = 'data-isa-note-footer-owner';
const TEMPORARY_NOTE_CHIP_CLASS = 'isa-temporary-note-chip';
const TEMPORARY_NOTE_CHIP_STYLE = 'display:block;margin-top:2px;font-size:11px;opacity:0.7;';
const TEMPORARY_NOTE_READABLE_LINE = /^Auto-delete after: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/;
const TEMPORARY_NOTE_MARKER_IN_TEXT = /\[ISA-AUTO-DELETE:[^\]]*\]/;
const NOTE_CARD_ID_TOKEN = /^\d{1,32}$/;

function temporaryNoteElementVisible(element) {
  if (!element || !element.isConnected) return false;
  for (let node = element; node; node = node.parentElement || node.getRootNode()?.host) {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function temporaryNoteSetVisible(element, visible, display) {
  element.hidden = !visible;
  element.style.display = visible ? display : 'none';
}

function temporaryNoteHostChain(element) {
  const chain = [];
  for (let node = element; node; node = node.parentElement || node.getRootNode()?.host) chain.push(node);
  return chain;
}

function temporaryNoteCloseMenu() {
  const menu = temporaryNoteOpenMenuState;
  if (!menu) return;
  temporaryNoteOpenMenuState = null;
  menu.layer.remove();
  menu.control.trigger.setAttribute('aria-expanded', 'false');
  menu.control.trigger.removeAttribute('aria-activedescendant');
  window.removeEventListener('scroll', menu.reposition, true);
  window.removeEventListener('resize', menu.reposition);
  document.removeEventListener('pointerdown', menu.onOutside, true);
}

function temporaryNoteMenuTriggerLost() {
  const menu = temporaryNoteOpenMenuState;
  if (!menu) return false;
  if (menu.control.trigger.isConnected && menu.layer.isConnected) return false;
  temporaryNoteCloseMenu();
  return true;
}

function temporaryNotePlaceMenu(control, layer) {
  if (temporaryNoteMenuTriggerLost()) return;
  const rect = control.trigger.getBoundingClientRect();
  const width = Math.max(layer.offsetWidth, rect.width);
  const height = layer.offsetHeight;
  const room = window.innerHeight - rect.bottom;
  const above = room < height + TEMPORARY_NOTE_MENU_GAP && rect.top > room;
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4));
  const top = above
    ? Math.max(4, rect.top - height - TEMPORARY_NOTE_MENU_GAP)
    : rect.bottom + TEMPORARY_NOTE_MENU_GAP;
  layer.style.left = `${Math.round(left)}px`;
  layer.style.top = `${Math.round(top)}px`;
  layer.style.minWidth = `${Math.round(rect.width)}px`;
}

function temporaryNoteMenuActive(control, index) {
  const menu = temporaryNoteOpenMenuState;
  if (!menu || menu.control !== control) return;
  menu.activeIndex = index;
  menu.rows.forEach((row, position) => {
    const active = position === index;
    row.setAttribute('aria-selected', active ? 'true' : 'false');
    row.style.background = active ? control.theme.activeBackground : 'transparent';
    row.style.color = active ? control.theme.activeText : control.theme.text;
    if (active) {
      control.trigger.setAttribute('aria-activedescendant', row.id);
      if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    }
  });
}

function temporaryNoteOpenMenu(control) {
  if (control.disabled) return;
  temporaryNoteCloseMenu();
  const layer = createOwnElement('div');
  layer.className = 'isa-temporary-note-menu';
  layer.id = control.listboxId;
  layer.setAttribute('role', 'listbox');
  layer.setAttribute('aria-label', control.label);
  layer.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;max-height:min(calc(100vh - 24px),420px);overflow-y:auto;'
    + 'padding:2px;border-radius:6px;font:12px/1.6 system-ui;box-shadow:0 6px 20px rgba(0,0,0,0.35);';
  layer.style.background = control.theme.background;
  layer.style.color = control.theme.text;
  layer.style.border = `1px solid ${control.theme.border}`;
  const rows = control.items.map((item, index) => {
    const row = createOwnElement('div');
    row.id = `${control.listboxId}-option-${index}`;
    row.setAttribute('role', 'option');
    row.dataset.value = item.value;
    row.textContent = item.label;
    row.style.cssText = 'padding:2px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;';
    row.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    row.addEventListener('pointerenter', () => temporaryNoteMenuActive(control, index));
    row.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      temporaryNoteCommitMenu(control, index);
    });
    layer.append(row);
    return row;
  });
  ['pointerup', 'mousedown', 'mouseup', 'touchstart'].forEach((type) => {
    layer.addEventListener(type, event => event.stopPropagation());
  });
  const reposition = () => temporaryNotePlaceMenu(control, layer);
  const onOutside = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.includes(layer) || path.includes(control.trigger)) return;
    temporaryNoteCloseMenu();
  };
  document.body.append(layer);
  temporaryNoteOpenMenuState = { control, layer, rows, activeIndex: -1, reposition, onOutside, search: '', searchAt: 0 };
  control.trigger.setAttribute('aria-expanded', 'true');
  temporaryNotePlaceMenu(control, layer);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('pointerdown', onOutside, true);
  const selected = control.items.findIndex(item => item.value === control.value);
  temporaryNoteMenuActive(control, selected < 0 ? 0 : selected);
}

function temporaryNoteCommitMenu(control, index) {
  const item = control.items[index];
  temporaryNoteCloseMenu();
  control.trigger.focus();
  if (!item || item.value === control.value) return;
  control.setValue(item.value);
  control.onChange(item.value);
}

function temporaryNoteMenuStep(control, delta) {
  const menu = temporaryNoteOpenMenuState;
  if (!menu || menu.control !== control) return;
  const last = control.items.length - 1;
  const next = Math.max(0, Math.min(last, menu.activeIndex + delta));
  temporaryNoteMenuActive(control, next);
}

function temporaryNoteMenuTypeahead(control, key) {
  const menu = temporaryNoteOpenMenuState;
  if (!menu || menu.control !== control) return;
  const now = Date.now();
  menu.search = now - menu.searchAt > 500 ? key.toLowerCase() : menu.search + key.toLowerCase();
  menu.searchAt = now;
  const found = control.items.findIndex(item => item.label.toLowerCase().startsWith(menu.search));
  if (found >= 0) temporaryNoteMenuActive(control, found);
}

function createTemporaryNoteSelect({ label, items, onChange }) {
  temporaryNoteSelectSeq += 1;
  const trigger = createOwnElement('div');
  const control = {
    label,
    items,
    onChange,
    trigger,
    value: items[0] ? items[0].value : '',
    disabled: false,
    listboxId: `isa-temporary-note-list-${temporaryNoteSelectSeq}`,
    theme: { background: '#ffffff', text: '#111111', border: '#c8c8c8', activeBackground: '#1a73e8', activeText: '#ffffff' }
  };
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', control.listboxId);
  trigger.setAttribute('aria-label', label);
  trigger.tabIndex = 0;
  trigger.style.cssText = 'display:inline-flex;align-items:center;justify-content:space-between;gap:6px;'
    + 'padding:1px 6px;border-radius:6px;cursor:pointer;user-select:none;min-width:96px;font:inherit;';
  const valueNode = createOwnElement('span');
  const caret = createOwnElement('span');
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '\u25BE';
  caret.style.opacity = '0.7';
  trigger.append(valueNode, caret);
  control.setValue = (value) => {
    const item = control.items.find(entry => entry.value === value);
    if (!item) return false;
    control.value = value;
    valueNode.textContent = item.label;
    return true;
  };
  control.setDisabled = (disabled) => {
    control.disabled = disabled === true;
    trigger.setAttribute('aria-disabled', control.disabled ? 'true' : 'false');
    trigger.tabIndex = control.disabled ? -1 : 0;
    trigger.style.opacity = control.disabled ? '0.5' : '1';
    if (control.disabled && temporaryNoteOpenMenuState?.control === control) temporaryNoteCloseMenu();
  };
  control.isOpen = () => temporaryNoteOpenMenuState?.control === control;
  control.applyTheme = (theme) => {
    control.theme = theme;
    trigger.style.background = theme.background;
    trigger.style.color = theme.text;
    trigger.style.border = `1px solid ${theme.border}`;
    if (control.isOpen()) temporaryNoteOpenMenu(control);
  };
  trigger.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (control.disabled) return;
    if (control.isOpen()) temporaryNoteCloseMenu();
    else temporaryNoteOpenMenu(control);
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
      return temporaryNoteOpenMenu(control);
    }
    if (!open) return;
    if (key === 'ArrowDown') { handled(); return temporaryNoteMenuStep(control, 1); }
    if (key === 'ArrowUp') { handled(); return temporaryNoteMenuStep(control, -1); }
    if (key === 'Home') { handled(); return temporaryNoteMenuActive(control, 0); }
    if (key === 'End') { handled(); return temporaryNoteMenuActive(control, control.items.length - 1); }
    if (key === 'Escape') { handled(); return temporaryNoteCloseMenu(); }
    if (key === 'Tab') return temporaryNoteCloseMenu();
    if (key === 'Enter' || key === ' ') {
      handled();
      return temporaryNoteCommitMenu(control, temporaryNoteOpenMenuState.activeIndex);
    }
    if (key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      handled();
      return temporaryNoteMenuTypeahead(control, key);
    }
  });
  trigger.addEventListener('blur', () => {
    if (control.isOpen()) temporaryNoteCloseMenu();
  });
  control.setValue(control.value);
  return control;
}

function temporaryNoteContext() {
  const workspace = /^\/a\/inbox\/([A-Za-z0-9_-]{1,64})\//.exec(location.pathname)?.[1];
  if (!workspace) return null;
  const panels = queryAllIntercom('aside[data-test-conversation-details-sidebar="true"]')
    .filter(temporaryNoteElementVisible);
  if (panels.length !== 1) return null;
  const sidebar = panels[0];
  const profiles = [...sidebar.querySelectorAll('a[data-test-user-profile-link="true"]')]
    .filter(temporaryNoteElementVisible);
  if (profiles.length !== 1) return null;
  const url = new URL(profiles[0].getAttribute('href'), location.origin);
  const match = /^\/a\/apps\/([A-Za-z0-9_-]{1,64})\/users\/([a-f0-9]{24})$/.exec(url.pathname);
  if (url.origin !== location.origin || !match || match[1] !== workspace) return null;
  return { workspace, contact: match[2], sidebar, key: `${workspace}:${match[2]}` };
}

function temporaryNotePost(message) {
  window.postMessage({ __isaTempNote: true, ...message }, location.origin);
}

function temporaryNoteDraft(context) {
  let state = temporaryNoteDrafts.get(context.key);
  if (!state) {
    state = { workspace: context.workspace, contact: context.contact, enabled: false, draft: '',
      choice: String(ISA_TEMPORARY_NOTES.defaultDelayMs), delayAmount: '36', delayUnit: 'hours',
      localDay: '', localTime: '',
      token: crypto.randomUUID(), revision: 0, armedRevision: -1, status: 'idle', error: '' };
    temporaryNoteDrafts.set(context.key, state);
  }
  return state;
}

function temporaryNoteBusy(state) {
  return state.status === 'pending' || state.status === 'uncertain';
}

function armTemporaryNote(panel) {
  const { state, input } = panel;
  if (temporaryNoteBusy(state)) return;
  state.draft = input.value;
  state.revision += 1;
  state.armedRevision = -1;
  state.error = '';
  const lifetime = state.enabled ? temporaryNoteLifetime(state) : null;
  if (!state.enabled || !lifetime) {
    temporaryNotePost({ kind: 'disarm', workspace: state.workspace, contact: state.contact,
      token: state.token, revision: state.revision });
  } else {
    temporaryNotePost({ kind: 'arm', workspace: state.workspace, contact: state.contact,
      draft: state.draft, lifetime, token: state.token, revision: state.revision });
  }
  renderTemporaryNoteControls(panel);
}

function temporaryNoteLifetime(state) {
  if (state.choice === 'custom-delay') {
    const delayMs = ISA_TEMPORARY_NOTES.delayFromUnits(state.delayAmount, state.delayUnit);
    return delayMs === null ? null : { mode: 'relative', delayMs };
  }
  if (state.choice === 'custom-date') {
    const local = temporaryNoteLocalMinute(state);
    const expiresAt = local === null ? null : ISA_TEMPORARY_NOTES.localMinuteToUtcIso(local);
    return expiresAt === null ? null : { mode: 'absolute', expiresAt };
  }
  const delayMs = ISA_TEMPORARY_NOTES.normalizeDelayMs(state.choice);
  return delayMs === null ? null : { mode: 'relative', delayMs };
}

function temporaryNoteNormalizedTime(value) {
  const parsed = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(String(value ?? ''));
  if (!parsed) return null;
  const hours = Number(parsed[1]);
  const minutes = Number(parsed[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function temporaryNoteFilterTimeText(value) {
  const kept = String(value ?? '').replace(/[^\d:]/g, '');
  const digits = kept.replace(/:/g, '').slice(0, 4);
  if (kept.includes(':')) {
    const [head, tail = ''] = kept.split(':');
    return `${head.slice(0, 2)}:${tail.replace(/:/g, '').slice(0, 2)}`;
  }
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function temporaryNoteLocalMinute(state) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(state.localDay ?? '')) ? state.localDay : null;
  const time = temporaryNoteNormalizedTime(state.localTime);
  return day && time ? `${day}T${time}` : null;
}

function temporaryNoteInstant(state) {
  const resolved = ISA_TEMPORARY_NOTES.resolveLifetime(temporaryNoteLifetime(state), Date.now());
  return resolved.ok ? resolved : null;
}

function temporaryNoteNotice(state) {
  if (state.status === 'uncertain') return 'Save result is uncertain. Do not submit again until this note is verified.';
  if (state.status === 'pending') return 'Saving note with expiry…';
  if (!state.enabled) return '';
  if (state.error) return state.error;
  if (temporaryNoteCleanupPaused) return 'Automatic cleanup is paused in this browser.';
  return '';
}

function temporaryNoteSurfaceColor(element) {
  for (const node of temporaryNoteHostChain(element)) {
    const parsed = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/
      .exec(window.getComputedStyle(node).backgroundColor);
    if (!parsed) continue;
    const alpha = parsed[4] === undefined ? 1 : Number(parsed[4]);
    if (!(alpha > 0.9)) continue;
    return { r: Number(parsed[1]), g: Number(parsed[2]), b: Number(parsed[3]) };
  }
  return null;
}

function temporaryNoteApplyTheme(panel) {
  const color = temporaryNoteSurfaceColor(panel.controls);
  if (!color) return false;
  const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  const dark = luminance < 0.5;
  const shift = dark ? 26 : -26;
  const clamp = value => Math.max(0, Math.min(255, value + shift));
  const lift = value => Math.max(0, Math.min(255, value + (dark ? 40 : -40)));
  const text = window.getComputedStyle(panel.controls).color;
  const theme = {
    dark,
    background: `rgb(${color.r}, ${color.g}, ${color.b})`,
    border: `rgb(${clamp(color.r)}, ${clamp(color.g)}, ${clamp(color.b)})`,
    activeBackground: `rgb(${lift(color.r)}, ${lift(color.g)}, ${lift(color.b)})`,
    activeText: text,
    text
  };
  panel.theme = theme;
  panel.choice.applyTheme(theme);
  panel.delayUnit.applyTheme(theme);
  [panel.delayAmount, panel.dateInput, panel.timeInput].forEach((element) => {
    element.style.colorScheme = dark ? 'dark' : 'light';
    element.style.backgroundColor = theme.background;
    element.style.color = theme.text;
    element.style.border = `1px solid ${theme.border}`;
    element.style.borderRadius = '6px';
  });
  return true;
}

function temporaryNoteProblem(state) {
  if (state.choice === 'custom-delay') return 'Enter a whole number of hours, days, or weeks, from 1 minute to 3650 days.';
  if (state.choice !== 'custom-date') return 'Pick a lifetime for this note.';
  const local = temporaryNoteLocalMinute(state);
  if (!local) return 'Pick the date, and a time as HH:MM on a 24-hour clock.';
  if (ISA_TEMPORARY_NOTES.localMinuteToUtcIso(local) === null) {
    return 'That local time does not exist on this date. Pick another time.';
  }
  return 'Pick a date between 1 minute and 3650 days from now.';
}

function temporaryNoteMarkValidity(element, valid, theme) {
  const empty = String(element.value ?? '') === '';
  const invalid = !valid && !empty;
  element.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  element.style.borderColor = invalid ? TEMPORARY_NOTE_INVALID_COLOR : (theme ? theme.border : '');
}

function temporaryNoteDayBound(timestamp) {
  const value = ISA_TEMPORARY_NOTES.formatLocalMinuteInput(timestamp);
  return value ? value.slice(0, 10) : '';
}

function renderTemporaryNoteControls(panel) {
  const { state, toggle, choice, delayWrap, delayAmount, delayUnit, dateWrap, dateInput,
    timeInput, preview, status } = panel;
  const busy = temporaryNoteBusy(state);
  toggle.checked = state.enabled;
  toggle.disabled = busy;
  choice.setValue(state.choice);
  choice.setDisabled(busy);
  temporaryNoteSetVisible(choice.trigger, state.enabled, 'inline-flex');
  delayAmount.value = state.delayAmount;
  delayUnit.setValue(state.delayUnit);
  delayAmount.disabled = busy;
  delayUnit.setDisabled(busy);
  dateInput.value = state.localDay;
  dateInput.disabled = busy;
  timeInput.value = state.localTime;
  timeInput.disabled = busy;
  dateInput.min = temporaryNoteDayBound(Date.now() + ISA_TEMPORARY_NOTES.minLifetimeMs);
  dateInput.max = temporaryNoteDayBound(Date.now() + ISA_TEMPORARY_NOTES.maxLifetimeMs);
  temporaryNoteSetVisible(delayWrap, state.enabled && state.choice === 'custom-delay', 'flex');
  temporaryNoteSetVisible(dateWrap, state.enabled && state.choice === 'custom-date', '');
  temporaryNoteSetVisible(preview, state.enabled, '');
  if (state.enabled) {
    const resolved = temporaryNoteInstant(state);
    preview.textContent = resolved
      ? ISA_TEMPORARY_NOTES.formatSummary(resolved.expiresAt)
      : temporaryNoteProblem(state);
    preview.title = resolved ? ISA_TEMPORARY_NOTES.formatLocalHint(resolved.expiresAt) : '';
  }
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(String(state.localDay ?? ''));
  const timeValid = temporaryNoteNormalizedTime(state.localTime) !== null;
  const rangeValid = state.choice !== 'custom-date' || temporaryNoteInstant(state) !== null;
  temporaryNoteMarkValidity(dateInput, state.choice !== 'custom-date'
    || (dateValid && (rangeValid || !timeValid)), panel.theme);
  temporaryNoteMarkValidity(timeInput, state.choice !== 'custom-date'
    || (timeValid && (rangeValid || !dateValid)), panel.theme);
  temporaryNoteMarkValidity(delayAmount, state.choice !== 'custom-delay'
    || temporaryNoteInstant(state) !== null, panel.theme);
  const notice = temporaryNoteNotice(state);
  temporaryNoteSetVisible(status, Boolean(notice), '');
  status.textContent = notice;
}

function createTemporaryNoteControls(context, section, input) {
  const state = temporaryNoteDraft(context);
  const controls = createOwnElement('div');
  controls.className = 'isa-temporary-note-controls';
  controls.style.cssText = 'font:12px/1.4 system-ui;width:100%;display:grid;gap:6px;';
  const label = createOwnElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
  const toggle = createOwnElement('input');
  toggle.type = 'checkbox';
  toggle.setAttribute('aria-label', 'Auto-delete');
  const choiceItems = ISA_TEMPORARY_NOTES.presets.map(preset => ({ value: preset.id, label: preset.label }))
    .concat([{ value: 'custom-delay', label: 'Custom delay' }, { value: 'custom-date', label: 'Custom date' }]);
  const choice = createTemporaryNoteSelect({
    label: 'Auto-delete lifetime',
    items: choiceItems,
    onChange: (value) => {
      if (temporaryNoteBusy(state)) return renderTemporaryNoteControls(panel);
      state.choice = value;
      armTemporaryNote(panel);
    }
  });
  label.append(toggle, 'Auto-delete', choice.trigger);
  const delayWrap = createOwnElement('div');
  delayWrap.style.cssText = 'align-items:center;gap:6px;';
  const delayAmount = createOwnElement('input');
  delayAmount.type = 'number';
  delayAmount.min = '1';
  delayAmount.step = '1';
  delayAmount.style.width = '70px';
  delayAmount.setAttribute('aria-label', 'Auto-delete custom amount');
  const delayUnit = createTemporaryNoteSelect({
    label: 'Auto-delete custom unit',
    items: Object.keys(ISA_TEMPORARY_NOTES.delayUnits).map(unit => ({ value: unit, label: unit })),
    onChange: (value) => {
      if (temporaryNoteBusy(state)) return renderTemporaryNoteControls(panel);
      state.delayUnit = value;
      armTemporaryNote(panel);
    }
  });
  delayWrap.append('Delete after', delayAmount, delayUnit.trigger);
  const dateWrap = createOwnElement('div');
  dateWrap.style.cssText = 'align-items:center;gap:6px;';
  const dateInput = createOwnElement('input');
  dateInput.type = 'date';
  dateInput.style.cssText = 'font:inherit;';
  dateInput.setAttribute('aria-label', 'Auto-delete date');
  const timeInput = createOwnElement('input');
  timeInput.type = 'text';
  timeInput.inputMode = 'numeric';
  timeInput.maxLength = 5;
  timeInput.placeholder = 'HH:MM';
  timeInput.pattern = '([01][0-9]|2[0-3]):[0-5][0-9]';
  timeInput.style.cssText = 'font:inherit;width:60px;';
  timeInput.setAttribute('aria-label', 'Auto-delete time, 24-hour clock');
  dateWrap.append(dateInput, timeInput);
  const preview = createOwnElement('div');
  preview.className = 'isa-temporary-note-preview';
  preview.style.cssText = 'opacity:0.75;';
  const status = createOwnElement('div');
  status.setAttribute('role', 'status');
  status.style.cssText = 'opacity:0.75;';
  controls.append(label, delayWrap, dateWrap, preview, status);
  input.parentElement.after(controls);
  const panel = { ...context, section, input, controls, state, toggle, choice,
    delayWrap, delayAmount, delayUnit, dateWrap, dateInput, timeInput, preview, status };
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart'].forEach((type) => {
    controls.addEventListener(type, (event) => {
      if (event.target && event.target.closest
        && event.target.closest('input, select, textarea, [role="combobox"]')) {
        event.stopPropagation();
      }
    });
  });
  toggle.addEventListener('change', () => {
    if (temporaryNoteBusy(state)) return renderTemporaryNoteControls(panel);
    state.enabled = toggle.checked;
    armTemporaryNote(panel);
  });
  [[delayAmount, 'delayAmount'], [dateInput, 'localDay'], [timeInput, 'localTime']].forEach(([element, field]) => {
    element.addEventListener('input', () => {
      if (temporaryNoteBusy(state)) return;
      if (element === timeInput) {
        const filtered = temporaryNoteFilterTimeText(element.value);
        if (filtered !== element.value) element.value = filtered;
      }
      state[field] = element.value;
      armTemporaryNote(panel);
    });
  });
  timeInput.addEventListener('blur', () => {
    if (temporaryNoteBusy(state)) return;
    const normalized = temporaryNoteNormalizedTime(state.localTime);
    if (normalized === null || normalized === state.localTime) return;
    state.localTime = normalized;
    armTemporaryNote(panel);
  });
  temporaryNoteApplyTheme(panel);
  renderTemporaryNoteControls(panel);
  return panel;
}

function temporaryNoteActiveElement(root) {
  let active = root && root.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function temporaryNoteInteracting(panel) {
  if (!panel || !panel.controls.isConnected) return false;
  if (panel.choice.isOpen() || panel.delayUnit.isOpen()) return true;
  const active = temporaryNoteActiveElement(panel.controls.getRootNode());
  return Boolean(active && panel.controls.contains(active));
}

function temporaryNoteFooterParts(body) {
  const parts = [...body.children].filter(node => !node.hasAttribute(OWN_NODE_ATTRIBUTE));
  const footer = [];
  let marker = null;
  for (const part of parts) {
    const text = part.textContent.trim();
    const match = TEMPORARY_NOTE_MARKER_IN_TEXT.exec(text);
    if (match) {
      const parsed = ISA_TEMPORARY_NOTES.parseMarker(match[0]);
      if (!parsed) return null;
      marker = parsed;
      footer.push(part);
    } else if (TEMPORARY_NOTE_READABLE_LINE.test(text)) {
      footer.push(part);
    }
  }
  return marker && footer.length ? { marker, footer } : null;
}

function temporaryNoteChip(body) {
  return [...body.children].find(node => node.classList?.contains(TEMPORARY_NOTE_CHIP_CLASS)) || null;
}

function maskTemporaryNoteFooter(body) {
  if (ownedByAnotherInstall(body, TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE)) return;
  const chip = temporaryNoteChip(body);
  const parts = temporaryNoteFooterParts(body);
  if (!parts) {
    if (chip) chip.remove();
    if (body.hasAttribute(TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE)) {
      body.removeAttribute(TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE);
    }
    return;
  }
  if (body.getAttribute(TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE) !== extensionInstallId()) {
    claimDecoration(body, TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE);
  }
  for (const part of parts.footer) {
    if (!part.hidden) temporaryNoteSetVisible(part, false, '');
  }
  const label = ISA_TEMPORARY_NOTES.formatSummary(parts.marker.expiresAtIso);
  const hint = ISA_TEMPORARY_NOTES.formatLocalHint(parts.marker.expiresAtIso) || '';
  if (chip && chip.textContent === label && chip.title === hint) return;
  const target = chip || createOwnElement('span');
  target.className = TEMPORARY_NOTE_CHIP_CLASS;
  target.style.cssText = TEMPORARY_NOTE_CHIP_STYLE;
  target.textContent = label;
  target.title = hint;
  if (!chip) body.appendChild(target);
}

function temporaryNoteCard(noteId) {
  const selector = `[data-testid="note-${noteId}"]`;
  return queryAllIntercom(selector).find(card => card.querySelector('[data-testid="note-body"]')) || null;
}

function hideDeletedTemporaryNoteCard(noteId) {
  if (!NOTE_CARD_ID_TOKEN.test(String(noteId))) return false;
  const card = temporaryNoteCard(noteId);
  if (!card || ownedByAnotherInstall(card, TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE)) return false;
  const body = card.querySelector('[data-testid="note-body"]');
  if (!body || !temporaryNoteFooterParts(body)) return false;
  if (card.getAttribute(TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE) !== extensionInstallId()) {
    claimDecoration(card, TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE);
  }
  if (!card.hidden) temporaryNoteSetVisible(card, false, '');
  return true;
}

function refreshTemporaryNoteFooters() {
  for (const body of queryAllIntercom('[data-testid="note-body"]')) {
    if (body.isConnected) maskTemporaryNoteFooter(body);
  }
}

function refreshTemporaryNoteControls() {
  temporaryNoteMenuTriggerLost();
  const context = temporaryNoteContext();
  const sections = context ? [...context.sidebar.querySelectorAll(
    '[data-test-sidebar-section-item="notes"][data-sidebar-section-id="notes"] [data-testid="notes-section"]'
  )].filter(temporaryNoteElementVisible) : [];
  const section = sections.length === 1 ? sections[0] : null;
  const inputs = section ? [...section.querySelectorAll('textarea[data-testid="note-input"]')]
    .filter(temporaryNoteElementVisible) : [];
  const input = inputs.length === 1 ? inputs[0] : null;
  if (temporaryNotePanel && context?.key === temporaryNotePanel.key && input === temporaryNotePanel.input
    && temporaryNotePanel.controls.isConnected) return;
  if (temporaryNotePanel && context?.key === temporaryNotePanel.key
    && temporaryNoteInteracting(temporaryNotePanel)) return;
  if (temporaryNotePanel) {
    const old = temporaryNotePanel;
    if (temporaryNoteOpenMenuState) temporaryNoteCloseMenu();
    if (!temporaryNoteBusy(old.state)) {
      old.state.draft = old.input.value;
      temporaryNotePost({ kind: 'disarm', workspace: old.state.workspace, contact: old.state.contact,
        token: old.state.token, revision: ++old.state.revision });
    }
    old.controls.remove();
    temporaryNotePanel = null;
  }
  if (context && section && input) {
    temporaryNotePanel = createTemporaryNoteControls(context, section, input);
    if (temporaryNotePanel.state.enabled) armTemporaryNote(temporaryNotePanel);
  }
}

function temporaryNoteEventInput(event) {
  return event.composedPath().find(node => node?.matches?.('textarea[data-testid="note-input"]'));
}

function handleTemporaryNoteInput(event) {
  if (temporaryNoteRestoring) return;
  const input = temporaryNoteEventInput(event);
  if (!input || input !== temporaryNotePanel?.input) return;
  armTemporaryNote(temporaryNotePanel);
}

function guardTemporaryNoteSave(event) {
  const panel = temporaryNotePanel;
  const input = temporaryNoteEventInput(event);
  if (!panel || input !== panel.input) return;
  if (event.type === 'keydown' && (event.key !== 'Enter' || event.shiftKey || event.isComposing)) return;
  const movingToControls = event.relatedTarget && panel.controls.contains(event.relatedTarget);
  if (movingToControls && (event.type === 'blur' || event.type === 'focusout')) {
    event.stopImmediatePropagation();
    return;
  }
  const state = panel.state;
  if (!state.enabled) return;
  if (temporaryNoteContext()?.key !== panel.key || temporaryNoteBusy(state)
    || !temporaryNoteLifetime(state) || state.armedRevision !== state.revision
    || state.draft !== input.value) {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.error = temporaryNoteBusy(state) ? 'Wait until this submission is verified before saving again.'
      : 'Temporary note was not submitted. Check the lifetime and wait for expiry protection, then try again.';
    renderTemporaryNoteControls(panel);
  }
}

function restoreTemporaryNoteDraft(panel) {
  if (temporaryNoteContext()?.key !== panel.key || panel.input.value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(panel.input, panel.state.draft);
  temporaryNoteRestoring = true;
  try {
    panel.input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } finally {
    temporaryNoteRestoring = false;
  }
}

const TEMPORARY_NOTE_BUSY_REASONS = new Set(['save-pending', 'save-uncertain']);

function handleTemporaryNoteMessage(data) {
  const state = [...temporaryNoteDrafts.values()].find(item => item.token === data.token);
  if (!state) return;
  if (data.kind === 'temporary-note-armed' && data.revision === state.revision) {
    if (data.status === 'armed') state.armedRevision = data.revision;
    else if (data.status === 'blocked') {
      state.armedRevision = -1;
      state.error = 'Expiry protection is not active. Check the lifetime, then try again.';
    }
  } else if (data.kind === 'temporary-note-save') {
    if (!['pending', 'success', 'failed', 'uncertain', 'blocked'].includes(data.status)) return;
    state.status = data.status;
    if (data.status === 'success') {
      state.enabled = false;
      state.choice = String(ISA_TEMPORARY_NOTES.defaultDelayMs);
      state.delayAmount = '36';
      state.delayUnit = 'hours';
      state.localDay = '';
      state.localTime = '';
      state.draft = '';
      state.error = '';
      state.token = crypto.randomUUID();
      state.armedRevision = -1;
    } else if (data.status === 'failed' || data.status === 'blocked') {
      const error = data.reason === 'expiry-in-past'
        ? 'That date has already passed. Pick a new expiry, then save again.'
        : 'Temporary note was not saved. Your draft and lifetime are preserved. Try again.';
      state.error = error;
      state.armedRevision = -1;
      if (temporaryNotePanel?.state === state) {
        restoreTemporaryNoteDraft(temporaryNotePanel);
        if (state.enabled && !TEMPORARY_NOTE_BUSY_REASONS.has(data.reason)) {
          armTemporaryNote(temporaryNotePanel);
          state.error = error;
        }
      }
    }
  }
  if (temporaryNotePanel?.state === state) renderTemporaryNoteControls(temporaryNotePanel);
}

function initTemporaryNoteControls() {
  if (temporaryNoteUiInitialized) return;
  temporaryNoteUiInitialized = true;
  document.addEventListener('input', handleTemporaryNoteInput, true);
  document.addEventListener('keydown', guardTemporaryNoteSave, true);
  document.addEventListener('blur', guardTemporaryNoteSave, true);
  document.addEventListener('focusout', guardTemporaryNoteSave, true);
  try {
    chrome.storage.local.get('isaPauseAutomaticNoteCleanup', values => {
      temporaryNoteCleanupPaused = values?.isaPauseAutomaticNoteCleanup === true;
      if (temporaryNotePanel) renderTemporaryNoteControls(temporaryNotePanel);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.isaPauseAutomaticNoteCleanup) return;
      temporaryNoteCleanupPaused = changes.isaPauseAutomaticNoteCleanup.newValue === true;
      const cleanup = window.ISA_NOTE_RUNTIME?.getController?.();
      if (temporaryNoteCleanupPaused && cleanup && !cleanup.isPaused()) cleanup.pause('setting');
      if (temporaryNotePanel) renderTemporaryNoteControls(temporaryNotePanel);
    });
  } catch (error) {}
  refreshTemporaryNoteControls();
  refreshTemporaryNoteFooters();
}

window.ISA_TEMPORARY_NOTES_UI = {
  applyTheme: temporaryNoteApplyTheme,
  closeMenu: temporaryNoteCloseMenu,
  openMenuLayer: () => temporaryNoteOpenMenuState?.layer || null,
  refresh: refreshTemporaryNoteControls,
  refreshFooters: refreshTemporaryNoteFooters,
  hideDeletedCard: hideDeletedTemporaryNoteCard,
  init: initTemporaryNoteControls,
  getPanel: () => temporaryNotePanel,
  getDraft: key => temporaryNoteDrafts.get(key),
  isPaused: () => temporaryNoteCleanupPaused
};
