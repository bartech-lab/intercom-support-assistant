const EMAIL_PATTERN = /[^\s()<>@]+@[^\s()<>]+/;

function inboxKey(text) {
  return normalizeKey(normalizeInboxText(text || ''));
}

function emailFromNode(node) {
  const match = (node?.textContent || '').match(EMAIL_PATTERN);
  return match ? match[0].trim().toLowerCase() : null;
}

function getSenderSelectorField() {
  return queryIntercom(SELECTORS.draftSenderArea) ||
    queryIntercom(SELECTORS.senderSelectorField);
}

const EXACT_EMAIL_PATTERN = /^[^\s()<>@]+@[^\s()<>@]+\.[^\s()<>@]+$/;

function emailFromSenderPill(pill) {
  const spans = [...pill.querySelectorAll('span')];
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const text = spans[index].textContent.trim().toLowerCase();
    if (EXACT_EMAIL_PATTERN.test(text)) return text;
  }
  return null;
}

function getSelectedSenderEmail() {
  const draftPill = queryIntercom(SELECTORS.draftSenderPill);
  if (draftPill) return emailFromSenderPill(draftPill);

  const field = queryIntercom(SELECTORS.senderSelectorField);
  if (!field) return null;
  const pill = field.querySelector(SELECTORS.senderPillContent);
  return emailFromNode(pill || field);
}

function isNewConversationView() {
  return /\/inbox\/[^/]+\/inbox\/new-conversation(?:\/|$)/.test(window.location.pathname);
}

function simulateClick(el) {
  if (!el) return;
  const opts = { bubbles: true, cancelable: true, view: window };
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    const Ctor = type.startsWith('pointer') && typeof window.PointerEvent === 'function'
      ? window.PointerEvent
      : window.MouseEvent;
    el.dispatchEvent(new Ctor(type, opts));
  });
}

function dispatchKey(el, key, keyCode) {
  if (!el) return;
  ['keydown', 'keyup'].forEach(type => {
    el.dispatchEvent(new window.KeyboardEvent(type, {
      key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true
    }));
  });
}

function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function getTeamInboxValueOpener(row) {
  const valueCell = row.querySelector('p.w-3\\/5') || row;
  return valueCell.querySelector('[role="button"]') ||
    valueCell.querySelector('[data-popover-opener]') ||
    [...row.querySelectorAll('[role="button"], [data-popover-opener]')]
      .find(candidate => !candidate.closest(SELECTORS.attributeLabel)) ||
    null;
}

function getAssignMenu() {
  return queryIntercom(SELECTORS.assignMenu) ||
    queryAllIntercom(SELECTORS.assignPalette).find(palette =>
      palette.getAttribute('data-state') !== 'closed' && palette.querySelector(SELECTORS.assignPaletteOption)) ||
    null;
}

function getAssignSearchInput() {
  const menu = getAssignMenu();
  if (!menu) return null;
  const input = menu.querySelector(SELECTORS.assignSearchInput) || menu.querySelector('input');
  return input && input.tagName === 'INPUT' ? input : null;
}

function findAssignOptionRow(menu, targetKey) {
  const pane = menu.querySelector(SELECTORS.assignOptionsPane) || menu;
  const nameEl = [...pane.querySelectorAll(SELECTORS.assignOptionName)]
    .find(el => inboxKey(el.textContent) === targetKey) ||
    [...pane.querySelectorAll('span')].find(el =>
      !el.querySelector('*') && inboxKey(el.textContent) === targetKey);
  if (!nameEl) return null;
  const option = nameEl.closest('[role="option"]');
  if (option && menu.contains(option)) return option;

  let row = nameEl;
  while (row.parentElement && row.parentElement !== pane) row = row.parentElement;
  return row.parentElement === pane ? row : nameEl;
}

function assignMenuShowsOption(menu, targetKey) {
  const input = getAssignSearchInput();
  return [...menu.querySelectorAll('*')].some(element => {
    if (element.children.length) return false;
    if (input && (element === input || input.contains(element))) return false;
    return inboxKey(element.textContent) === targetKey;
  });
}

function selectTeamInboxOption(targetLabel) {
  const menu = getAssignMenu();
  if (!menu) return false;
  const input = getAssignSearchInput();
  if (!input) return false;

  const targetKey = inboxKey(targetLabel);
  if (inboxKey(input.value) !== targetKey) {
    setNativeInputValue(input, targetLabel);
    return false;
  }

  const row = findAssignOptionRow(menu, targetKey);
  if (row) {
    simulateClick(row);
    return true;
  }
  return false;
}

function closeOpenAssignMenu() {
  if (getAssignMenu()) dispatchKey(getAssignSearchInput() || document.activeElement, 'Escape', 27);
}

function getSenderInboxMapping(email) {
  const normalizedEmail = email ? email.toLowerCase() : null;
  if (!normalizedEmail) return null;
  const label = senderFromEmailToInbox?.[normalizedEmail];
  return typeof label === 'string' && label.trim() ? label : null;
}

function setTeamInboxAttribute(targetLabel) {
  const supersedingPrevious = applyingTeamInbox;
  if (supersedingPrevious) safeExecute(closeOpenAssignMenu, 'closeOpenAssignMenu', false);

  const generation = teamInboxApplyGeneration + 1;
  teamInboxApplyGeneration = generation;
  const isCurrent = () => generation === teamInboxApplyGeneration;

  applyingTeamInbox = true;
  inFlightTeamInboxTarget = targetLabel;
  document.documentElement.classList.add(ASSIGN_SUPPRESS_CLASS);
  const stopSuppressing = () => document.documentElement.classList.remove(ASSIGN_SUPPRESS_CLASS);
  setTimeout(() => {
    if (isCurrent()) stopSuppressing();
  }, TEAM_INBOX_SUPPRESS_MS);

  const started = safeExecute(() => {
    const draftOpener = queryIntercom(SELECTORS.draftTeamAssigneeValue);
    const row = draftOpener ? null : findAttributeRowByLabel(FIELD_LABELS.teamInbox);
    if (!draftOpener && !row) return false;
    const opener = draftOpener || getTeamInboxValueOpener(row);
    if (!opener) return false;

    simulateClick(opener);

    let attempts = 0;
    let committed = false;
    const targetKey = inboxKey(targetLabel);
    const finish = () => {
      if (!isCurrent()) return;
      applyingTeamInbox = false;
      inFlightTeamInboxTarget = null;
      stopSuppressing();
    };

    const commitByKeyboard = () => {
      const input = getAssignSearchInput();
      if (!input || inboxKey(input.value) !== targetKey) return false;
      const activeId = input.getAttribute('aria-activedescendant');
      const active = activeId ? input.getRootNode().getElementById?.(activeId) : null;
      if (activeId && (!active || inboxKey(active.textContent) !== targetKey)) return false;
      dispatchKey(input, 'Enter', 13);
      committed = true;
      return true;
    };

    const attempt = () => {
      if (!isCurrent()) return;
      attempts += 1;
      safeExecute(() => selectTeamInboxOption(targetLabel), 'selectTeamInboxOption', false);

      const current = getVisibleTeamInboxName();
      if (current && inboxKey(current) === inboxKey(targetLabel)) {
        finish();
        return;
      }

      if (!committed) {
        const menu = getAssignMenu();
        if (menu && assignMenuShowsOption(menu, targetKey)) {
          commitByKeyboard();
        } else if (attempts >= TEAM_INBOX_COMMIT_FALLBACK_ATTEMPTS) {
          commitByKeyboard();
        }
      }

      if (attempts >= TEAM_INBOX_SELECT_MAX_ATTEMPTS) {
        if (inboxKey(getVisibleTeamInboxName() || '') !== inboxKey(targetLabel)) {
          closeOpenAssignMenu();
        }
        finish();
        return;
      }

      setTimeout(attempt, TEAM_INBOX_SELECT_RETRY_MS);
    };
    setTimeout(attempt, TEAM_INBOX_SELECT_RETRY_MS);
    return true;
  }, 'setTeamInboxAttribute', false);

  if (!started && isCurrent()) {
    applyingTeamInbox = false;
    inFlightTeamInboxTarget = null;
    stopSuppressing();
  }
}

function resolveDraftSenderCompany() {
  const email = getSelectedSenderEmail();
  if (!email) return null;

  const label = getSenderInboxMapping(email);
  if (!label) return null;

  const normalizedLabel = normalizeInboxText(label);
  if (ALERT_INBOX_PATTERN.test(normalizedLabel)) return null;
  if (excludedInboxes.some(excluded => normalizedLabel.toLowerCase() === excluded.toLowerCase())) {
    return null;
  }

  return getCompanyFromInboxName(label);
}

function syncTeamInboxFromSender(userInitiated = false) {
  if (!getSenderSelectorField() || !isNewConversationView()) {
    lastAppliedSenderEmail = null;
    return;
  }

  const email = getSelectedSenderEmail();
  const senderChanged = Boolean(email) && email !== lastObservedSenderEmail;
  if (email) lastObservedSenderEmail = email;
  if (!email) {
    lastAppliedSenderEmail = null;
    return;
  }

  const targetLabel = getSenderInboxMapping(email);
  if (!targetLabel) {
    lastAppliedSenderEmail = email;
    return;
  }

  if (applyingTeamInbox && inboxKey(inFlightTeamInboxTarget || '') === inboxKey(targetLabel)) {
    return;
  }

  const current = getVisibleTeamInboxName();
  if (current && inboxKey(current) === inboxKey(targetLabel)) {
    lastAppliedSenderEmail = email;
    return;
  }

  if (email === lastAppliedSenderEmail) return;

  if (userInitiated || senderChanged || email !== lastAttemptedSenderEmail) {
    lastAttemptedSenderEmail = email;
    teamInboxApplyCount = 0;
  }

  if (teamInboxApplyCount >= TEAM_INBOX_MAX_APPLIES_PER_SENDER) {
    return;
  }
  teamInboxApplyCount += 1;

  lastAppliedSenderEmail = email;
  setTeamInboxAttribute(targetLabel);
}

function getSenderOptionFromClick(event) {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return null;

  const dropdown = target.closest(SELECTORS.senderDropdown);
  const option = target.closest(SELECTORS.senderOptionRow);
  if (!dropdown || !option || option === dropdown || !dropdown.contains(option)) return null;
  return option;
}

function waitForSenderSelection(expectedEmail, previousEmail, attempts = 0) {
  if (!isNewConversationView()) return;

  const email = getSelectedSenderEmail();
  const selectionCommitted = expectedEmail
    ? email === expectedEmail
    : Boolean(email && email !== previousEmail);

  if (selectionCommitted) {
    lastAppliedSenderEmail = null;
    syncTeamInboxFromSender(true);
    return;
  }

  if (attempts >= SENDER_SELECTION_MAX_ATTEMPTS) return;

  setTimeout(
    () => waitForSenderSelection(expectedEmail, previousEmail, attempts + 1),
    SENDER_SELECTION_RETRY_MS
  );
}

function handleSenderOptionClick(event) {
  if (applyingTeamInbox || !isNewConversationView()) return;

  const option = getSenderOptionFromClick(event);
  if (!option) return;

  const previousEmail = getSelectedSenderEmail();
  const match = (option.textContent || '').match(EMAIL_PATTERN);
  const expectedEmail = match ? match[0].trim().toLowerCase() : null;
  setTimeout(
    () => waitForSenderSelection(expectedEmail, previousEmail, 0),
    0
  );
}
