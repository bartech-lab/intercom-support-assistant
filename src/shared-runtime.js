function extensionRuntimeAlive() {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime && Boolean(chrome.runtime.id);
  } catch (error) {
    return false;
  }
}

const OWNED_FAVICON_ATTRIBUTE = 'data-isa-alert-favicon';

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
