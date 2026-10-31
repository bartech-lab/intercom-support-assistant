function getComposerContainer() {
  return queryIntercom(SELECTORS.composerContainer) ||
    queryIntercom(SELECTORS.composerContainerFallback);
}

const COMPOSER_ROOT_MAX_DEPTH = 8;
const COMPOSER_MODE_LABELS = { Email: 'email', Note: 'note', Chat: 'chat', Reply: 'chat' };

function composerModeFromRoot(root) {
  if (!root || typeof root.querySelector !== 'function') return null;

  if (root.querySelector(SELECTORS.composerPaneNoteIcon)) return 'note';
  if (root.querySelector(SELECTORS.composerPaneEmailIcon)) return 'email';

  if (
    root.classList?.contains('inbox2__note-pane') ||
    root.querySelector(SELECTORS.noteSendButton)
  ) {
    return 'note';
  }

  const modeElement = [...root.querySelectorAll(SELECTORS.composerModeLabel)]
    .find(element => Object.hasOwn(COMPOSER_MODE_LABELS, element.textContent.trim()));
  if (modeElement) return COMPOSER_MODE_LABELS[modeElement.textContent.trim()];

  if (root.textContent.includes('Add note')) return 'note';

  return null;
}

function resolveComposerRootFromEditor(editor) {
  if (!editor) return null;

  let node = editor.parentElement;
  for (let depth = 0; node && depth < COMPOSER_ROOT_MAX_DEPTH; depth += 1) {
    if (composerModeFromRoot(node)) return node;
    node = node.parentElement;
  }
  return null;
}

function getComposerModeRoots(editor) {
  const roots = [];
  const addRoot = (root) => {
    if (root && !roots.includes(root)) roots.push(root);
  };

  addRoot(resolveComposerRootFromEditor(editor));
  queryAllIntercom(SELECTORS.composerContainer).forEach(addRoot);
  queryAllIntercom(SELECTORS.composerContainerFallback).forEach(addRoot);

  return roots;
}

function getDraftChannelMode() {
  const picker = queryIntercom(SELECTORS.draftChannelPicker);
  if (!picker) return null;
  const channelText = picker.textContent.trim().toLowerCase();
  return ['email', 'note', 'chat'].includes(channelText) ? channelText : null;
}

function getComposerMode(editor) {
  const draftChannel = getDraftChannelMode();
  if (draftChannel) return draftChannel;

  const composerHeader = queryIntercom('[data-testid="composer-header"]');

  if (composerHeader) {
    const panePickerSpan = composerHeader.querySelector('[data-testid="pane-picker"] span');
    const modeText = panePickerSpan?.textContent.trim().toLowerCase();
    if (['email', 'note', 'chat'].includes(modeText)) return modeText;
  }

  const roots = getComposerModeRoots(editor);
  if (!roots.length) return 'unknown';

  for (const root of roots) {
    const mode = composerModeFromRoot(root);
    if (mode) return mode;
  }

  supportWarnOnce('composer-mode-unknown', '[Composer] Could not identify composer mode - skipping signature insertion');
  return 'unknown';
}

function detectActualTextField() {
  const composerContainer = getComposerContainer();

  if (!composerContainer) return null;

  const sendButton =
    composerContainer.querySelector(SELECTORS.sendButtonFallback) ||
    [...composerContainer.querySelectorAll('button')].find(button =>
      button.textContent.includes("Send")
    );

  if (!sendButton) return null;

  const textEditor = composerContainer.querySelector(SELECTORS.textEditor);
  return textEditor || null;
}

const DRAFT_COUNTRY_LANGUAGES = {
  IT: 'italian',
  FR: 'french',
  ES: 'spanish',
  NL: 'dutch',
  PT: 'portuguese',
  DE: 'german',
  AT: 'german',
  CH: 'german'
};

const DRAFT_LANGUAGE_CODES = {
  english: 'EN',
  german: 'DE',
  french: 'FR',
  italian: 'IT',
  portuguese: 'PT',
  spanish: 'ES',
  dutch: 'NL'
};

const DRAFT_LANGUAGE_PICKER_CLASS = 'isa-draft-language-picker';
const DRAFT_LANGUAGE_CHIP_CLASS = 'isa-draft-language-chip';
const DRAFT_LANGUAGE_ACTIVE_CLASS = 'isa-draft-language-chip-active';
const DRAFT_LANGUAGE_STYLE_ID = 'isa-draft-language-style';
const DRAFT_LANGUAGE_ACTIVE_ATTRIBUTE = 'data-isa-draft-language';

let draftRecipientLanguageTokens = null;
let draftRecipientLanguageRecipient = null;
let draftRecipientLanguageUserRecipients = new Map();
let draftManualLanguage = null;
let draftManualLanguageRecipient = null;
let conversationManualLanguage = null;
let lastInsertedSignature = null;
let draftTeamInboxSettledSender = null;

function resetDraftLanguageState() {
  draftRecipientLanguageTokens = null;
  draftRecipientLanguageRecipient = null;
  draftRecipientLanguageUserRecipients.clear();
  draftManualLanguage = null;
  draftManualLanguageRecipient = null;
  draftTeamInboxSettledSender = null;
}

function observeDraftTeamInbox() {
  const email = getSelectedSenderEmail();
  if (!email) {
    draftTeamInboxSettledSender = null;
    return;
  }

  const target = getSenderInboxMapping(email);
  if (!target) {
    draftTeamInboxSettledSender = null;
    return;
  }

  const current = getVisibleTeamInboxName();
  if (current && inboxKey(current) === inboxKey(target)) {
    draftTeamInboxSettledSender = email;
  }
}

function manualDraftTeamInboxName() {
  const email = getSelectedSenderEmail();
  if (!email || email !== draftTeamInboxSettledSender) return null;

  const target = getSenderInboxMapping(email);
  const current = getVisibleTeamInboxName();
  if (!target || !current) return null;

  return inboxKey(current) === inboxKey(target) ? null : current;
}

function draftInboxIsExcluded(normalizedInboxName) {
  return excludedInboxes.some(excluded => inboxKey(excluded) === inboxKey(normalizedInboxName));
}

function resolveDraftSignatureTarget() {
  const senderCompany = resolveDraftSenderCompany();
  const manualInbox = manualDraftTeamInboxName();

  if (!manualInbox) {
    return senderCompany ? { type: 'company', name: senderCompany } : null;
  }

  const normalizedInboxName = normalizeInboxText(manualInbox);
  if (draftInboxIsExcluded(normalizedInboxName)) {
    supportNoteOnce(
      `draft-team-inbox-excluded-${inboxKey(normalizedInboxName)}`,
      `[Signature] Skipping insertion because the chosen Team Inbox (${manualInbox}) never signs`
    );
    return null;
  }

  if (isTeamSignatureInbox(normalizedInboxName)) {
    return { type: 'team', name: 'TEAM' };
  }

  const companyFromInbox = getCompanyFromInboxName(normalizedInboxName);
  if (companyFromInbox && normalizedCompanies[companyFromInbox]) {
    return { type: 'company', name: companyFromInbox };
  }

  return senderCompany ? { type: 'company', name: senderCompany } : null;
}

function draftSignatureConfig() {
  const target = resolveDraftSignatureTarget();
  if (!target) return null;
  if (target.type === 'team') return teamSignature;
  return normalizedCompanies[target.name] || null;
}

function languageFromCountryCode(countryCode) {
  if (!countryCode) return null;
  return DRAFT_COUNTRY_LANGUAGES[String(countryCode).toUpperCase()] || null;
}

function draftRecipientLanguage() {
  const tokens = draftRecipientLanguageTokens;
  if (!tokens) return null;

  const fromOverride = signatureLanguageFromAttribute(tokens.languageOverride);
  if (fromOverride) return fromOverride;

  const fromLocale = signatureLanguageFromAttribute(tokens.browserLocale);
  if (fromLocale && fromLocale !== 'english') return fromLocale;

  return languageFromCountryCode(tokens.countryCode);
}

function draftSignatureLanguage() {
  syncDraftRecipientLanguageState();
  discardDraftManualLanguageOnRecipientChange();
  const recipientLanguage = draftManualLanguage ? null : draftRecipientLanguage();
  return draftManualLanguage || recipientLanguage || 'english';
}

function draftRecipientPills() {
  const input = queryIntercom(SELECTORS.draftRecipientInput);
  if (!input) return null;
  return [...input.children].filter(child => !child.matches(SELECTORS.draftRecipientSelector));
}

function draftHasRecipient() {
  const pills = draftRecipientPills();
  return Boolean(pills && pills.length);
}

function draftRecipientSignature() {
  const pills = draftRecipientPills();
  if (!pills || !pills.length) return null;
  return pills
    .map(pill => (pill.textContent || '').replace(/\s+/g, ' ').trim())
    .join('|');
}

function discardDraftManualLanguageOnRecipientChange() {
  if (!draftManualLanguage) return;
  if (draftManualLanguageRecipient === draftRecipientSignature()) return;
  draftManualLanguage = null;
  draftManualLanguageRecipient = null;
}

function syncDraftRecipientLanguageState() {
  const recipient = draftRecipientSignature();
  if (draftRecipientLanguageRecipient === recipient) return recipient;

  draftRecipientLanguageTokens = null;
  draftRecipientLanguageRecipient = recipient;
  return recipient;
}

function rememberDraftRecipientLanguage(userId, tokens) {
  if (!isNewConversationView()) return;

  const recipient = syncDraftRecipientLanguageState();
  if (!recipient) return;

  const knownRecipient = draftRecipientLanguageUserRecipients.get(userId);
  if (knownRecipient && knownRecipient !== recipient) return;

  draftRecipientLanguageTokens = { userId, ...tokens };
  draftRecipientLanguageRecipient = recipient;
  draftRecipientLanguageUserRecipients.set(userId, recipient);
  discardDraftManualLanguageOnRecipientChange();
  safeExecute(refreshComposerLanguage, 'rememberDraftRecipientLanguage');
}

function replySignatureConfig(inboxInfo = detectInboxType()) {
  if (!inboxInfo) return null;

  if (inboxInfo.type === 'team') return teamSignature;

  if (inboxInfo.type === 'company' && normalizedCompanies[inboxInfo.name]) {
    return inboxInfo.signatureSafe === false ? null : normalizedCompanies[inboxInfo.name];
  }

  return null;
}

function activeComposerSignatureConfig() {
  return isNewConversationView() ? draftSignatureConfig() : replySignatureConfig();
}

function signatureForLanguage(language) {
  const config = activeComposerSignatureConfig();
  return config ? pickSignature(config, language) : null;
}

function activeSignatureLanguage() {
  if (isNewConversationView()) return draftSignatureLanguage();

  if (currentConversationId) {
    if (conversationManualLanguage
      && conversationManualLanguage.conversationId === currentConversationId) {
      return conversationManualLanguage.language;
    }

    if (cachedLanguageDetection.conversationId === currentConversationId
      && !cachedLanguageDetection.provisional) {
      return cachedLanguageDetection.language;
    }
  }

  const language = detectCustomerLanguage();
  if (currentConversationId) {
    cachedLanguageDetection = {
      conversationId: currentConversationId,
      language,
      provisional: lastDetectionHadNoEvidence
    };
  }
  return language;
}

function replaceUntouchedSignature(language) {
  const record = lastInsertedSignature;
  if (!record || !record.editor || !record.editor.isConnected) return false;
  if (record.language === language) return false;
  if (record.editor.innerHTML !== record.html) {
    return false;
  }

  const signature = signatureForLanguage(language);
  if (!signature) return false;

  record.editor.innerHTML = '';
  insertSignatureHtml(record.editor, applyGreetingVariation(signature), language);
  return true;
}

function refreshComposerLanguage() {
  if (!isNewConversationView() && !currentConversationId) return;
  replaceUntouchedSignature(activeSignatureLanguage());
  refreshComposerLanguagePicker();
}

function composerLanguagePickerStyle() {
  return `
    .${DRAFT_LANGUAGE_PICKER_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-left: 6px;
    }
    .${DRAFT_LANGUAGE_CHIP_CLASS} {
      font: inherit;
      font-size: 11px;
      line-height: 16px;
      font-weight: 600;
      padding: 1px 5px;
      border: 0;
      border-radius: 9999px;
      background: transparent;
      color: currentColor;
      opacity: 0.45;
      cursor: pointer;
    }
    .${DRAFT_LANGUAGE_CHIP_CLASS}:hover {
      opacity: 0.85;
    }
    .${DRAFT_LANGUAGE_ACTIVE_CLASS} {
      opacity: 1;
      outline: 1px solid currentColor;
      outline-offset: -1px;
    }
  `;
}

function injectComposerLanguagePickerStyle() {
  injectStyleOnce(DRAFT_LANGUAGE_STYLE_ID, composerLanguagePickerStyle());
}

function composerLanguagePickerHost() {
  const bar = queryIntercom(SELECTORS.composerActionsBar);
  if (bar) return bar.firstElementChild || bar;
  return isNewConversationView() ? null : getComposerContainer();
}

function chooseComposerLanguage(language) {
  if (isNewConversationView()) {
    draftManualLanguage = language;
    draftManualLanguageRecipient = draftRecipientSignature();
  } else if (currentConversationId) {
    conversationManualLanguage = { conversationId: currentConversationId, language };
  } else {
    return;
  }

  safeExecute(() => refreshComposerLanguage(), 'chooseComposerLanguage');
}

function buildComposerLanguagePicker() {
  const picker = createOwnElement('div');
  picker.className = DRAFT_LANGUAGE_PICKER_CLASS;

  SIGNATURE_LANGUAGES.forEach((language) => {
    const chip = createOwnElement('button');
    chip.type = 'button';
    chip.className = DRAFT_LANGUAGE_CHIP_CLASS;
    chip.textContent = DRAFT_LANGUAGE_CODES[language];
    chip.title = `Sign in ${language}`;
    chip.setAttribute('data-isa-language', language);
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      chooseComposerLanguage(language);
    });
    picker.appendChild(chip);
  });

  return picker;
}

function paintComposerLanguagePicker(picker, language) {
  if (picker.getAttribute(DRAFT_LANGUAGE_ACTIVE_ATTRIBUTE) === language) return;
  picker.setAttribute(DRAFT_LANGUAGE_ACTIVE_ATTRIBUTE, language);
  [...picker.children].forEach((chip) => {
    const isActive = chip.getAttribute('data-isa-language') === language;
    chip.classList.toggle(DRAFT_LANGUAGE_ACTIVE_CLASS, isActive);
    chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function removeComposerLanguagePicker() {
  queryAllIntercom(`.${DRAFT_LANGUAGE_PICKER_CLASS}`).forEach(picker => picker.remove());
}

function composerLanguagePickerApplies() {
  if (isNewConversationView()) return true;
  if (!currentConversationId) return false;
  if (!getComposerContainer()) return false;

  const editor = detectActualTextField();
  if (!editor || getComposerMode(editor) !== 'email') return false;

  return Boolean(replySignatureConfig());
}

function refreshComposerLanguagePicker() {
  safeExecute(() => {
    if (!composerLanguagePickerApplies()) {
      removeComposerLanguagePicker();
      return;
    }

    const host = composerLanguagePickerHost();
    if (!host) return;

    injectComposerLanguagePickerStyle();

    let picker = host.querySelector(`.${DRAFT_LANGUAGE_PICKER_CLASS}`);
    if (!picker) {
      removeComposerLanguagePicker();
      picker = buildComposerLanguagePicker();
      host.appendChild(picker);
    }

    paintComposerLanguagePicker(picker, activeSignatureLanguage());
  }, 'refreshComposerLanguagePicker');
}

function refreshComposerLanguageState() {
  if (!isNewConversationView()) {
    if (draftRecipientLanguageTokens
      || draftRecipientLanguageRecipient !== null
      || draftRecipientLanguageUserRecipients.size
      || draftManualLanguage) {
      resetDraftLanguageState();
    }
    refreshComposerLanguage();
    return;
  }

  syncDraftRecipientLanguageState();
  discardDraftManualLanguageOnRecipientChange();

  observeDraftTeamInbox();
  refreshComposerLanguage();
}


function insertSignatureHtml(editor, html, language = null) {
  const signatureHtml = html.replace(/^<br>/, '');
  const before = editor.innerHTML;
  editor.innerHTML = before + signatureHtml;
  const readback = editor.innerHTML;
  lastInsertedSignature = language ? { editor, html: readback, language } : null;
  return Boolean(readback && readback !== before);
}

function insertSignature(actualTextField) {
  safeExecute(() => {
    if (!actualTextField) return;

    if (getComposerMode(actualTextField) !== 'email') return;

    const editableContent = actualTextField.textContent.trim();
    if (!editableContent) {
      const onDraft = isNewConversationView();

      if (onDraft) {
        observeDraftTeamInbox();
        const draftTarget = resolveDraftSignatureTarget();
        if (!draftTarget) {
          if (!manualDraftTeamInboxName()) {
            supportNoteOnce(
              `draft-sender-unresolved-${getSelectedSenderEmail() || 'none'}`,
              `[Signature] Skipping insertion because the sender (${getSelectedSenderEmail() || 'none'}) maps to no brand`
            );
          }
          return;
        }

        const draftLanguage = draftSignatureLanguage();
        debugLog('[Language Detection] Draft language:', draftLanguage);

        const draftConfig = draftTarget.type === 'team'
          ? teamSignature
          : normalizedCompanies[draftTarget.name];
        const draftSignature = draftConfig ? pickSignature(draftConfig, draftLanguage) : null;

        if (draftSignature) {
          insertSignatureHtml(actualTextField, applyGreetingVariation(draftSignature), draftLanguage);
          refreshComposerLanguagePicker();
        }
        return;
      }

      const inboxInfo = detectInboxType();
      if (inboxInfo) {
        const language = activeSignatureLanguage();
        debugLog('[Language Detection] Reply language:', language);

        if (inboxInfo.type === 'company'
          && normalizedCompanies[inboxInfo.name]
          && inboxInfo.signatureSafe === false) {
          supportWarnOnce(
            `signature-conflict-${inboxInfo.name}`,
            `[Signature] Skipping insertion because brand signals conflict for ${inboxInfo.name}`
          );
        }

        const config = replySignatureConfig(inboxInfo);
        const signature = config ? pickSignature(config, language) : null;

        if (signature) {
          insertSignatureHtml(actualTextField, applyGreetingVariation(signature), language);
          refreshComposerLanguagePicker();
        }
      }
    }
  }, 'insertSignature');
}

function composerEditorFromEvent(event) {
  const path = event.composedPath ? event.composedPath() : [];
  const candidates = path.length ? path : [event.target];

  for (const candidate of candidates) {
    if (!candidate || candidate.nodeType !== Node.ELEMENT_NODE) continue;
    const editor = candidate.matches?.(SELECTORS.composerEditorMatch)
      ? candidate
      : candidate.closest?.(SELECTORS.composerEditorMatch);
    if (editor) return editor;
  }

  return null;
}

function handleSignatureInsertion(event) {
  safeExecute(() => {
    if (event.button !== 0) return;

    const pathEditor = composerEditorFromEvent(event);
    if (pathEditor) {
      insertSignature(pathEditor);
      return;
    }

    const actualTextField = detectActualTextField();
    if (!actualTextField) return;

    const isInsideTextField = event.composedPath
      ? event.composedPath().includes(actualTextField)
      : actualTextField.contains(event.target);

    if (isInsideTextField) {
      insertSignature(actualTextField);
    }
  }, 'handleSignatureInsertion');
}

function isEventInsideComposerTextField(event) {
  const path = event.composedPath ? event.composedPath() : [];

  if (composerEditorFromEvent(event)) return true;

  const actualTextField = detectActualTextField();
  if (!actualTextField) return false;

  return path.length
    ? path.includes(actualTextField)
    : actualTextField.contains(event.target);
}

function preventComposerMiddleClickPaste(event) {
  safeExecute(() => {
    if (event.button !== 1) return;

    if (isEventInsideComposerTextField(event)) {
      lastComposerMiddleClickAt = Date.now();
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
  }, 'preventComposerMiddleClickPaste');
}

function preventComposerMiddleClickInput(event) {
  safeExecute(() => {
    if (Date.now() - lastComposerMiddleClickAt > 1000) return;
    if (!isEventInsideComposerTextField(event)) return;

    const inputType = event.inputType || '';
    if (
      inputType === 'insertFromPaste' ||
      inputType === 'insertFromPasteAsQuotation' ||
      inputType === 'insertFromDrop' ||
      inputType === 'insertText'
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
  }, 'preventComposerMiddleClickInput');
}

function preventComposerMiddleClickPasteEvent(event) {
  safeExecute(() => {
    if (Date.now() - lastComposerMiddleClickAt > 1000) return;
    if (!isEventInsideComposerTextField(event)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }, 'preventComposerMiddleClickPasteEvent');
}
