const temporaryNoteDrafts = new Map();
let temporaryNotePanel = null;
let temporaryNoteCleanupPaused = false;
let temporaryNoteUiInitialized = false;
let temporaryNoteRestoring = false;
let temporaryNoteSelectSeq = 0;
let temporaryNoteExpiryEditor = null;
const temporaryNoteEditChecks = new Map();
const TEMPORARY_NOTE_EDIT_CHECK_MS = 2000;
const temporaryNoteExpiryOverrides = new Map();
const temporaryNoteEditors = new Map();

const TEMPORARY_NOTE_MENU_GAP = 2;
const TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE = 'data-isa-note-footer-owner';
const TEMPORARY_NOTE_CHIP_CLASS = 'isa-temporary-note-chip';
const TEMPORARY_NOTE_CHIP_STYLE = 'display:block;margin-top:2px;font-size:11px;opacity:0.7;';
const TEMPORARY_NOTE_EXPIRY_EDITOR_CLASS = 'isa-temporary-note-expiry-editor';
const TEMPORARY_NOTE_ADD_CLASS = 'isa-temporary-note-add';
const TEMPORARY_NOTE_EDIT_READY_ATTRIBUTE = 'data-isa-note-edit';
const TEMPORARY_NOTE_EDIT_STYLE_ID = 'isa-temporary-note-edit-style';
const TEMPORARY_NOTE_EDIT_CSS = `[data-testid^="note-"] textarea[aria-label="Edit note"]:not([${TEMPORARY_NOTE_EDIT_READY_ATTRIBUTE}]) {`
  + ' -webkit-text-fill-color: transparent; animation: isa-note-edit-reveal 0s linear 500ms forwards; }'
  + ' @keyframes isa-note-edit-reveal { to { -webkit-text-fill-color: currentcolor; } }'
  + ' [data-base-ui-portal] > [role="presentation"]:has(> [role="tooltip"][data-testid="tooltip-content"]) { pointer-events: none !important; }';
const TEMPORARY_NOTE_READABLE_LINE = /^Auto-delete after: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/;
const TEMPORARY_NOTE_MARKER_IN_TEXT = /\[ISA-AUTO-DELETE:[^\]]*\]/;
const TEMPORARY_NOTE_MARKER_PREFIX_IN_TEXT = /\[ISA-AUTO-DELETE:/;
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

function createTemporaryNoteSelect({ label, items, onChange, onOpen }) {
  temporaryNoteSelectSeq += 1;
  const control = ISA_NOTE_CONTROLS.createSelect({
    make: createOwnElement,
    label,
    items,
    onOpen,
    listboxId: `isa-temporary-note-list-${temporaryNoteSelectSeq}`,
    gap: TEMPORARY_NOTE_MENU_GAP,
    layerClass: 'isa-temporary-note-menu',
    layerCss: 'position:fixed;left:0;top:0;z-index:2147483000;max-height:min(calc(100vh - 24px),420px);overflow-y:auto;'
      + 'padding:2px;border-radius:6px;font:12px/1.6 system-ui;box-shadow:0 6px 20px rgba(0,0,0,0.35);',
    triggerCss: 'display:inline-flex;align-items:center;justify-content:space-between;gap:6px;'
      + 'padding:1px 6px;border-radius:6px;cursor:pointer;user-select:none;min-width:96px;font:inherit;',
    caretOpacity: '0.7',
    styleLayer: (layer) => {
      layer.style.background = control.theme.background;
      layer.style.color = control.theme.text;
      layer.style.border = `1px solid ${control.theme.border}`;
    },
    rowColors: active => ({
      background: active ? control.theme.activeBackground : 'transparent',
      color: active ? control.theme.activeText : control.theme.text
    }),
    styleDisabled: (trigger, disabled) => { trigger.style.opacity = disabled ? '0.5' : '1'; },
    onCommit: value => control.onChange(value)
  });
  control.onChange = onChange;
  control.theme = { background: '#ffffff', text: '#111111', border: '#c8c8c8', activeBackground: '#1a73e8', activeText: '#ffffff' };
  control.applyTheme = (theme) => {
    control.theme = theme;
    control.trigger.style.background = theme.background;
    control.trigger.style.color = theme.text;
    control.trigger.style.border = `1px solid ${theme.border}`;
    if (control.isOpen()) control.open();
  };
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
      choice: String(ISA_TEMPORARY_NOTES.defaultDelayMs), amount: '36', unit: 'hours',
      day: '', dayInput: null, time: '',
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
  return ISA_NOTE_CONTROLS.lifetime(state);
}

function temporaryNoteKeepsOriginal(state) {
  return Boolean(state.original) && state.choice === 'custom-date'
    && `${state.day}T${ISA_FIELDS.clockParse(state.time)}` === ISA_TEMPORARY_NOTES.formatLocalMinuteInput(state.original);
}

function temporaryNoteInstant(state) {
  if (temporaryNoteKeepsOriginal(state)) return { ok: true, expiresAt: state.original };
  const resolved = ISA_TEMPORARY_NOTES.resolveLifetime(temporaryNoteLifetime(state), Date.now());
  return resolved.ok ? resolved : null;
}

function temporaryNoteNotice(state) {
  if (state.status === 'uncertain') return { text: ISA_NOTE_CONTROLS.UNCERTAIN_SAVE, error: true };
  if (state.status === 'pending') return { text: 'Saving note with expiry…', error: false };
  if (!state.enabled) return null;
  if (state.error) return { text: state.error, error: true };
  if (temporaryNoteCleanupPaused) return { text: 'Automatic cleanup is paused in this browser.', error: false };
  return null;
}

function temporaryNoteApplyTheme(panel) {
  const color = isaSurfaceColor(panel.controls);
  if (!color) return false;
  const dark = color.dark;
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
  panel.hostTheme = isaHostTheme();
  panel.choice.applyTheme(theme);
  panel.delayUnit.applyTheme(theme);
  const calendar = panel.calendar;
  calendar.trigger.style.backgroundColor = theme.background;
  calendar.trigger.style.color = theme.text;
  calendar.trigger.style.border = `1px solid ${theme.border}`;
  calendar.panel.style.colorScheme = dark ? 'dark' : 'light';
  calendar.panel.style.backgroundColor = theme.background;
  calendar.panel.style.color = theme.text;
  calendar.panel.style.border = `1px solid ${theme.border}`;
  [panel.delayAmount, panel.dateInput, panel.timeInput].forEach((element) => {
    element.style.colorScheme = dark ? 'dark' : 'light';
    element.style.backgroundColor = theme.background;
    element.style.color = theme.text;
    element.style.border = `1px solid ${theme.border}`;
    element.style.borderRadius = '6px';
  });
  return true;
}

function renderTemporaryNoteControls(panel) {
  panel.lifetime.render();
  if (!panel.saveButton) return;
  temporaryNoteSetVisible(panel.saveButton, panel.state.enabled, '');
  panel.saveButton.disabled = temporaryNoteBusy(panel.state) || !temporaryNoteInstant(panel.state);
}

const TEMPORARY_NOTE_CONTROL_STYLES = {
  root: { className: 'isa-temporary-note-controls', css: 'font:12px/1.4 system-ui;width:100%;display:grid;gap:6px;' },
  label: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;',
  delayWrap: 'align-items:center;gap:6px;',
  dateWrap: 'align-items:center;gap:6px;',
  amount: 'width:70px;',
  date: 'font:inherit;width:96px;',
  time: 'font:inherit;width:60px;',
  preview: { className: 'isa-temporary-note-preview', css: 'opacity:0.75;' },
  status: 'opacity:0.75;',
  display: { lifetime: 'inline-flex', delayWrap: 'flex', dateWrap: '' }
};

function buildTemporaryNoteControls(state, commit) {
  const panel = { state };
  const lifetime = ISA_NOTE_CONTROLS.createLifetimeControls({
    make: createOwnElement,
    state: () => state,
    clock: () => Date.now(),
    prefix: 'isa-temporary-note',
    select: createTemporaryNoteSelect,
    items: ISA_TEMPORARY_NOTES.presets.map(preset => ({ value: preset.id, label: preset.label }))
      .concat([{ value: 'custom-delay', label: 'Custom delay' }, { value: 'custom-date', label: 'Custom date' }]),
    units: Object.keys(ISA_TEMPORARY_NOTES.delayUnits).map(unit => ({ value: unit, label: unit })),
    lifetimeInLabel: true,
    styles: TEMPORARY_NOTE_CONTROL_STYLES,
    resolve: temporaryNoteInstant,
    describe: expiresAt => ({ text: ISA_TEMPORARY_NOTES.formatSummary(expiresAt),
      title: ISA_TEMPORARY_NOTES.formatLocalHint(expiresAt) }),
    notice: temporaryNoteNotice,
    fieldBorder: () => (panel.theme ? panel.theme.border : ''),
    onChange: () => commit(panel),
    refresh: () => renderTemporaryNoteControls(panel)
  });
  const nodes = lifetime.nodes;
  Object.assign(panel, { lifetime, controls: lifetime.root, toggle: nodes.toggle, choice: nodes.choice,
    delayWrap: nodes.delayWrap, delayAmount: nodes.amount, delayUnit: nodes.unit, dateWrap: nodes.dateWrap,
    dateInput: nodes.date, calendar: nodes.calendar, timeInput: nodes.time, preview: nodes.preview, status: nodes.status });
  const controls = lifetime.root;
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart'].forEach((type) => {
    controls.addEventListener(type, (event) => {
      if (event.target && event.target.closest
        && event.target.closest('input, select, textarea, [role="combobox"], .isa-temporary-note-calendar-wrap')) {
        event.stopPropagation();
      }
    });
  });
  controls.addEventListener('mousedown', (event) => {
    if (!event.target.closest('input, select, textarea, button, [role="combobox"]')) event.preventDefault();
  });
  controls.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !event.target.matches('input') || !panel.input) return;
    event.preventDefault();
    event.stopPropagation();
    submitTemporaryNote(panel);
  });
  return panel;
}

function submitTemporaryNote(panel) {
  panel.input.focus();
  if (!panel.input.value.trim() || temporaryNoteBusy(panel.state)) return;
  panel.input.blur();
}

function createTemporaryNoteControls(context, section, input) {
  const panel = Object.assign(buildTemporaryNoteControls(temporaryNoteDraft(context), armTemporaryNote),
    context, { section, input });
  panel.saveButton = createOwnElement('button');
  panel.saveButton.type = 'button';
  panel.saveButton.className = 'isa-temporary-note-save';
  panel.saveButton.textContent = 'Save note';
  panel.saveButton.style.cssText = 'justify-self:end;font:inherit;cursor:pointer;padding:2px 10px;border-radius:6px;'
    + 'background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 32%,transparent);';
  panel.saveButton.addEventListener('click', () => submitTemporaryNote(panel));
  panel.controls.append(panel.saveButton);
  input.parentElement.after(panel.controls);
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
  if (panel.lifetime.popupOpen()) return true;
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
    const restored = temporaryNoteExpiryOverrides.get(temporaryNoteIdOf(body));
    if (restored && restored.restored) {
      temporaryNoteAddChip(body)?.remove();
      const kept = chip || createOwnElement('span');
      kept.className = TEMPORARY_NOTE_CHIP_CLASS;
      kept.style.cssText = TEMPORARY_NOTE_CHIP_STYLE;
      kept.textContent = ISA_TEMPORARY_NOTES.formatSummary(restored.expiresAt);
      kept.title = ISA_TEMPORARY_NOTES.formatLocalHint(restored.expiresAt) || '';
      if (!chip) body.appendChild(kept);
      return;
    }
    if (chip) chip.remove();
    if (body.hasAttribute(TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE)) {
      body.removeAttribute(TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE);
    }
    offerTemporaryNoteAdd(body);
    return;
  }
  temporaryNoteAddChip(body)?.remove();
  if (body.getAttribute(TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE) !== extensionInstallId()) {
    claimDecoration(body, TEMPORARY_NOTE_FOOTER_OWNER_ATTRIBUTE);
  }
  for (const part of parts.footer) {
    if (!part.hidden) temporaryNoteSetVisible(part, false, '');
  }
  const noteId = temporaryNoteIdOf(body);
  const override = temporaryNoteExpiryOverrides.get(noteId);
  if (override && (override.token !== parts.marker.token || override.expiresAt === parts.marker.expiresAtIso)) {
    temporaryNoteExpiryOverrides.delete(noteId);
  }
  const shown = temporaryNoteExpiryOverrides.get(noteId);
  if (shown && shown.expiresAt === null) {
    if (chip) chip.remove();
    return;
  }
  const expiresAt = shown ? shown.expiresAt : parts.marker.expiresAtIso;
  const label = ISA_TEMPORARY_NOTES.formatSummary(expiresAt);
  const hint = `${ISA_TEMPORARY_NOTES.formatLocalHint(expiresAt) || ''} Click to change.`.trim();
  if (chip && chip.textContent === label && chip.title === hint) return;
  const target = chip || createOwnElement('span');
  target.className = TEMPORARY_NOTE_CHIP_CLASS;
  target.style.cssText = `${TEMPORARY_NOTE_CHIP_STYLE}cursor:pointer;text-decoration:underline dotted;`;
  target.textContent = label;
  target.title = hint;
  if (chip) return;
  temporaryNoteMakeButton(target);
  body.appendChild(target);
}

function temporaryNoteMakeButton(target) {
  target.setAttribute('role', 'button');
  target.tabIndex = 0;
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart'].forEach((type) => {
    target.addEventListener(type, event => event.stopPropagation());
  });
  target.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTemporaryNoteExpiryEditor(target);
  });
  target.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    openTemporaryNoteExpiryEditor(target);
  });
}

function temporaryNoteAddChip(body) {
  return [...body.children].find(node => node.classList?.contains(TEMPORARY_NOTE_ADD_CLASS)) || null;
}

function offerTemporaryNoteAdd(body) {
  const offered = temporaryNoteAddChip(body);
  const plain = temporaryNoteIdOf(body) && temporaryNoteContext()
    && !TEMPORARY_NOTE_MARKER_PREFIX_IN_TEXT.test(body.textContent);
  if (!plain) {
    if (offered) offered.remove();
    return;
  }
  if (offered) return;
  const target = createOwnElement('span');
  target.className = TEMPORARY_NOTE_ADD_CLASS;
  target.style.cssText = `${TEMPORARY_NOTE_CHIP_STYLE}cursor:pointer;text-decoration:underline dotted;`;
  target.textContent = '+ Auto-delete';
  target.title = 'Give this note an auto-delete date.';
  temporaryNoteMakeButton(target);
  body.appendChild(target);
}

function temporaryNoteIdOf(element) {
  const card = element.closest('[data-testid^="note-"]:not([data-testid="note-body"]):not([data-testid="note-input"])');
  return /^note-(\d{1,32})$/.exec(card ? card.getAttribute('data-testid') : '')?.[1] || null;
}

function closeTemporaryNoteExpiryEditor() {
  const editor = temporaryNoteExpiryEditor;
  if (!editor) return;
  temporaryNoteExpiryEditor = null;
  ISA_NOTE_CONTROLS.closeSelect();
  editor.panel.calendar.close();
  editor.layer.remove();
  window.removeEventListener('scroll', editor.place, true);
  window.removeEventListener('resize', editor.place);
  document.removeEventListener('pointerdown', editor.onOutside, true);
  document.removeEventListener('keydown', editor.onKey, true);
}

function renderTemporaryNoteExpiryEditor(editor) {
  renderTemporaryNoteControls(editor.panel);
  const busy = temporaryNoteBusy(editor.state);
  editor.save.disabled = busy || (editor.state.enabled && !temporaryNoteInstant(editor.state));
  editor.cancel.disabled = editor.state.status === 'pending';
}

function openTemporaryNoteExpiryEditor(chip) {
  const body = chip.parentElement;
  const context = temporaryNoteContext();
  const adding = chip.classList.contains(TEMPORARY_NOTE_ADD_CLASS);
  const parts = body && !adding ? temporaryNoteFooterParts(body) : null;
  const noteId = body ? temporaryNoteIdOf(body) : null;
  if (!context || !noteId || (!adding && (!parts || parts.marker.workspaceId !== context.workspace
    || parts.marker.contactId !== context.contact))) return;
  closeTemporaryNoteExpiryEditor();
  const original = adding ? null : temporaryNoteExpiryOverrides.get(noteId)?.expiresAt || parts.marker.expiresAtIso;
  const local = adding ? '' : ISA_TEMPORARY_NOTES.formatLocalMinuteInput(original);
  const state = { enabled: true, choice: adding ? String(ISA_TEMPORARY_NOTES.defaultDelayMs) : 'custom-date',
    amount: '36', unit: 'hours', day: local.slice(0, 10), dayInput: null, time: local.slice(11, 16),
    status: 'idle', error: '', original };
  const layer = createOwnElement('div');
  layer.className = TEMPORARY_NOTE_EXPIRY_EDITOR_CLASS;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', adding ? 'Add auto-delete' : 'Change auto-delete');
  const surface = isaSurfaceColor(chip);
  layer.style.cssText = 'position:fixed;left:0;top:0;z-index:2147460000;box-sizing:border-box;width:280px;padding:10px;'
    + 'display:grid;gap:8px;border-radius:8px;font:12px/1.4 system-ui;box-shadow:0 6px 20px rgba(0,0,0,0.35);';
  layer.style.background = surface ? `rgb(${surface.r}, ${surface.g}, ${surface.b})` : '#ffffff';
  layer.style.color = window.getComputedStyle(chip).color;
  layer.style.border = '1px solid color-mix(in srgb,currentColor 24%,transparent)';
  const editor = { noteId, context, token: adding ? crypto.randomUUID() : parts.marker.token, state, layer, chip, adding };
  editor.panel = buildTemporaryNoteControls(state, () => {
    state.error = '';
    renderTemporaryNoteExpiryEditor(editor);
  });
  const actions = createOwnElement('div');
  actions.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
  editor.cancel = createOwnElement('button');
  editor.cancel.type = 'button';
  editor.cancel.textContent = 'Cancel';
  editor.save = createOwnElement('button');
  editor.save.type = 'button';
  editor.save.textContent = 'Save';
  [editor.cancel, editor.save].forEach((button) => {
    button.style.cssText = 'font:inherit;cursor:pointer;padding:2px 10px;border-radius:6px;background:transparent;color:inherit;'
      + 'border:1px solid color-mix(in srgb,currentColor 32%,transparent);';
  });
  actions.append(editor.cancel, editor.save);
  layer.append(editor.panel.controls, actions);
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart'].forEach((type) => {
    layer.addEventListener(type, event => event.stopPropagation());
  });
  editor.place = () => {
    if (!chip.isConnected) return closeTemporaryNoteExpiryEditor();
    const rect = chip.getBoundingClientRect();
    const height = layer.offsetHeight;
    const room = window.innerHeight - rect.bottom;
    const above = room < height + 4 && rect.top > room;
    layer.style.left = `${Math.round(Math.max(4, Math.min(rect.left, window.innerWidth - layer.offsetWidth - 4)))}px`;
    layer.style.top = `${Math.round(above ? Math.max(4, rect.top - height - 4) : rect.bottom + 4)}px`;
  };
  editor.onOutside = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const inside = path.some(node => node === layer || node === chip || (node.classList
      && (node.classList.contains('isa-temporary-note-menu') || node.classList.contains('isa-temporary-note-calendar'))));
    if (!inside && state.status !== 'pending') closeTemporaryNoteExpiryEditor();
  };
  editor.onKey = (event) => {
    if (event.key !== 'Escape' || state.status === 'pending') return;
    if (ISA_NOTE_CONTROLS.openSelectLayer() || editor.panel.calendar.isOpen()) return;
    closeTemporaryNoteExpiryEditor();
    chip.focus();
  };
  layer.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !event.target.matches('input')) return;
    event.preventDefault();
    event.stopPropagation();
    if (!editor.save.disabled) saveTemporaryNoteExpiry(editor);
  });
  editor.cancel.addEventListener('click', () => { closeTemporaryNoteExpiryEditor(); chip.focus(); });
  editor.save.addEventListener('click', () => saveTemporaryNoteExpiry(editor));
  document.body.append(layer);
  temporaryNoteExpiryEditor = editor;
  temporaryNoteApplyTheme(editor.panel);
  renderTemporaryNoteExpiryEditor(editor);
  editor.place();
  window.addEventListener('scroll', editor.place, true);
  window.addEventListener('resize', editor.place);
  document.addEventListener('pointerdown', editor.onOutside, true);
  document.addEventListener('keydown', editor.onKey, true);
  editor.panel.toggle.focus();
}

async function writeTemporaryNoteExpiry({ context, noteId, token }, expiresAt, mode) {
  const query = { app_id: context.workspace };
  const read = await noteRuntimeRequest('/ember/inbox/notes', { ...query, 'ids[]': [noteId] }, 'GET');
  const note = read.ok ? noteRuntimeNote(await noteRuntimeJson(read), noteId) : null;
  if (!note) return { ok: false, error: 'This note could not be read. Refresh the page and try again.' };
  const footer = ISA_TEMPORARY_NOTES.parseFooter(note.body);
  if (mode === 'repair' && footer !== null) return { ok: true };
  if (mode === 'add' && footer !== null) return { ok: false, error: 'This note changed. Refresh the page and try again.' };
  if (mode === 'change' && (!footer || !footer.valid || footer.token !== token || footer.workspaceId !== context.workspace
    || footer.contactId !== context.contact)) return { ok: false, error: 'This note changed. Refresh the page and try again.' };
  const text = mode === 'change' ? footer.body : note.body;
  const body = expiresAt === null ? text : ISA_TEMPORARY_NOTES.appendFooter(text,
    { workspaceId: context.workspace, contactId: context.contact, expiresAt, token });
  if (typeof body !== 'string') return { ok: false, error: 'That date could not be saved. Pick another one.' };
  if (body === note.body) return { ok: true };
  const response = await fetch(noteRuntimeUrl(`/ember/inbox/notes/${noteId}`, query), {
    method: 'PUT',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: noteRuntimeRequestHeaders(),
    body: JSON.stringify({ body, app_id: context.workspace })
  });
  if (!response.ok) return { ok: false, error: 'The date was not saved. Try again.' };
  const saved = await noteRuntimeJson(response);
  return saved && saved.body === body ? { ok: true, written: true } : { ok: false, uncertain: true };
}

async function repairTemporaryNoteEdit(noteId, edit) {
  if (temporaryNoteEditChecks.get(noteId) !== edit) return;
  temporaryNoteEditChecks.delete(noteId);
  try {
    const result = await writeTemporaryNoteExpiry({ context: edit.context, noteId, token: edit.token }, edit.expiresAt, 'repair');
    if (result.ok && !result.written) return;
    if (!result.ok) return debugLog('[Temporary note] the expiry could not be restored after an edit');
    temporaryNoteExpiryOverrides.set(noteId, { token: edit.token, expiresAt: edit.expiresAt, restored: true });
    refreshTemporaryNoteFooters();
  } catch (error) {
    debugLog('[Temporary note] the expiry check after an edit failed');
  }
}

async function saveTemporaryNoteExpiry(editor) {
  const state = editor.state;
  const instant = state.enabled ? temporaryNoteInstant(state) : null;
  if (state.enabled && !instant) return;
  const expiresAt = instant ? instant.expiresAt : null;
  state.status = 'pending';
  state.error = '';
  renderTemporaryNoteExpiryEditor(editor);
  let result;
  try {
    result = await writeTemporaryNoteExpiry(editor, expiresAt, editor.adding ? 'add' : 'change');
  } catch (error) {
    result = { ok: false, uncertain: true };
  }
  if (temporaryNoteExpiryEditor !== editor) return;
  if (!result.ok) {
    state.status = result.uncertain ? 'uncertain' : 'idle';
    state.error = result.error || '';
    renderTemporaryNoteExpiryEditor(editor);
    return;
  }
  if (!editor.adding || expiresAt) {
    temporaryNoteExpiryOverrides.set(editor.noteId, { token: editor.token, expiresAt, restored: editor.adding });
  }
  closeTemporaryNoteExpiryEditor();
  refreshTemporaryNoteFooters();
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

function temporaryNoteEditorFooter(textarea, context) {
  const footer = ISA_TEMPORARY_NOTES.parseFooter(textarea.value);
  return footer && footer.valid && footer.workspaceId === context.workspace && footer.contactId === context.contact
    ? footer : null;
}

function temporaryNoteEditorExpiry(noteId, footer) {
  const override = temporaryNoteExpiryOverrides.get(noteId);
  return override && override.token === footer.token ? override.expiresAt : footer.expiresAtIso;
}

function refreshTemporaryNoteEditors() {
  injectStyleOnce(TEMPORARY_NOTE_EDIT_STYLE_ID, TEMPORARY_NOTE_EDIT_CSS);
  const context = temporaryNoteContext();
  const textareas = context
    ? [...context.sidebar.querySelectorAll('[data-testid^="note-"] textarea[aria-label="Edit note"]')]
      .filter(temporaryNoteElementVisible)
    : [];
  for (const textarea of textareas) {
    const noteId = /^note-(\d{1,32})$/.exec(textarea.closest('[data-testid^="note-"]').getAttribute('data-testid'))?.[1];
    const known = noteId ? temporaryNoteEditors.get(noteId) : null;
    if (!noteId || known?.textarea === textarea) continue;
    const footer = temporaryNoteEditorFooter(textarea, context);
    if (known?.kept && !footer) {
      known.textarea = textarea;
      textarea.setAttribute(TEMPORARY_NOTE_EDIT_READY_ATTRIBUTE, '');
      if (known.chip) textarea.after(known.chip);
      continue;
    }
    const expiresAt = footer ? temporaryNoteEditorExpiry(noteId, footer) : null;
    const opened = { textarea, context, kept: false, token: footer ? footer.token : null, expiresAt };
    temporaryNoteEditors.set(noteId, opened);
    if (expiresAt) {
      temporaryNotePost({ kind: 'edit-keep', workspace: context.workspace, contact: context.contact,
        noteId, token: footer.token, expiresAt });
      verifyTemporaryNoteEditor(noteId, opened);
    } else {
      temporaryNotePost({ kind: 'edit-forget', noteId });
      if (footer) hideTemporaryNoteEditorFooter(noteId);
      textarea.setAttribute(TEMPORARY_NOTE_EDIT_READY_ATTRIBUTE, '');
    }
  }
  for (const [noteId, editor] of temporaryNoteEditors) {
    if (editor.textarea.isConnected) continue;
    if (editor.chip) editor.chip.remove();
    temporaryNoteEditors.delete(noteId);
    if (!editor.kept || !editor.expiresAt) continue;
    const edit = { context: editor.context, token: editor.token, expiresAt: editor.expiresAt };
    temporaryNoteEditChecks.set(noteId, edit);
    setTimeout(() => repairTemporaryNoteEdit(noteId, edit), TEMPORARY_NOTE_EDIT_CHECK_MS);
  }
}

function observeTemporaryNoteServerBody(noteId, body) {
  const card = temporaryNoteCard(noteId);
  const shown = card ? card.querySelector('[data-testid="note-body"]') : null;
  if (!shown || typeof body !== 'string') return;
  const footer = ISA_TEMPORARY_NOTES.parseFooter(body);
  if (footer && !footer.valid) return;
  const parts = temporaryNoteFooterParts(shown);
  const known = temporaryNoteExpiryOverrides.get(noteId);
  const expiresAt = footer ? footer.expiresAtIso : null;
  const pageExpiresAt = parts ? parts.marker.expiresAtIso : null;
  if ((known ? known.expiresAt : pageExpiresAt) === expiresAt) return;
  if (pageExpiresAt === expiresAt) temporaryNoteExpiryOverrides.delete(noteId);
  else {
    temporaryNoteExpiryOverrides.set(noteId, { token: footer ? footer.token : parts.marker.token, expiresAt, restored: !parts });
  }
  refreshTemporaryNoteFooters();
}

async function verifyTemporaryNoteEditor(noteId, editor) {
  let note = null;
  try {
    const read = await noteRuntimeRequest('/ember/inbox/notes', { app_id: editor.context.workspace, 'ids[]': [noteId] }, 'GET');
    note = read.ok ? noteRuntimeNote(await noteRuntimeJson(read), noteId) : null;
  } catch (error) {
    return;
  }
  if (!note || temporaryNoteEditors.get(noteId) !== editor) return;
  const footer = ISA_TEMPORARY_NOTES.parseFooter(note.body);
  if (footer && (!footer.valid || footer.token !== editor.token)) return;
  const expiresAt = footer ? footer.expiresAtIso : null;
  observeTemporaryNoteServerBody(noteId, note.body);
  if (expiresAt === editor.expiresAt) return;
  editor.expiresAt = expiresAt;
  if (!expiresAt) {
    temporaryNotePost({ kind: 'edit-forget', noteId });
    if (editor.chip) editor.chip.remove();
    editor.chip = null;
    return;
  }
  temporaryNotePost({ kind: 'edit-keep', workspace: editor.context.workspace, contact: editor.context.contact,
    noteId, token: editor.token, expiresAt });
  if (!editor.chip) return;
  editor.chip.textContent = ISA_TEMPORARY_NOTES.formatSummary(expiresAt);
  editor.chip.title = ISA_TEMPORARY_NOTES.formatLocalHint(expiresAt) || '';
}

function hideTemporaryNoteEditorFooter(noteId) {
  const editor = temporaryNoteEditors.get(String(noteId));
  if (!editor || !editor.textarea.isConnected) return;
  editor.textarea.setAttribute(TEMPORARY_NOTE_EDIT_READY_ATTRIBUTE, '');
  const footer = temporaryNoteEditorFooter(editor.textarea, editor.context);
  if (!footer) return;
  editor.kept = true;
  const caret = Math.min(editor.textarea.selectionStart ?? footer.body.length, footer.body.length);
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor.textarea, footer.body);
  editor.textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  if (typeof editor.textarea.setSelectionRange === 'function') editor.textarea.setSelectionRange(caret, caret);
  if (editor.textarea.style.height) {
    editor.textarea.style.height = 'auto';
    editor.textarea.style.height = `${editor.textarea.scrollHeight}px`;
  }
  const expiresAt = editor.expiresAt;
  if (!expiresAt) return;
  editor.chip = createOwnElement('span');
  editor.chip.className = TEMPORARY_NOTE_CHIP_CLASS;
  editor.chip.style.cssText = TEMPORARY_NOTE_CHIP_STYLE;
  editor.chip.textContent = ISA_TEMPORARY_NOTES.formatSummary(expiresAt);
  editor.chip.title = ISA_TEMPORARY_NOTES.formatLocalHint(expiresAt) || '';
  editor.textarea.after(editor.chip);
}

function refreshTemporaryNoteFooters() {
  for (const body of queryAllIntercom('[data-testid="note-body"]')) {
    if (body.isConnected) maskTemporaryNoteFooter(body);
  }
  refreshTemporaryNoteEditors();
}

function refreshTemporaryNoteControls() {
  ISA_NOTE_CONTROLS.selectTriggerLost();
  if (temporaryNotePanel && !temporaryNotePanel.calendar.trigger.isConnected) temporaryNotePanel.calendar.close();
  const context = temporaryNoteContext();
  const sections = context ? [...context.sidebar.querySelectorAll(
    '[data-test-sidebar-section-item="notes"][data-sidebar-section-id="notes"] [data-testid="notes-section"]'
  )].filter(temporaryNoteElementVisible) : [];
  const section = sections.length === 1 ? sections[0] : null;
  const inputs = section ? [...section.querySelectorAll('textarea[data-testid="note-input"]')]
    .filter(temporaryNoteElementVisible) : [];
  const input = inputs.length === 1 ? inputs[0] : null;
  if (temporaryNotePanel && context?.key === temporaryNotePanel.key && input === temporaryNotePanel.input
    && temporaryNotePanel.controls.isConnected) {
    if (temporaryNotePanel.hostTheme !== isaHostTheme()) temporaryNoteApplyTheme(temporaryNotePanel);
    return;
  }
  if (temporaryNotePanel && context?.key === temporaryNotePanel.key
    && temporaryNoteInteracting(temporaryNotePanel)) return;
  if (temporaryNotePanel) {
    const old = temporaryNotePanel;
    ISA_NOTE_CONTROLS.closeSelect();
    old.calendar.close();
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
  if (data.kind === 'temporary-note-edit') {
    if (!NOTE_CARD_ID_TOKEN.test(String(data.noteId))) return;
    if (data.status === 'kept') hideTemporaryNoteEditorFooter(data.noteId);
    else temporaryNoteEditors.get(String(data.noteId))?.textarea.setAttribute(TEMPORARY_NOTE_EDIT_READY_ATTRIBUTE, '');
    return;
  }
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
      state.amount = '36';
      state.unit = 'hours';
      state.day = '';
      state.dayInput = null;
      state.time = '';
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
  closeMenu: ISA_NOTE_CONTROLS.closeSelect,
  observeServerBody: observeTemporaryNoteServerBody,
  expiryEditor: () => temporaryNoteExpiryEditor,
  openMenuLayer: ISA_NOTE_CONTROLS.openSelectLayer,
  refresh: refreshTemporaryNoteControls,
  refreshFooters: refreshTemporaryNoteFooters,
  hideDeletedCard: hideDeletedTemporaryNoteCard,
  init: initTemporaryNoteControls,
  getPanel: () => temporaryNotePanel,
  getDraft: key => temporaryNoteDrafts.get(key),
  isPaused: () => temporaryNoteCleanupPaused
};
