
(function () {
  'use strict';

  if (window.ISA_THEME) return;

  var STORAGE_KEY = 'isaTheme';
  var VALID = { light: true, dark: true, system: true };

  var SUN_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"></circle>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2' +
    'M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';

  var MOON_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';

  function prefersDark() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (error) {
      return false;
    }
  }

  function readPref() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return VALID[value] ? value : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function writePref(pref) {
    try { window.localStorage.setItem(STORAGE_KEY, pref); } catch (error) {}
  }

  function resolve(pref) {
    var value = VALID[pref] ? pref : 'system';
    if (value === 'system') return prefersDark() ? 'dark' : 'light';
    return value;
  }

  function apply(resolved) {
    var root = document.documentElement;
    if (root) root.setAttribute('data-theme', resolved);
    updateToggles(resolved);
  }

  function updateToggles(resolved) {
    var isDark = resolved === 'dark';
    var buttons = document.querySelectorAll('[data-isa-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      button.innerHTML = isDark ? SUN_SVG : MOON_SVG;
      button.setAttribute('aria-pressed', String(isDark));
      button.setAttribute('title', isDark ? 'Switch to light theme' : 'Switch to dark theme');
      button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    }
  }

  apply(resolve(readPref()));

  function setPref(pref) {
    var value = VALID[pref] ? pref : 'system';
    writePref(value);
    apply(resolve(value));
  }

  function toggle() {
    var next = resolve(readPref()) === 'dark' ? 'light' : 'dark';
    setPref(next);
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.closest && target.closest('[data-isa-theme-toggle]')) toggle();
  });

  function refreshToggles() { updateToggles(resolve(readPref())); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshToggles);
  } else {
    refreshToggles();
  }

  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY) apply(resolve(readPref()));
  });

  try {
    if (window.matchMedia) {
      var mql = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { if (readPref() === 'system') apply(resolve('system')); };
      if (mql.addEventListener) mql.addEventListener('change', onChange);
      else if (mql.addListener) mql.addListener(onChange);
    }
  } catch (error) {}

  window.ISA_THEME = {
    getPref: readPref,
    getResolved: function () { return resolve(readPref()); },
    set: setPref,
    toggle: toggle
  };
})();
