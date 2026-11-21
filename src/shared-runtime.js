function extensionRuntimeAlive() {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime && Boolean(chrome.runtime.id);
  } catch (error) {
    return false;
  }
}

const OWNED_FAVICON_ATTRIBUTE = 'data-isa-alert-favicon';
const SOUND_BLOCKED_NOTICE_ID = 'isa-sound-blocked-notice';
const SOUND_BLOCKED_NOTICE_TEXT = 'A new message alert had no sound. Click anywhere on this page to turn the sound on.';
const SOUND_BLOCKED_NOTICE_STYLE = {
  position: 'fixed',
  bottom: '16px',
  left: '16px',
  zIndex: '2000000000',
  maxWidth: 'min(360px, calc(100vw - 32px))',
  boxSizing: 'border-box',
  padding: '8px 12px',
  border: '1px solid #f59e0b',
  borderRadius: '8px',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.3)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: '13px',
  lineHeight: '1.4',
  textAlign: 'left',
  pointerEvents: 'none'
};

const SOUND_BLOCKED_NOTICE_DARK = { background: '#1f2937', color: '#ffffff' };
const SOUND_BLOCKED_NOTICE_LIGHT = { background: '#ffffff', color: '#111827' };

function pageBackgroundIsLight() {
  const corner = typeof document.elementFromPoint === 'function'
    ? document.elementFromPoint(24, Math.max(0, window.innerHeight - 24))
    : null;
  for (let element = corner || document.body; element; element = element.parentElement || element.getRootNode().host || null) {
    const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(getComputedStyle(element).backgroundColor);
    if (!match || match[4] === '0') continue;
    return (0.299 * match[1] + 0.587 * match[2] + 0.114 * match[3]) > 140;
  }
  return false;
}

const ISA_TOKEN_STYLE_ID = 'isa-tokens-style';
const ISA_THEME_ATTRIBUTE = 'data-isa-theme';
const ISA_INTERCOM_HOST = 'app.intercom.com';
const ISA_TOKENS_LIGHT = {
  ink: '#14181f',
  'ink-muted': '#5b6472',
  surface: '#ffffff',
  'surface-2': '#f7f8fa',
  hairline: '#e2e6ec',
  accent: '#1d4ed8',
  'accent-ink': '#ffffff',
  block: '#c92a16',
  'block-ink': '#ffffff',
  warn: '#b45309',
  'warn-ink': '#ffffff',
  ok: '#1a7f4b',
  shadow: 'rgba(15, 23, 42, 0.18)'
};
const ISA_TOKENS_DARK = {
  ink: '#e7eaef',
  'ink-muted': '#9aa4b2',
  surface: '#171a20',
  'surface-2': '#1e222b',
  hairline: '#272c36',
  accent: '#7aa2ff',
  'accent-ink': '#14181f',
  block: '#ff6a52',
  'block-ink': '#14181f',
  warn: '#fbbf24',
  'warn-ink': '#14181f',
  ok: '#6ee7a8',
  shadow: 'rgba(0, 0, 0, 0.4)'
};

function isaTokenDeclarations(tokens) {
  return Object.keys(tokens).map(name => `--isa-${name}: ${tokens[name]};`).join(' ');
}

function isaTokenCss() {
  return `:root { ${isaTokenDeclarations(ISA_TOKENS_LIGHT)} } ` +
    `:root[${ISA_THEME_ATTRIBUTE}="dark"] { ${isaTokenDeclarations(ISA_TOKENS_DARK)} }`;
}

function isaHostTheme() {
  if (window.location.host === ISA_INTERCOM_HOST) {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }
  return pageBackgroundIsLight() ? 'light' : 'dark';
}

function isaApplyHostTheme() {
  const theme = isaHostTheme();
  const root = document.documentElement;
  if (root.getAttribute(ISA_THEME_ATTRIBUTE) !== theme) root.setAttribute(ISA_THEME_ATTRIBUTE, theme);
  return theme;
}

let isaThemeObserver = null;

function isaEnsureTokens() {
  if (!document.head) return;
  if (!document.getElementById(ISA_TOKEN_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = ISA_TOKEN_STYLE_ID;
    style.setAttribute('data-isa-own', '');
    style.textContent = isaTokenCss();
    document.head.appendChild(style);
  }
  isaApplyHostTheme();
  if (isaThemeObserver || typeof MutationObserver !== 'function') return;
  isaThemeObserver = new MutationObserver(isaApplyHostTheme);
  isaThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
}

function showSoundBlockedNotice() {
  if (!document.body || document.getElementById(SOUND_BLOCKED_NOTICE_ID)) return;

  const notice = document.createElement('div');
  notice.id = SOUND_BLOCKED_NOTICE_ID;
  notice.setAttribute('data-isa-own', '');
  notice.setAttribute('role', 'status');
  notice.textContent = SOUND_BLOCKED_NOTICE_TEXT;
  Object.assign(notice.style, SOUND_BLOCKED_NOTICE_STYLE,
    pageBackgroundIsLight() ? SOUND_BLOCKED_NOTICE_LIGHT : SOUND_BLOCKED_NOTICE_DARK);

  const dismiss = () => {
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', dismiss, true);
    notice.remove();
  };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', dismiss, true);
  document.body.appendChild(notice);
}

function showSoundBlockedNoticeIfSilent(soundId) {
  const sounds = window.ISA_ALERT_SOUNDS;
  if (sounds && typeof sounds.blocked === 'function' && sounds.blocked(soundId)) showSoundBlockedNotice();
}

function getFaviconLink(create) {
  let link = document.querySelector('link[rel~="icon"]');
  if (!link && create) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute(OWNED_FAVICON_ATTRIBUTE, '');
    (document.head || document.documentElement).appendChild(link);
  }
  return link;
}

function restoreFaviconHref(originalHref) {
  if (originalHref !== null) {
    setFaviconHref(originalHref);
    return;
  }
  const link = getFaviconLink(false);
  if (!link) return;
  if (link.hasAttribute(OWNED_FAVICON_ATTRIBUTE)) link.remove();
  else link.removeAttribute('href');
}

function getFaviconHref() {
  const link = getFaviconLink(false);
  return link ? link.getAttribute('href') : null;
}

function setFaviconHref(href) {
  if (href == null) return;
  const link = getFaviconLink(true);
  if (link) link.setAttribute('href', href);
}

function buildFaviconBadge(total) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = '#e11d2a';
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total > 9 ? '9+' : String(total), 16, 17);

    return canvas.toDataURL('image/png');
  } catch (error) {
    return null;
  }
}

const ISA_ANCHORED_NOTICE_ID = 'isa-anchored-notice';
const ISA_ANCHORED_NOTICE_WIDTH = 300;
const ISA_ANCHORED_NOTICE_GAP = 8;
const ISA_ANCHORED_NOTICE_STYLE = {
  position: 'fixed',
  zIndex: '2147483000',
  boxSizing: 'border-box',
  width: `${ISA_ANCHORED_NOTICE_WIDTH}px`,
  maxWidth: 'calc(100vw - 16px)',
  padding: '10px 12px',
  border: '1px solid var(--isa-block)',
  borderRadius: '8px',
  background: 'var(--isa-surface)',
  color: 'var(--isa-ink)',
  boxShadow: '0 6px 20px var(--isa-shadow)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: '13px',
  lineHeight: '1.4',
  textAlign: 'left',
  whiteSpace: 'normal'
};

let isaAnchoredNoticeDismiss = null;

function isaHideAnchoredNotice() {
  if (isaAnchoredNoticeDismiss) isaAnchoredNoticeDismiss();
}

function isaAnchoredNoticePosition(anchor) {
  const rect = anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : null;
  const width = Math.min(ISA_ANCHORED_NOTICE_WIDTH, window.innerWidth - 2 * ISA_ANCHORED_NOTICE_GAP);
  const maxLeft = Math.max(ISA_ANCHORED_NOTICE_GAP, window.innerWidth - width - ISA_ANCHORED_NOTICE_GAP);
  if (!rect || (!rect.width && !rect.height)) {
    return { top: 2 * ISA_ANCHORED_NOTICE_GAP, left: Math.max(ISA_ANCHORED_NOTICE_GAP, (window.innerWidth - width) / 2) };
  }
  return {
    top: rect.bottom + ISA_ANCHORED_NOTICE_GAP,
    left: Math.min(Math.max(ISA_ANCHORED_NOTICE_GAP, rect.right - width), maxLeft)
  };
}

function isaShowAnchoredNotice(anchor, { title, body }) {
  isaHideAnchoredNotice();
  if (!document.body) return null;
  isaEnsureTokens();

  const notice = document.createElement('div');
  notice.id = ISA_ANCHORED_NOTICE_ID;
  notice.setAttribute('data-isa-own', '');
  notice.setAttribute('role', 'alert');
  const heading = document.createElement('strong');
  heading.textContent = title;
  heading.style.display = 'block';
  heading.style.marginBottom = '2px';
  const text = document.createElement('span');
  text.textContent = body;
  notice.append(heading, text);

  const position = isaAnchoredNoticePosition(anchor);
  Object.assign(notice.style, ISA_ANCHORED_NOTICE_STYLE, { top: `${position.top}px`, left: `${position.left}px` });

  const onKey = (event) => {
    if (event.key === 'Escape') dismiss();
  };
  const onPointer = (event) => {
    if (!notice.contains(event.target)) dismiss();
  };
  function dismiss() {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointer, true);
    notice.remove();
    if (isaAnchoredNoticeDismiss === dismiss) isaAnchoredNoticeDismiss = null;
  }
  isaAnchoredNoticeDismiss = dismiss;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
  document.body.appendChild(notice);
  return notice;
}

const ISA_ALERT_PACING_KEYS = {
  repeat: 'isaAlertRepeat',
  repeatMinutes: 'isaAlertRepeatMinutes',
  muteUntil: 'isaAlertMuteUntil',
  quietEnabled: 'isaAlertQuietEnabled',
  quietStart: 'isaAlertQuietStart',
  quietEnd: 'isaAlertQuietEnd'
};
const ISA_ALERT_REPEAT_MINUTES = [1, 2, 3, 5, 10];
const ISA_ALERT_REPEAT_DEFAULT_MINUTES = 3;
const ISA_ALERT_REPEAT_MAX = 3;

function isaClockMinutes(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(text || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function isaAlertRepeatMs(minutes) {
  return (ISA_ALERT_REPEAT_MINUTES.includes(minutes) ? minutes : ISA_ALERT_REPEAT_DEFAULT_MINUTES) * 60000;
}

function isaInQuietHours(quietHours, date) {
  if (!quietHours || quietHours.enabled !== true) return false;
  const start = isaClockMinutes(quietHours.start);
  const end = isaClockMinutes(quietHours.end);
  if (start === null || end === null || start === end) return false;
  const minute = date.getHours() * 60 + date.getMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function isaAlertsMuted(pacing, now) {
  return (Number(pacing.muteUntil) || 0) > now || isaInQuietHours(pacing.quietHours, new Date(now));
}

function createAlertPacing({ now, onRepeat }) {
  const pacing = { repeat: false, repeatMs: isaAlertRepeatMs(), muteUntil: 0, quietHours: { enabled: false, start: '', end: '' } };
  const armed = new Map();

  function apply(values) {
    if (ISA_ALERT_PACING_KEYS.repeat in values) pacing.repeat = values[ISA_ALERT_PACING_KEYS.repeat] === true;
    if (ISA_ALERT_PACING_KEYS.repeatMinutes in values) pacing.repeatMs = isaAlertRepeatMs(values[ISA_ALERT_PACING_KEYS.repeatMinutes]);
    if (ISA_ALERT_PACING_KEYS.muteUntil in values) pacing.muteUntil = Number(values[ISA_ALERT_PACING_KEYS.muteUntil]) || 0;
    if (ISA_ALERT_PACING_KEYS.quietEnabled in values) pacing.quietHours.enabled = values[ISA_ALERT_PACING_KEYS.quietEnabled] === true;
    if (ISA_ALERT_PACING_KEYS.quietStart in values) pacing.quietHours.start = values[ISA_ALERT_PACING_KEYS.quietStart] || '';
    if (ISA_ALERT_PACING_KEYS.quietEnd in values) pacing.quietHours.end = values[ISA_ALERT_PACING_KEYS.quietEnd] || '';
  }

  function connect(storage) {
    if (!storage) return;
    try {
      storage.get({
        [ISA_ALERT_PACING_KEYS.repeat]: false,
        [ISA_ALERT_PACING_KEYS.repeatMinutes]: ISA_ALERT_REPEAT_DEFAULT_MINUTES,
        [ISA_ALERT_PACING_KEYS.muteUntil]: 0,
        [ISA_ALERT_PACING_KEYS.quietEnabled]: false,
        [ISA_ALERT_PACING_KEYS.quietStart]: '',
        [ISA_ALERT_PACING_KEYS.quietEnd]: ''
      }, values => apply(values || {}));
      if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local' || !changes) return;
          const values = {};
          Object.values(ISA_ALERT_PACING_KEYS).forEach((key) => {
            if (changes[key]) values[key] = changes[key].newValue;
          });
          apply(values);
        });
      }
    } catch (error) {}
  }

  function muted() {
    return isaAlertsMuted(pacing, now());
  }

  function arm(key) {
    if (!pacing.repeat) return;
    armed.set(String(key), { lastAt: now(), repeats: 0 });
  }

  function settle(activeKeys) {
    const active = new Set(activeKeys.map(String));
    [...armed.keys()].forEach((key) => {
      if (!active.has(key)) armed.delete(key);
    });
    if (!pacing.repeat) {
      armed.clear();
      return;
    }
    armed.forEach((ring, key) => {
      if (now() - ring.lastAt < pacing.repeatMs) return;
      ring.lastAt = now();
      if (muted()) return;
      ring.repeats += 1;
      if (ring.repeats >= ISA_ALERT_REPEAT_MAX) armed.delete(key);
      onRepeat(key, ring.repeats);
    });
  }

  return { connect, muted, arm, settle };
}

function isaPrefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function createAlertVisuals({ titleMarker, blinkMs, runSafe, collectActive, summarize }) {
  const state = {
    timer: null,
    started: false,
    baseTitle: null,
    lastSetTitle: null,
    originalFavicon: null,
    badgeDataUrl: null,
    showingBadge: false,
    summary: ''
  };

  function tick() {
    const alertTitle = `${titleMarker}${state.summary}`;
    const current = document.title;
    if (current !== state.lastSetTitle && current.indexOf(titleMarker) !== 0) {
      state.baseTitle = current;
    }

    state.showingBadge = isaPrefersReducedMotion() || !state.showingBadge;
    if (state.showingBadge) {
      document.title = alertTitle;
      state.lastSetTitle = alertTitle;
      setFaviconHref(state.badgeDataUrl);
    } else {
      document.title = state.baseTitle;
      state.lastSetTitle = state.baseTitle;
      restoreFaviconHref(state.originalFavicon);
    }
  }

  function updateSummary(activeList) {
    const { text, total } = summarize(activeList);
    state.summary = text;
    state.badgeDataUrl = buildFaviconBadge(total);
  }

  function pulse() {
    const activeList = collectActive();
    if (!activeList.length) {
      stop();
      return;
    }
    updateSummary(activeList);
    tick();
  }

  function start() {
    if (state.baseTitle === null) state.baseTitle = document.title;
    if (!state.started) state.originalFavicon = getFaviconHref();
    state.started = true;
    if (!state.timer) {
      state.showingBadge = false;
      tick();
      state.timer = setInterval(() => runSafe(pulse), blinkMs);
    }
  }

  function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (state.lastSetTitle !== null && state.baseTitle !== null && document.title === state.lastSetTitle) {
      document.title = state.baseTitle;
    } else if (document.title.indexOf(titleMarker) === 0) {
      document.title = document.title.slice(titleMarker.length);
    }
    if (state.started) restoreFaviconHref(state.originalFavicon);
    state.started = false;
    state.baseTitle = null;
    state.lastSetTitle = null;
    state.originalFavicon = null;
    state.badgeDataUrl = null;
    state.showingBadge = false;
    state.summary = '';
  }

  return { updateSummary, start, stop, pulse };
}
