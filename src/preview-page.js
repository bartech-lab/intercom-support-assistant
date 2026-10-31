const COPY_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"></rect>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

const CHECK_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 6 9 17l-5-5"></path></svg>';

function createCopyButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-btn';
  button.title = 'Copy signature';
  button.setAttribute('aria-label', 'Copy signature');
  button.innerHTML = COPY_ICON_SVG;
  return button;
}

function htmlToPlainText(html) {
  const container = document.createElement('div');
  container.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
  return container.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

function flashCopied(button) {
  if (button.dataset.copying === '1') return;
  button.dataset.copying = '1';
  button.classList.add('copied');
  button.innerHTML = CHECK_ICON_SVG;
  button.title = 'Copied';
  button.setAttribute('aria-label', 'Copied');
  window.setTimeout(() => {
    button.classList.remove('copied');
    button.innerHTML = COPY_ICON_SVG;
    button.title = 'Copy signature';
    button.setAttribute('aria-label', 'Copy signature');
    delete button.dataset.copying;
  }, 1500);
}

async function copyHtmlAndText(html, text) {
  if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
    const item = new window.ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' })
    });
    await navigator.clipboard.write([item]);
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('Clipboard API unavailable');
}

async function copyActiveSignature(card, button) {
  const pane = card.querySelector('.signature-content.active');
  if (!pane || pane.querySelector('.empty-signature')) return;

  const html = pane.innerHTML;
  const text = htmlToPlainText(html);
  if (!text) return;

  try {
    await copyHtmlAndText(html, text);
    flashCopied(button);
    announceCopy('Signature copied.');
  } catch (error) {
    console.error('Copy failed:', error);
    announceCopy('Could not copy signature. Try again.');
  }
}

const COPY_STATUS_VISIBLE_MS = 4000;

function announceCopy(message) {
  const status = document.getElementById('copyStatus');
  if (!status) return;
  const token = String(Number(status.dataset.isaAnnouncement || 0) + 1);
  status.dataset.isaAnnouncement = token;
  status.textContent = status.textContent === message ? '' : message;
  window.setTimeout(() => {
    if (status.dataset.isaAnnouncement !== token) return;
    status.textContent = message;
    window.setTimeout(() => {
      if (status.dataset.isaAnnouncement === token) status.textContent = '';
    }, COPY_STATUS_VISIBLE_MS);
  }, 0);
}

function bindCopyButtons() {
  document.addEventListener('click', function (event) {
    const button = event.target.closest ? event.target.closest('.copy-btn') : null;
    if (!button) return;
    const card = button.closest('.preview-card');
    if (card) {
      copyActiveSignature(card, button);
    }
  });
}

function getBanneredSignature(companyName, signature, language) {
  const banners = (window.SIGNATURE_DATA && window.SIGNATURE_DATA.promotionalBanners) || {};
  const banner = banners[companyName];
  if (!banner) return signature;
  if (banner.expires && Date.now() > Date.parse(banner.expires + 'T23:59:59.999Z')) return signature;
  if (banner[language]) return '<br>' + banner[language] + signature;
  return signature;
}

function buildCard(name, config, sectionClass) {
  const languages = ['english', 'german', 'french', 'italian', 'portuguese', 'spanish', 'dutch'];
  const labels = { english: 'EN', german: 'DE', french: 'FR', italian: 'IT', portuguese: 'PT', spanish: 'ES', dutch: 'NL' };

  const article = document.createElement('article');
  article.className = `preview-card ${sectionClass}`;
  article.dataset.name = name.toLowerCase();

  const top = document.createElement('div');
  top.className = 'card-top';
  top.appendChild(createCopyButton());

  if (config.emoji) {
    const icon = document.createElement('img');
    icon.className = 'brand-icon';
    icon.alt = '';
    icon.src = config.emoji;
    top.appendChild(icon);
  }

  const brandName = document.createElement('div');
  brandName.className = 'brand-name';
  brandName.textContent = name;
  top.appendChild(brandName);

  const tabs = document.createElement('div');
  tabs.className = 'language-tabs';

  const preview = document.createElement('div');
  preview.className = 'signature-preview';

  languages.forEach((language, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'lang-tab';
    if (index === 0) tab.classList.add('active');
    if (!config[language] || config[language].trim() === '') tab.classList.add('empty');
    tab.dataset.lang = language;
    tab.textContent = labels[language];
    tabs.appendChild(tab);

    const pane = document.createElement('div');
    pane.className = 'signature-content';
    if (index === 0) pane.classList.add('active');
    pane.dataset.lang = language;

    if (config[language] && config[language].trim()) {
      pane.innerHTML = getBanneredSignature(name, config[language], language);
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty-signature';
      empty.textContent = 'No signature defined';
      pane.appendChild(empty);
    }

    preview.appendChild(pane);
  });

  article.appendChild(top);
  article.appendChild(tabs);
  article.appendChild(preview);

  return article;
}

function renderGrid(elementId, entries, sectionClass) {
  const container = document.getElementById(elementId);
  if (!container) return;
  entries.forEach(([name, config]) => {
    container.appendChild(buildCard(name, config, sectionClass));
  });
}

function syncCardContent(card) {
  const activeLanguage = card.querySelector('.lang-tab.active')?.dataset.lang;
  if (!activeLanguage) {
    return;
  }

  card.querySelectorAll('.signature-content').forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.lang === activeLanguage);
  });
}

function bindLanguageSwitching() {
  document.addEventListener('click', function (event) {
    const langTab = event.target.closest('.lang-tab');
    if (!langTab) return;

    const card = langTab.closest('.preview-card');
    card.querySelectorAll('.lang-tab').forEach((item) => item.classList.remove('active'));
    langTab.classList.add('active');

    syncCardContent(card);
  });
}

function setCountText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateResultCount() {
  const el = document.getElementById('resultCount');
  const cards = document.querySelectorAll('.preview-card');
  const visible = [...cards].filter((card) => !card.classList.contains('hidden')).length;
  if (el) {
    el.textContent = visible === cards.length
      ? `${cards.length} signatures`
      : `${visible} of ${cards.length} signatures`;
  }
  const empty = document.getElementById('searchEmpty');
  const searchInput = document.getElementById('searchInput');
  if (empty) {
    empty.classList.toggle('hidden', !searchInput || !searchInput.value.trim() || visible > 0);
    empty.hidden = !searchInput || !searchInput.value.trim() || visible > 0;
  }
}

function bindSearch() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;
  searchInput.addEventListener('input', function (event) {
    const query = event.target.value.toLowerCase().trim();
    document.querySelectorAll('.preview-card').forEach((card) => {
      card.classList.toggle('hidden', !card.dataset.name.includes(query));
    });
    updateResultCount();
  });
}

const WORKSPACE_SECTIONS = ['signatures', 'settings', 'tools'];

function normalizeWorkspaceSection(value) {
  const section = String(value || '').replace(/^#/, '').toLowerCase();
  return WORKSPACE_SECTIONS.includes(section) ? section : 'signatures';
}

function workspaceSectionElements() {
  const sections = new Map();
  document.querySelectorAll('[data-workspace-section]').forEach((element) => {
    const section = normalizeWorkspaceSection(element.dataset.workspaceSection || element.id);
    if (element.id === section || !sections.has(section)) sections.set(section, element);
  });
  WORKSPACE_SECTIONS.forEach((section) => {
    const element = document.getElementById(section);
    if (element && !sections.has(section)) sections.set(section, element);
  });
  return sections;
}

function replaceWorkspaceHash(section) {
  const nextHash = `#${section}`;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${nextHash}`);
}

function focusWorkspaceSection(sectionElement, navigationLink, previouslyFocused) {
  const active = previouslyFocused || document.activeElement;
  if (!active || active === document.body || !sectionElement) return;
  const hiddenAncestor = active.closest ? active.closest('[data-workspace-section]') : null;
  if (!hiddenAncestor || hiddenAncestor === sectionElement) return;
  if (navigationLink && typeof navigationLink.focus === 'function') {
    navigationLink.focus({ preventScroll: true });
    return;
  }
  if (!sectionElement.hasAttribute('tabindex')) sectionElement.setAttribute('tabindex', '-1');
  sectionElement.focus({ preventScroll: true });
}

function initWorkspaceNavigation() {
  if (window.__isaWorkspaceNavigation) return window.__isaWorkspaceNavigation;

  const sections = workspaceSectionElements();
  const links = new Map();
  document.querySelectorAll('[data-section]').forEach((link) => {
    const section = normalizeWorkspaceSection(link.dataset.section);
    if (!links.has(section)) links.set(section, link);
  });
  const scrollPositions = new Map();
  const viewportScrollPositions = new Map();
  let currentSection = normalizeWorkspaceSection(window.location.hash);
  try { window.history.scrollRestoration = 'manual'; } catch (error) {}

  if (!window.location.hash || normalizeWorkspaceSection(window.location.hash) !== window.location.hash.slice(1)) {
    replaceWorkspaceHash(currentSection);
  }

  const saveScroll = () => {
    const current = sections.get(currentSection);
    if (current) scrollPositions.set(currentSection, current.scrollTop);
    const viewportScroll = Math.max(
      typeof window.scrollY === 'number' ? window.scrollY : 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );
    viewportScrollPositions.set(currentSection, viewportScroll);
  };

  const apply = (requested) => {
    const nextSection = normalizeWorkspaceSection(requested);
    const previous = currentSection;
    const previouslyFocused = document.activeElement;
    if (nextSection !== previous) saveScroll();
    currentSection = nextSection;

    sections.forEach((element, section) => {
      const visible = section === nextSection;
      element.hidden = !visible;
      element.classList.toggle('hidden', !visible);
      element.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (visible) element.scrollTop = scrollPositions.has(section) ? scrollPositions.get(section) : 0;
    });
    const viewportScroll = viewportScrollPositions.has(nextSection)
      ? viewportScrollPositions.get(nextSection)
      : 0;
    document.documentElement.scrollTop = viewportScroll;
    document.body.scrollTop = viewportScroll;
    if (typeof window.scrollTo === 'function' && typeof window.scrollY === 'number' && window.scrollY !== viewportScroll) {
      try { window.scrollTo(0, viewportScroll); } catch (error) {}
    }
    links.forEach((link, section) => {
      if (section === nextSection) {
        link.setAttribute('aria-current', 'page');
        link.classList.add('active');
      } else {
        link.removeAttribute('aria-current');
        link.classList.remove('active');
      }
    });

    focusWorkspaceSection(sections.get(nextSection), links.get(nextSection), previouslyFocused);
  };

  links.forEach((link, section) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (section === currentSection) {
        link.focus({ preventScroll: true });
        return;
      }
      window.history.pushState(window.history.state, '', `${window.location.pathname}${window.location.search}#${section}`);
      apply(section);
    });
  });

  const applyHash = () => {
    const raw = window.location.hash.slice(1);
    const normalized = normalizeWorkspaceSection(raw);
    if (raw !== normalized) replaceWorkspaceHash(normalized);
    apply(normalized);
  };
  window.addEventListener('popstate', applyHash);
  window.addEventListener('hashchange', applyHash);
  apply(currentSection);
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && chrome.tabs?.getCurrent) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== 'workspace-open') return;
      chrome.tabs.getCurrent((tab) => {
        if (chrome.runtime.lastError || !tab || tab.id !== message.tabId) return;
        const section = normalizeWorkspaceSection(message.section);
        const openAtTop = () => {
          scrollPositions.set(section, 0);
          viewportScrollPositions.set(section, 0);
          apply(section);
        };
        openAtTop();
        window.requestAnimationFrame(openAtTop);
      });
    });
  }

  const navigation = { apply, scrollPositions, viewportScrollPositions };
  window.__isaWorkspaceNavigation = navigation;
  return navigation;
}

function showSignatureError(status, errorMessage) {
  if (status) status.classList.add('hidden');
  if (errorMessage) {
    errorMessage.textContent = 'Signatures could not load. Reload the extension and try again.';
    errorMessage.classList.remove('hidden');
    errorMessage.hidden = false;
  }
  const content = document.getElementById('content');
  if (content) {
    content.classList.add('hidden');
    content.hidden = true;
  }
}

function init() {
  if (window.__isaPreviewInitialized) return;
  window.__isaPreviewInitialized = true;
  initWorkspaceNavigation();
  const status = document.getElementById('status');
  const errorMessage = document.getElementById('errorMessage');

  if (!window.SIGNATURE_DATA) {
    showSignatureError(status, errorMessage);
    return;
  }

  try {
    if (typeof window.SIGNATURE_DATA !== 'object' || Array.isArray(window.SIGNATURE_DATA)) throw new Error('invalid signature data');
    if (!window.SIGNATURE_DATA.companies || typeof window.SIGNATURE_DATA.companies !== 'object' || Array.isArray(window.SIGNATURE_DATA.companies)) {
      throw new Error('invalid company signatures');
    }
    const teamSignature = window.SIGNATURE_DATA.teamSignature;
    if (teamSignature && (typeof teamSignature !== 'object' || Array.isArray(teamSignature))) {
      throw new Error('invalid team signature');
    }
    renderGrid('companyGrid', Object.entries(window.SIGNATURE_DATA.companies), 'company-card');
    if (window.SIGNATURE_DATA.teamSignature) {
      renderGrid('teamGrid', [['Team signature', window.SIGNATURE_DATA.teamSignature]], 'team-card');
    }
    bindLanguageSwitching();
    bindCopyButtons();
    bindSearch();
  } catch (error) {
    showSignatureError(status, errorMessage);
    return;
  }

  const companyGrid = document.getElementById('companyGrid');
  const teamGrid = document.getElementById('teamGrid');
  if (companyGrid) setCountText('companyCount', String(companyGrid.childElementCount));
  if (teamGrid) setCountText('teamCount', String(teamGrid.childElementCount));
  updateResultCount();

  if (status) status.classList.add('hidden');
  const content = document.getElementById('content');
  if (content) {
    content.classList.remove('hidden');
    content.hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
