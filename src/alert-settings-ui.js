
(function () {
  'use strict';

  if (window.ISA_ALERT_SETTINGS) return;

  const FALLBACK_ROSTER = [
    { id: '900101', label: 'Urgent Alderpoint' },
    { id: '900102', label: 'Urgent Brightwell' }
  ];
  const DEFAULT_SOUND = (window.ISA_ALERT_SOUNDS && window.ISA_ALERT_SOUNDS.defaultId) || 'tritone';

  const PLATFORMS = {
    intercom: {
      keys: {
        enabled: 'isaAlertEnabled',
        items: 'isaAlertEnabledInboxes',
        roster: 'isaAlertRoster',
        sound: 'isaAlertSound',
        yourInbox: 'isaAlertYourInbox'
      },
      yourInboxLabel: 'Your inbox',
      title: 'Intercom',
      heading: 'New-message alerts',
      itemsLabel: 'Alert me for these urgent inboxes',
      filterPlaceholder: 'Filter inboxes…',
      hint: 'Showing default inboxes. Open Intercom once and your full urgent inbox list fills in here automatically.',
      soundGuidance: 'No sound? Click inside the Intercom tab, then test again.',
      compactHeading: 'Intercom alerts',
      rosterField: 'alertRoster',
      groupsField: 'alertGroups',
      fallbackRoster: FALLBACK_ROSTER,
      discoversRoster: true,
      shortLabel: (label) => (label || '').replace(alertInboxPattern(), '').trim() || label || '',
      defaultSelection: () => []
    }
  };

  function alertInboxPattern() {
    const source = window.SIGNATURE_DATA && window.SIGNATURE_DATA.alertInboxPattern;
    try {
      return new RegExp(typeof source === 'string' && source ? source : '^urgent\\b', 'i');
    } catch (error) {
      return /^urgent\b/i;
    }
  }

  function resolvePlatform(container) {
    const name = container && container.getAttribute
      ? container.getAttribute('data-isa-platform')
      : null;
    return PLATFORMS[name] || PLATFORMS.intercom;
  }

  function seedData(platform) {
    const data = window.SIGNATURE_DATA && window.SIGNATURE_DATA[platform.rosterField];
    return Array.isArray(data) ? data : null;
  }

  function seedRoster(platform) {
    const data = seedData(platform);
    if (data && data.length) {
      return data
        .map((item) => (typeof item === 'string'
          ? { id: item, label: item }
          : (item && item.teamId ? { id: String(item.teamId), label: item.label || String(item.teamId) } : null)))
        .filter(Boolean);
    }
    return platform.fallbackRoster.slice();
  }

  function seedGroups(platform) {
    const data = window.SIGNATURE_DATA && window.SIGNATURE_DATA[platform.groupsField];
    if (!Array.isArray(data)) return [];
    return data
      .filter((group) => group && Array.isArray(group.ids) && group.ids.length)
      .map((group) => ({
        key: group.ids.map(String).join('|'),
        label: String(group.label || group.ids[0]),
        detail: Array.isArray(group.detail) ? group.detail.map(String) : [],
        ids: group.ids.map(String)
      }));
  }

  function hasSeedData(platform) {
    const data = seedData(platform);
    return !!(data && data.length);
  }
  const STYLE_ID = 'isa-alert-settings-style';
  const FILTER_THRESHOLD = 12;

  const CSS = `
    .isa-alert-settings { margin-top: 14px; text-align: left; }
    .isa-alert-settings[data-isa-mode="compact"] {
      display: flex; flex-direction: column; gap: 8px;
    }
    .isa-alert-summary { font-size: 12px; color: var(--ink-muted, #5b6472); line-height: 1.5; }
    .isa-alert-summary p { margin: 0 0 4px; }
    .isa-alert-summary strong { color: var(--ink, #14181f); }
    .isa-alert-summary summary { cursor: pointer; min-height: 24px; }
    .isa-alert-summary .isa-alert-change {
      min-height: 24px; padding: 0; border: 0; background: none; cursor: pointer;
      font: inherit; font-weight: 700; color: var(--link, var(--accent, #1d4ed8)); text-decoration: underline;
    }
    .isa-alert-summary .isa-alert-change:focus-visible { outline: 2px solid var(--accent, #1d4ed8); outline-offset: 2px; }
    .isa-alert-summary .isa-alert-names { max-height: 72px; overflow: auto; overflow-wrap: anywhere; }
    .isa-alert-settings[data-isa-mode="expanded"] {
      max-width: none; margin: 0; padding: 0;
      background: transparent; border: 0; border-radius: 0; box-shadow: none;
    }
    .isa-alert-settings .isa-alert-toggle {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px;
      font-size: 14px; font-weight: 700; color: var(--ink, #111827); cursor: pointer;
    }
    .isa-alert-settings .isa-alert-toggle input {
      appearance: none; flex-shrink: 0; width: 40px; height: 24px; margin: 0; position: relative;
      border: 1px solid var(--ink-muted, #5b6472); border-radius: 999px;
      background: var(--surface-2, #e9edf2); cursor: pointer;
    }
    .isa-alert-settings .isa-alert-toggle input::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
      border-radius: 50%; background: var(--ink-muted, #5b6472); transition: transform 120ms ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .isa-alert-settings .isa-alert-toggle input::after { transition: none; }
    }
    .isa-alert-settings .isa-alert-toggle input:checked { background: var(--accent, #1d4ed8); border-color: var(--accent, #1d4ed8); }
    .isa-alert-settings .isa-alert-toggle input:checked::after { transform: translateX(16px); background: var(--accent-ink, #fff); }
    .isa-alert-settings .isa-alert-toggle input:disabled { opacity: 0.55; }
    .isa-alert-settings .isa-alert-body { margin-top: 10px; }
    .isa-alert-settings .isa-alert-body[hidden] { display: none; }
    .isa-alert-settings[data-isa-mode="compact"] .isa-alert-toggle {
      justify-content: space-between; min-height: 36px; padding: 0 10px;
      border: 1px solid var(--hairline, #e2e6ec); border-radius: 8px;
      background: var(--surface, #fff);
    }
    .isa-alert-settings .isa-alert-toggle input:disabled { cursor: wait; }
    .isa-alert-settings .isa-alert-body.isa-alert-disabled { opacity: 0.55; }
    .isa-alert-settings .isa-alert-section-label {
      font-size: 12px; font-weight: 700;
      color: var(--ink-muted, #6b7280); margin: 10px 0 6px;
    }
    .isa-alert-settings .isa-alert-filter {
      width: 100%; max-width: 190px; box-sizing: border-box;
      border: 1px solid var(--hairline, #d7dce5); border-radius: 8px; padding: 4px 7px;
      min-height: 36px; font-size: 12px; color: var(--ink, #111827); background: var(--surface-2, #fff); margin-bottom: 6px;
    }
    .isa-alert-settings .isa-alert-inboxes {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 2px 14px; max-height: 220px; overflow: auto;
    }
    .isa-alert-settings .isa-alert-inbox {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; color: var(--ink, #111827); min-height: 36px; cursor: pointer;
    }
    .isa-alert-settings .isa-alert-inbox input { width: 15px; height: 15px; cursor: pointer; }
    .isa-alert-settings .isa-alert-inbox span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .isa-alert-settings .isa-alert-inboxes.isa-alert-grouped { grid-template-columns: 1fr; max-height: none; }
    .isa-alert-settings .isa-alert-grouped .isa-alert-inbox { flex-wrap: wrap; column-gap: 8px; row-gap: 0; }
    .isa-alert-settings .isa-alert-grouped .isa-alert-inbox span { white-space: normal; }
    .isa-alert-settings .isa-alert-grouped .isa-alert-inbox .isa-alert-name { font-weight: 700; }
    .isa-alert-settings .isa-alert-inbox .isa-alert-detail { font-size: 12px; color: var(--ink-muted, #6b7280); }
    .isa-alert-settings .isa-alert-title {
      padding-bottom: 12px; border-bottom: 1px solid var(--hairline, #e2e6ec);
    }
    .isa-alert-settings .isa-alert-title span { font-size: 18px; }
    .isa-alert-settings .isa-alert-list {
      margin-top: 12px; padding-top: 2px; border-top: 1px solid var(--hairline, #e2e6ec);
    }
    .isa-alert-settings .isa-alert-hint { font-size: 11px; color: var(--ink-muted, #9ca3af); margin: 4px 0; }
    .isa-alert-settings .isa-alert-sound { display: flex; gap: 8px; align-items: center; }
    .isa-alert-settings .isa-alert-sound select {
      flex: 1; border: 1px solid var(--hairline, #d7dce5); border-radius: 8px; padding: 7px 8px;
      min-height: 36px; font-size: 14px; color: var(--ink, #111827); background: var(--surface-2, #fff);
    }
    .isa-alert-settings .isa-alert-play {
      flex: 0 0 auto; width: 36px; height: 36px; padding: 0; border: 0;
      border-radius: 8px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--accent, #1d4ed8); color: var(--accent-ink, #fff);
    }
    .isa-alert-settings .isa-alert-play:hover { filter: brightness(1.05); }
    .isa-alert-settings .isa-alert-testrow { margin-bottom: 4px; }
    .isa-alert-settings .isa-alert-testrow .isa-alert-section-label { margin-top: 0; }
    .isa-alert-settings .isa-alert-test {
      width: 100%; min-height: 36px; margin-top: 4px; border: 1px solid var(--hairline, #d7dce5);
      border-radius: 8px; padding: 8px 10px; cursor: pointer;
      font-size: 12px; font-weight: 700; color: var(--ink, #111827);
      background: var(--surface-2, #f7f8fa);
    }
    .isa-alert-settings .isa-alert-test:hover { border-color: var(--accent, #2563eb); }
    .isa-alert-settings .isa-alert-test-status {
      margin-top: 6px; font-size: 11px; line-height: 1.5; color: var(--ink-muted, #6b7280);
    }
    .isa-alert-settings .isa-alert-test-status.isa-alert-test-bad { color: var(--accent, #2563eb); }
    .isa-alert-pacing .isa-alert-pacing-row { font-weight: 400; }
    .isa-alert-pacing .isa-alert-mute { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; min-height: 36px; }
    .isa-alert-pacing .isa-alert-mute-label { font-size: 14px; font-weight: 700; color: var(--ink, #14181f); font-variant-numeric: tabular-nums; }
    .isa-alert-pacing .isa-alert-mute-buttons { display: inline-flex; gap: 6px; }
    .isa-alert-pacing .isa-alert-mute-buttons[hidden] { display: none; }
    .isa-alert-pacing .isa-alert-mute-custom { display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 13px; color: var(--ink, #14181f); }
    .isa-alert-pacing .isa-alert-mute-custom[hidden] { display: none; }
    .isa-alert-pacing .isa-alert-mute-custom input {
      width: 56px; min-height: 32px; padding: 4px 8px; border: 1px solid var(--hairline, #e2e6ec); border-radius: 8px;
      background: var(--surface, #ffffff); color: var(--ink, #14181f); font-variant-numeric: tabular-nums;
    }
    .isa-alert-pacing .isa-alert-mute-custom input[aria-invalid="true"] { border-color: var(--block, #b91c1c); }
    .isa-alert-pacing .isa-alert-mute-button {
      min-height: 32px; padding: 4px 10px; border: 1px solid var(--hairline, #e2e6ec); border-radius: 8px;
      background: var(--surface, #ffffff); color: var(--ink, #14181f); font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .isa-alert-pacing .isa-alert-mute-button:hover { border-color: var(--ink-muted, #5b6472); }
    .isa-alert-pacing .isa-alert-quiet { display: flex; gap: 12px; align-items: center; margin: 4px 0 8px; font-size: 13px; color: var(--ink, #14181f); }
    .isa-alert-pacing .isa-alert-quiet input, .isa-alert-pacing .isa-alert-quiet select {
      width: 64px; min-height: 32px; padding: 4px 8px; border: 1px solid var(--hairline, #e2e6ec); border-radius: 8px;
      background: var(--surface, #ffffff); color: var(--ink, #14181f); font-variant-numeric: tabular-nums;
    }
    .isa-alert-pacing .isa-alert-quiet select { width: auto; min-width: 96px; }
    .isa-alert-pacing .isa-alert-quiet label[hidden] { display: none; }
    .isa-alert-pacing .isa-alert-quiet input[aria-invalid="true"] { border-color: var(--block, #b91c1c); }
    .isa-alert-settings .isa-alert-storage-status {
      margin-top: 8px; color: var(--accent, #2563eb); font-size: 12px; line-height: 1.4;
    }
  `;

  function storageLocal() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return chrome.storage.local;
      }
    } catch (error) {}
    return null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function retiredIds() {
    const data = window.SIGNATURE_DATA && window.SIGNATURE_DATA.retiredAlertInboxIds;
    return new Set(Array.isArray(data) ? data.map(String) : []);
  }

  function normalizeRoster(platform, value) {
    const merged = new Map();
    seedRoster(platform).forEach((item) => merged.set(item.id, item));
    if (Array.isArray(value)) {
      value
        .filter((item) => item && item.teamId)
        .forEach((item) => merged.set(String(item.teamId), {
          id: String(item.teamId),
          label: item.label || String(item.teamId)
        }));
    }
    const retired = retiredIds();
    return [...merged.values()].filter((item) => !retired.has(item.id));
  }

  function mount(container) {
    if (!container) return;
    injectStyle();
    container.classList.add('isa-alert-settings');
    const requestedMode = container.getAttribute('data-isa-mode');
    const compact = requestedMode === 'compact' || container.getAttribute('data-isa-compact') === 'true';
    const expanded = requestedMode === 'expanded' || container.getAttribute('data-isa-expanded') === 'true';
    const useCompact = expanded ? false : compact;
    const mode = useCompact ? 'compact' : 'expanded';
    container.setAttribute('data-isa-mode', mode);
    const platform = resolvePlatform(container);
    const KEYS = platform.keys;

    const headerHtml = `<label class="isa-alert-toggle${useCompact ? '' : ' isa-alert-title'}">
      <span>${useCompact ? platform.compactHeading : platform.title}</span>
      <input type="checkbox" role="switch" data-isa="enabled" aria-label="${useCompact ? platform.compactHeading : platform.heading}">
    </label>`;

    const bodyHtml = useCompact ? '' : `<div class="isa-alert-body" data-isa="body">
        <div class="isa-alert-testrow">
          <div class="isa-alert-section-label">Not getting alerts?</div>
          <button type="button" class="isa-alert-test" data-isa="test">Send a test alert</button>
          <div class="isa-alert-test-status" data-isa="testStatus" role="status" aria-live="polite" hidden></div>
          <div class="isa-alert-test-status isa-alert-test-bad" data-isa="popupsOff" role="status" hidden></div>
        </div>
        <div class="isa-alert-section-label">Alert sound</div>
        <div class="isa-alert-sound">
          <select data-isa="sound" aria-label="Alert sound"></select>
          <button type="button" class="isa-alert-play" data-isa="preview" title="Play sound" aria-label="Play sound">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 3l9 5-9 5z" fill="currentColor"></path></svg>
          </button>
        </div>
        <div class="isa-alert-list">
          <div class="isa-alert-section-label">${platform.itemsLabel}</div>
          <input type="text" class="isa-alert-filter" data-isa="filter" aria-label="${platform.itemsLabel}" placeholder="${platform.filterPlaceholder}" hidden>
          <div class="isa-alert-inboxes" data-isa="inboxes"></div>
          <div class="isa-alert-hint" data-isa="hint" hidden>${platform.hint}</div>
        </div>
      </div>`;
    container.innerHTML = `${headerHtml}${bodyHtml}${useCompact ? '<div class="isa-alert-summary" data-isa="summary"></div>' : ''}
      <div class="isa-alert-storage-status" data-isa="storageStatus" role="status" aria-live="polite" hidden></div>`;

    const enabledEl = container.querySelector('[data-isa="enabled"]');
    const bodyEl = container.querySelector('[data-isa="body"]');
    const filterEl = container.querySelector('[data-isa="filter"]');
    const inboxesEl = container.querySelector('[data-isa="inboxes"]');
    const hintEl = container.querySelector('[data-isa="hint"]');
    const soundEl = container.querySelector('[data-isa="sound"]');
    const previewEl = container.querySelector('[data-isa="preview"]');
    const testEl = container.querySelector('[data-isa="test"]');
    const testStatusEl = container.querySelector('[data-isa="testStatus"]');
    const popupsOffEl = container.querySelector('[data-isa="popupsOff"]');
    const storageStatusEl = container.querySelector('[data-isa="storageStatus"]');

    if (!useCompact) {
      const presets = (window.ISA_ALERT_SOUNDS && window.ISA_ALERT_SOUNDS.presets) || [{ id: DEFAULT_SOUND, label: 'Default' }];
      presets.forEach((preset) => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label;
        soundEl.appendChild(option);
      });
    }

    const store = storageLocal();
    const groups = seedGroups(platform);
    const grouped = groups.length > 0;
    const offeredIds = new Set(groups.flatMap((group) => group.ids));
    const initialRoster = seedRoster(platform);
    const state = {
      enabled: false,
      inboxes: platform.defaultSelection(initialRoster),
      roster: initialRoster,
      yourInbox: true,
      sound: DEFAULT_SOUND,
      loaded: false,
      loadFailed: false
    };
    const confirmed = {
      enabled: state.enabled,
      inboxes: state.inboxes.slice(),
      yourInbox: state.yourInbox,
      sound: state.sound
    };
    const pending = Object.create(null);
    let writeSequence = 0;

    function setStorageStatus(message) {
      storageStatusEl.hidden = !message;
      storageStatusEl.textContent = message || '';
    }

    function runtimeStorageError() {
      try {
        return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError
          ? chrome.runtime.lastError
          : null;
      } catch (error) {
        return null;
      }
    }

    function write(key, value, confirm, restore) {
      if (!store) {
        restore();
        setStorageStatus('Alert settings storage is unavailable. Your previous setting was restored.');
        return;
      }
      const token = ++writeSequence;
      pending[key] = token;
      let settledWrite = false;
      const finish = (error) => {
        if (settledWrite || pending[key] !== token) return;
        settledWrite = true;
        delete pending[key];
        if (error) {
          restore();
          setStorageStatus('Could not save alert settings. Your previous setting was restored.');
        } else {
          confirm();
          setStorageStatus('');
        }
      };
      const callback = () => finish(runtimeStorageError());
      try {
        const result = store.set({ [key]: value }, callback);
        if (result && typeof result.then === 'function') {
          result.then(() => finish(null), () => finish(new Error('storage write failed')));
        }
      } catch (error) {
        finish(error);
      }
    }

    function yourInboxRow() {
      const wrap = document.createElement('label');
      wrap.className = 'isa-alert-inbox';
      wrap.title = platform.yourInboxLabel;
      wrap.dataset.label = platform.yourInboxLabel.toLowerCase();
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.isaYourInbox = 'true';
      checkbox.checked = state.yourInbox;
      checkbox.addEventListener('change', () => {
        if (!state.loaded) return;
        const next = checkbox.checked;
        state.yourInbox = next;
        applyEnabledUi();
        write(KEYS.yourInbox, next, () => {
          confirmed.yourInbox = next;
        }, () => {
          state.yourInbox = confirmed.yourInbox;
          renderInboxes();
          applyEnabledUi();
        });
      });
      const span = document.createElement('span');
      span.className = 'isa-alert-name';
      span.textContent = platform.yourInboxLabel;
      wrap.appendChild(checkbox);
      wrap.appendChild(span);
      return wrap;
    }

    function applyFilter() {
      if (useCompact) return;
      const query = (filterEl.value || '').trim().toLowerCase();
      inboxesEl.querySelectorAll('.isa-alert-inbox').forEach((row) => {
        const label = row.dataset.label || '';
        row.style.display = !query || label.includes(query) ? '' : 'none';
      });
    }

    function offeredItems() {
      if (grouped) return groups;
      return state.roster.map((inbox) => ({
        key: String(inbox.id),
        label: platform.shortLabel(inbox.label),
        detail: [],
        ids: [String(inbox.id)]
      }));
    }

    function offeredSelection(ids) {
      return grouped ? ids.filter((id) => offeredIds.has(id)) : ids;
    }

    function renderInboxes() {
      if (useCompact) return;
      const fallback = platform.fallbackRoster;
      const hasRealRoster = Array.isArray(state.roster) && state.roster.length > 0
        && !(state.roster.length === fallback.length
          && state.roster.every((r, i) => r.id === fallback[i].id));
      const items = offeredItems();
      hintEl.hidden = grouped || hasSeedData(platform) || hasRealRoster;
      filterEl.hidden = items.length <= FILTER_THRESHOLD;
      inboxesEl.classList.toggle('isa-alert-grouped', grouped);
      inboxesEl.innerHTML = '';
      if (KEYS.yourInbox) inboxesEl.appendChild(yourInboxRow());
      items.forEach((item) => {
        const wrap = document.createElement('label');
        wrap.className = 'isa-alert-inbox';
        wrap.title = item.detail.length ? `${item.label} (${item.detail.join(', ')})` : item.label;
        wrap.dataset.label = wrap.title.toLowerCase();
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.key;
        const selectedCount = item.ids.filter((id) => state.inboxes.includes(id)).length;
        checkbox.checked = selectedCount === item.ids.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < item.ids.length;
        checkbox.addEventListener('change', onInboxChange);
        const span = document.createElement('span');
        span.className = 'isa-alert-name';
        span.textContent = item.label;
        wrap.appendChild(checkbox);
        wrap.appendChild(span);
        if (item.detail.length) {
          const detail = document.createElement('span');
          detail.className = 'isa-alert-detail';
          detail.textContent = `(${item.detail.join(', ')})`;
          wrap.appendChild(detail);
        }
        inboxesEl.appendChild(wrap);
      });
      if (!filterEl.hidden) applyFilter();
    }

    function renderSummary() {
      if (!useCompact) return;
      const summary = container.querySelector('[data-isa="summary"]');
      const wasOpen = !!summary.querySelector('details[open]');
      summary.replaceChildren();
      if (!state.loaded || state.loadFailed) {
        summary.textContent = state.loadFailed ? 'Selection unavailable.' : 'Loading selection…';
        return;
      }
      const selected = new Set(state.inboxes);
      const roster = offeredItems().map(item => ({ ids: item.ids, label: item.label }));
      if (!grouped) {
        state.inboxes.filter(id => !roster.some(item => item.ids.includes(id))).forEach(id => roster.push({ ids: [id], label: id }));
      }
      if (KEYS.yourInbox) {
        roster.unshift({ ids: ['your-inbox'], label: platform.yourInboxLabel });
        if (state.yourInbox) selected.add('your-inbox');
      }
      const isOn = item => item.ids.some(id => selected.has(id));
      const on = roster.filter(isOn).map(item => item.label);
      const off = roster.filter(item => !isOn(item)).map(item => item.label);
      const heading = document.createElement('p');
      const label = document.createElement('strong');
      label.textContent = state.enabled ? 'Selected: ' : 'Alerts off. Selected: ';
      heading.appendChild(label);
      const names = document.createElement('span');
      names.textContent = on.length ? on.join(', ') : 'None';
      heading.appendChild(names);
      heading.className = 'isa-alert-names';
      const change = document.createElement('button');
      change.type = 'button';
      change.className = 'isa-alert-change';
      change.textContent = 'Change';
      change.setAttribute('aria-label', `Change ${platform.compactHeading} selection in Settings`);
      change.addEventListener('click', () => {
        const failed = () => setStorageStatus('Could not open Settings. Try again.');
        try {
          chrome.runtime.sendMessage({ type: 'open-preview', section: 'settings' }, () => {
            if (chrome.runtime.lastError) failed();
          });
        } catch (error) {
          failed();
        }
      });
      summary.appendChild(heading);
      if (off.length) {
        const details = document.createElement('details');
        details.open = wasOpen;
        const title = document.createElement('summary');
        title.textContent = `Not selected: ${off.length} inboxes`;
        const list = document.createElement('p');
        list.className = 'isa-alert-names';
        list.textContent = off.join(', ');
        details.append(title, list);
        summary.appendChild(details);
      }
      summary.appendChild(change);
    }

    function applyEnabledUi() {
      enabledEl.checked = state.enabled;
      enabledEl.disabled = !state.loaded || state.loadFailed;
      if (useCompact) {
        renderSummary();
        return;
      }
      const disabled = !state.loaded || !state.enabled;
      bodyEl.classList.toggle('isa-alert-disabled', disabled);
      bodyEl.querySelectorAll('input, select, button').forEach((control) => {
        control.disabled = disabled;
      });
    }

    function onInboxChange() {
      if (!state.loaded) return;
      const boxes = [...inboxesEl.querySelectorAll('input[type="checkbox"]:not([data-isa-your-inbox])')];
      const itemsByKey = new Map(offeredItems().map(item => [item.key, item]));
      const idsOf = cb => (itemsByKey.get(cb.value) || { ids: [cb.value] }).ids;
      const rendered = new Set(boxes.flatMap(idsOf));
      state.inboxes = offeredSelection(boxes.filter(cb => cb.checked).flatMap(idsOf)
        .concat(state.inboxes.filter(id => !rendered.has(id))));
      const next = state.inboxes.slice();
      write(KEYS.items, next, () => {
        confirmed.inboxes = next.slice();
      }, () => {
        state.inboxes = confirmed.inboxes.slice();
        renderInboxes();
        applyEnabledUi();
      });
    }

    enabledEl.addEventListener('change', () => {
      if (!state.loaded) return;
      const next = enabledEl.checked;
      state.enabled = next;
      applyEnabledUi();
      write(KEYS.enabled, next, () => {
        confirmed.enabled = next;
      }, () => {
        state.enabled = confirmed.enabled;
        applyEnabledUi();
      });
    });

    if (!useCompact && filterEl) filterEl.addEventListener('input', applyFilter);

    if (!useCompact) {
      soundEl.addEventListener('change', () => {
        if (!state.loaded) return;
        const next = soundEl.value;
        state.sound = next;
        write(KEYS.sound, next, () => {
          confirmed.sound = next;
        }, () => {
          state.sound = confirmed.sound;
          soundEl.value = confirmed.sound;
        });
      });

      previewEl.addEventListener('click', () => {
        if (window.ISA_ALERT_SOUNDS && typeof window.ISA_ALERT_SOUNDS.play === 'function') {
          window.ISA_ALERT_SOUNDS.play(soundEl.value);
        }
      });

      const POPUPS_OFF = 'Notifications are turned off for this extension, so alerts only play the sound. To get them back, export your settings in Tools, remove the extension and add it again, then import them.';
      if (typeof chrome !== 'undefined' && chrome.notifications && typeof chrome.notifications.getPermissionLevel === 'function') {
        try {
          chrome.notifications.getPermissionLevel((level) => {
            if (chrome.runtime && chrome.runtime.lastError) return;
            popupsOffEl.textContent = POPUPS_OFF;
            popupsOffEl.hidden = level !== 'denied';
          });
        } catch (error) {}
      }
      const GUIDANCE = 'No banner? Allow notifications for your browser in system settings and turn off Do Not Disturb. ' + platform.soundGuidance;
      function setTestStatus(text, bad) {
        testStatusEl.hidden = false;
        testStatusEl.textContent = text;
        testStatusEl.classList.toggle('isa-alert-test-bad', !!bad);
      }
      function describeTestResult(resp) {
        if (!resp || resp.level === 'unavailable') {
          setTestStatus('This browser cannot show notifications.', true);
        } else if (resp.level === 'denied') {
          setTestStatus(POPUPS_OFF, true);
        } else if (!resp.ok) {
          setTestStatus('Notification blocked. ' + GUIDANCE, true);
        } else {
          setTestStatus('Test sent. ' + GUIDANCE, false);
        }
      }

      testEl.addEventListener('click', () => {
        if (window.ISA_ALERT_SOUNDS && typeof window.ISA_ALERT_SOUNDS.play === 'function') {
          window.ISA_ALERT_SOUNDS.play(soundEl.value);
        }
        setTestStatus('Testing…', false);
        let sent = false;
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'alert-test' }, (resp) => {
              if (chrome.runtime.lastError) {
                setTestStatus('Could not reach the extension to send a test. Try reloading the extension.', true);
                return;
              }
              describeTestResult(resp);
            });
            sent = true;
          }
        } catch (error) {}
        if (!sent) setTestStatus('Testing works only inside the extension.', true);
      });
    }

    function renderAll() {
      if (!useCompact) {
        soundEl.value = state.sound;
        renderInboxes();
      }
      applyEnabledUi();
    }

    renderAll();
    if (store) {
      const defaults = {
        [KEYS.enabled]: false,
        [KEYS.items]: platform.defaultSelection(initialRoster),
        [KEYS.sound]: DEFAULT_SOUND
      };
      if (KEYS.roster) defaults[KEYS.roster] = null;
      if (KEYS.yourInbox) defaults[KEYS.yourInbox] = true;

      const onLoad = (result) => {
        const error = runtimeStorageError();
        if (error || !result) {
          state.loadFailed = true;
          state.loaded = true;
          renderAll();
          setStorageStatus('Could not load alert settings. Alert switches are unavailable.');
          return;
        }
        state.enabled = Boolean(result[KEYS.enabled]);
        state.inboxes = Array.isArray(result[KEYS.items])
          ? result[KEYS.items].map(String)
          : platform.defaultSelection(initialRoster);
        state.roster = normalizeRoster(platform, KEYS.roster ? result[KEYS.roster] : null);
        state.sound = result[KEYS.sound] || DEFAULT_SOUND;
        if (KEYS.yourInbox) state.yourInbox = result[KEYS.yourInbox] !== false;
        confirmed.enabled = state.enabled;
        confirmed.inboxes = state.inboxes.slice();
        confirmed.yourInbox = state.yourInbox;
        confirmed.sound = state.sound;
        state.loaded = true;
        renderAll();
        const offered = offeredSelection(state.inboxes);
        if (offered.length !== state.inboxes.length) {
          state.inboxes = offered;
          write(KEYS.items, offered.slice(), () => {
            confirmed.inboxes = offered.slice();
          }, () => {
            state.inboxes = confirmed.inboxes.slice();
            renderAll();
          });
          renderAll();
        }
      };
      try {
        store.get(defaults, onLoad);
      } catch (error) {
        state.loadFailed = true;
        state.loaded = true;
        renderAll();
        setStorageStatus('Could not load alert settings. Alert switches are unavailable.');
      }

      try {
        if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
          chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !changes) return;
            if (KEYS.roster && changes[KEYS.roster]) {
              state.roster = normalizeRoster(platform, changes[KEYS.roster].newValue);
              renderInboxes();
              applyEnabledUi();
            }
            if (changes[KEYS.enabled]) {
              state.enabled = Boolean(changes[KEYS.enabled].newValue);
              confirmed.enabled = state.enabled;
              applyEnabledUi();
            }
            if (changes[KEYS.items]) {
              const next = changes[KEYS.items].newValue;
              state.inboxes = Array.isArray(next) ? next.map(String) : [];
              confirmed.inboxes = state.inboxes.slice();
              renderInboxes();
              applyEnabledUi();
            }
            if (!useCompact && changes[KEYS.sound]) {
              state.sound = changes[KEYS.sound].newValue || DEFAULT_SOUND;
              confirmed.sound = state.sound;
              soundEl.value = state.sound;
            }
            if (KEYS.yourInbox && changes[KEYS.yourInbox]) {
              state.yourInbox = changes[KEYS.yourInbox].newValue !== false;
              confirmed.yourInbox = state.yourInbox;
              renderInboxes();
              applyEnabledUi();
            }
          });
        }
      } catch (error) {}
    } else {
      state.loaded = true;
      state.loadFailed = true;
      renderAll();
      setStorageStatus('Alert settings storage is unavailable. Alert switches are disabled.');
    }
  }


  const PACING_KEYS = {
    repeat: 'isaAlertRepeat',
    repeatMinutes: 'isaAlertRepeatMinutes',
    muteUntil: 'isaAlertMuteUntil',
    quietEnabled: 'isaAlertQuietEnabled',
    quietStart: 'isaAlertQuietStart',
    quietEnd: 'isaAlertQuietEnd'
  };
  const PACING_DEFAULTS = {
    isaAlertRepeat: false,
    isaAlertRepeatMinutes: 3,
    isaAlertMuteUntil: 0,
    isaAlertQuietEnabled: false,
    isaAlertQuietStart: '22:00',
    isaAlertQuietEnd: '07:00'
  };
  const MUTE_MINUTES = [15, 30, 60];
  const REPEAT_MINUTES = [1, 2, 3, 5, 10];

  function validRepeatMinutes(minutes) {
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 60;
  }
  const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const PACING_SAVE_FAILED = 'Could not save this setting. Try again.';

  function clockLabel(at) {
    const when = new Date(at);
    return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  }

  function mountPacing(container) {
    if (!container || container.getAttribute('data-isa-mounted') === 'true') return;
    container.setAttribute('data-isa-mounted', 'true');
    injectStyle();
    container.classList.add('isa-alert-settings', 'isa-alert-pacing');
    const compact = container.getAttribute('data-isa-compact') === 'true';
    container.setAttribute('data-isa-mode', compact ? 'compact' : 'expanded');

    const muteHtml = `<div class="isa-alert-mute" data-isa="mute">
        <span class="isa-alert-mute-label" data-isa="muteLabel">Mute alerts for</span>
        <span class="isa-alert-mute-buttons" data-isa="muteButtons">${MUTE_MINUTES.map(minutes =>
          `<button type="button" class="isa-alert-mute-button" data-isa-mute="${minutes}">${minutes} min</button>`).join('')}<button type="button" class="isa-alert-mute-button" data-isa="muteCustomOpen" aria-expanded="false">Custom</button></span>
        <button type="button" class="isa-alert-mute-button" data-isa="unmute" hidden>Unmute</button>
      </div>
      <div class="isa-alert-mute-custom" data-isa="muteCustomRow" hidden>
        <label><input type="text" inputmode="numeric" maxlength="3" data-isa="muteCustom" aria-label="Minutes to mute alerts, 1 to 720"> min</label>
        <button type="button" class="isa-alert-mute-button" data-isa="muteCustomSet">Mute</button>
      </div>`;
    const expandedHtml = compact ? '' : `<label class="isa-alert-toggle isa-alert-title">
        <span>Repeat and quiet time</span>
      </label>
      <label class="isa-alert-toggle isa-alert-pacing-row">
        <span>Ring again until I look, up to 3 times</span>
        <input type="checkbox" role="switch" data-isa="repeat">
      </label>
      <div class="isa-alert-quiet">
        <label>Ring again every <select data-isa="repeatMinutes" aria-label="Minutes between repeat rings">${REPEAT_MINUTES.map(minutes =>
          `<option value="${minutes}">${minutes} min</option>`).join('')}<option value="custom">Custom</option></select></label>
        <label data-isa="repeatCustomRow" hidden><input type="text" inputmode="numeric" maxlength="2" data-isa="repeatCustom" aria-label="Minutes between repeat rings, 1 to 60"> min</label>
      </div>
      <label class="isa-alert-toggle isa-alert-pacing-row">
        <span>Quiet hours</span>
        <input type="checkbox" role="switch" data-isa="quietEnabled">
      </label>
      <div class="isa-alert-quiet">
        <label>From <input type="text" inputmode="numeric" maxlength="5" placeholder="22:00" data-isa="quietStart" aria-label="Quiet hours start, 24-hour clock"></label>
        <label>to <input type="text" inputmode="numeric" maxlength="5" placeholder="07:00" data-isa="quietEnd" aria-label="Quiet hours end, 24-hour clock"></label>
      </div>
      <div class="isa-alert-hint">While alerts are muted or in quiet hours there is no sound and no pop-up. The tab still shows the mark, and the popup still lists what rang.</div>`;
    container.innerHTML = `${expandedHtml}${muteHtml}
      <div class="isa-alert-storage-status" data-isa="pacingStatus" role="status" aria-live="polite" hidden></div>`;

    const state = Object.assign({}, PACING_DEFAULTS);
    const statusEl = container.querySelector('[data-isa="pacingStatus"]');
    const muteLabelEl = container.querySelector('[data-isa="muteLabel"]');
    const muteButtonsEl = container.querySelector('[data-isa="muteButtons"]');
    const unmuteEl = container.querySelector('[data-isa="unmute"]');
    const muteCustomOpenEl = container.querySelector('[data-isa="muteCustomOpen"]');
    const muteCustomRowEl = container.querySelector('[data-isa="muteCustomRow"]');
    const muteCustomEl = container.querySelector('[data-isa="muteCustom"]');
    const muteCustomSetEl = container.querySelector('[data-isa="muteCustomSet"]');
    let muteCustomOpen = false;
    const repeatEl = container.querySelector('[data-isa="repeat"]');
    const repeatMinutesEl = container.querySelector('[data-isa="repeatMinutes"]');
    const repeatCustomRowEl = container.querySelector('[data-isa="repeatCustomRow"]');
    const repeatCustomEl = container.querySelector('[data-isa="repeatCustom"]');
    let repeatCustomOpen = false;
    const quietEnabledEl = container.querySelector('[data-isa="quietEnabled"]');
    const quietStartEl = container.querySelector('[data-isa="quietStart"]');
    const quietEndEl = container.querySelector('[data-isa="quietEnd"]');
    let muteTimer = null;

    function showStatus(text) {
      statusEl.textContent = text;
      statusEl.hidden = !text;
    }

    function render() {
      const muted = Number(state.isaAlertMuteUntil) > Date.now();
      muteLabelEl.textContent = muted ? `Muted until ${clockLabel(state.isaAlertMuteUntil)}` : 'Mute alerts for';
      muteButtonsEl.hidden = muted;
      unmuteEl.hidden = !muted;
      if (muted) muteCustomOpen = false;
      muteCustomRowEl.hidden = !muteCustomOpen;
      muteCustomOpenEl.setAttribute('aria-expanded', muteCustomOpen ? 'true' : 'false');
      if (muteTimer) clearTimeout(muteTimer);
      muteTimer = muted ? setTimeout(render, Math.min(Number(state.isaAlertMuteUntil) - Date.now() + 500, 2 ** 31 - 1)) : null;
      if (compact) return;
      repeatEl.checked = state.isaAlertRepeat === true;
      const minutes = validRepeatMinutes(state.isaAlertRepeatMinutes) ? state.isaAlertRepeatMinutes : PACING_DEFAULTS.isaAlertRepeatMinutes;
      const custom = repeatCustomOpen || !REPEAT_MINUTES.includes(minutes);
      repeatMinutesEl.value = custom ? 'custom' : String(minutes);
      repeatMinutesEl.disabled = !repeatEl.checked;
      repeatCustomRowEl.hidden = !custom;
      repeatCustomEl.disabled = !repeatEl.checked;
      if (document.activeElement !== repeatCustomEl) repeatCustomEl.value = String(minutes);
      quietEnabledEl.checked = state.isaAlertQuietEnabled === true;
      if (document.activeElement !== quietStartEl) quietStartEl.value = state.isaAlertQuietStart || '';
      if (document.activeElement !== quietEndEl) quietEndEl.value = state.isaAlertQuietEnd || '';
    }

    function save(values) {
      const storage = storageLocal();
      const previous = Object.assign({}, state);
      Object.assign(state, values);
      showStatus('');
      render();
      const fail = () => {
        Object.assign(state, previous);
        showStatus(PACING_SAVE_FAILED);
        render();
      };
      if (!storage) {
        fail();
        return;
      }
      try {
        storage.set(values, () => {
          if (chrome.runtime && chrome.runtime.lastError) fail();
        });
      } catch (error) {
        fail();
      }
    }

    container.querySelectorAll('[data-isa-mute]').forEach((button) => {
      button.addEventListener('click', () => {
        save({ [PACING_KEYS.muteUntil]: Date.now() + Number(button.getAttribute('data-isa-mute')) * 60000 });
      });
    });
    unmuteEl.addEventListener('click', () => save({ [PACING_KEYS.muteUntil]: 0 }));
    muteCustomOpenEl.addEventListener('click', () => {
      muteCustomOpen = !muteCustomOpen;
      muteCustomEl.removeAttribute('aria-invalid');
      showStatus('');
      render();
      if (muteCustomOpen) muteCustomEl.focus();
    });
    const muteCustom = () => {
      const text = muteCustomEl.value.trim();
      const minutes = /^\d{1,3}$/.test(text) ? Number(text) : 0;
      if (minutes < 1 || minutes > 720) {
        showStatus('Enter a whole number of minutes from 1 to 720.');
        muteCustomEl.setAttribute('aria-invalid', 'true');
        return;
      }
      muteCustomEl.removeAttribute('aria-invalid');
      muteCustomEl.value = '';
      muteCustomOpen = false;
      save({ [PACING_KEYS.muteUntil]: Date.now() + minutes * 60000 });
    };
    muteCustomSetEl.addEventListener('click', muteCustom);
    muteCustomEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') muteCustom();
    });

    if (!compact) {
      repeatEl.addEventListener('change', () => save({ [PACING_KEYS.repeat]: repeatEl.checked }));
      repeatMinutesEl.addEventListener('change', () => {
        repeatCustomEl.removeAttribute('aria-invalid');
        if (repeatMinutesEl.value === 'custom') {
          repeatCustomOpen = true;
          showStatus('');
          render();
          return;
        }
        repeatCustomOpen = false;
        save({ [PACING_KEYS.repeatMinutes]: Number(repeatMinutesEl.value) });
      });
      repeatCustomEl.addEventListener('change', () => {
        const text = repeatCustomEl.value.trim();
        const minutes = /^\d{1,2}$/.test(text) ? Number(text) : NaN;
        if (!validRepeatMinutes(minutes)) {
          showStatus('Enter a whole number of minutes from 1 to 60.');
          repeatCustomEl.setAttribute('aria-invalid', 'true');
          return;
        }
        repeatCustomEl.removeAttribute('aria-invalid');
        save({ [PACING_KEYS.repeatMinutes]: minutes });
      });
      quietEnabledEl.addEventListener('change', () => save({ [PACING_KEYS.quietEnabled]: quietEnabledEl.checked }));
      [[quietStartEl, PACING_KEYS.quietStart], [quietEndEl, PACING_KEYS.quietEnd]].forEach(([input, key]) => {
        input.addEventListener('change', () => {
          const value = input.value.trim();
          if (!CLOCK_PATTERN.test(value)) {
            showStatus('Enter the time as HH:MM on a 24-hour clock, for example 22:00.');
            input.setAttribute('aria-invalid', 'true');
            return;
          }
          input.removeAttribute('aria-invalid');
          save({ [key]: value });
        });
      });
    }

    const storage = storageLocal();
    render();
    if (!storage) return;
    try {
      storage.get(PACING_DEFAULTS, (stored) => {
        if (!(chrome.runtime && chrome.runtime.lastError) && stored) Object.assign(state, stored);
        render();
      });
      if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local' || !changes) return;
          let touched = false;
          Object.values(PACING_KEYS).forEach((key) => {
            if (!changes[key]) return;
            state[key] = changes[key].newValue === undefined ? PACING_DEFAULTS[key] : changes[key].newValue;
            touched = true;
          });
          if (touched) render();
        });
      }
    } catch (error) {}
  }

  function autoMount() {
    document.querySelectorAll('#isa-alert-settings').forEach(mount);
    document.querySelectorAll('#isa-alert-pacing').forEach(mountPacing);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  window.ISA_ALERT_SETTINGS = { mount, mountPacing };
})();
