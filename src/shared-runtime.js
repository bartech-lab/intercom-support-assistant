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

    state.showingBadge = !state.showingBadge;
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
