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
const SIGNATURE_STATUS_CLASS = 'isa-signature-status';
const SIGNATURE_STATUS_CHIP_CLASS = 'isa-signature-status-chip';
const SIGNATURE_STATUS_BOX_CLASS = 'isa-signature-status-box';
const SIGNATURE_STATUS_LINK_CLASS = 'isa-signature-status-link';
const SIGNATURE_STATUS_STYLE_ID = 'isa-signature-status-style';
const SIGNATURE_STATUS_REASON_ATTRIBUTE = 'data-isa-signature-status';
const SIGNATURE_STATUS_OWNER_ATTRIBUTE = 'data-isa-signature-status-owner';
const SIGNATURE_STATUS_SETTLED_REASONS = new Set(['brand-unclear']);
const SIGNATURE_STATUS_HEADING = 'No signature here';
const SIGNATURE_STATUS_MAX_ALIGN_PX = 6;
const SIGNATURE_STATUS_EDGE_GAP_PX = 8;
const SIGNATURE_STATUS_BOX_WIDTH_PX = 300;
const SIGNATURE_STATUS_BOX_GAP_PX = 6;

let signatureStatusPending = { key: null, since: 0 };
let signatureStatusSettleTimer = null;
let signatureStatusOpenHolder = null;
const signatureStatusTargets = new WeakMap();

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

  record.editor.innerHTML = record.before;
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
      opacity: 0.65;
      cursor: pointer;
      position: relative;
    }
    .${DRAFT_LANGUAGE_CHIP_CLASS}::after {
      content: '';
      position: absolute;
      inset: -4px -1px;
    }
    .${DRAFT_LANGUAGE_CHIP_CLASS}:hover {
      opacity: 0.85;
    }
    .${DRAFT_LANGUAGE_CHIP_CLASS}:focus-visible {
      opacity: 1;
      outline: 2px solid var(--isa-accent);
      outline-offset: 1px;
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
      alignWithComposerActions(picker, host);
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


const SIGNATURE_STATUS_CSS = `
  .${SIGNATURE_STATUS_CLASS} {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    min-width: 0;
    margin-left: 6px;
  }
  .${SIGNATURE_STATUS_CHIP_CLASS} {
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
    padding: 1px 7px;
    border: 0;
    border-radius: 4px;
    background: var(--isa-warn);
    color: var(--isa-warn-ink);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
    cursor: pointer;
    position: relative;
  }
  .${SIGNATURE_STATUS_CHIP_CLASS}::after {
    content: '';
    position: absolute;
    inset: -3px 0;
  }
  .${SIGNATURE_STATUS_CHIP_CLASS}:focus-visible,
  .${SIGNATURE_STATUS_LINK_CLASS}:focus-visible {
    outline: 2px solid var(--isa-accent);
    outline-offset: 2px;
  }
  .${SIGNATURE_STATUS_CLASS}[${SIGNATURE_STATUS_REASON_ATTRIBUTE}="signed-as"] .${SIGNATURE_STATUS_CHIP_CLASS},
  .${SIGNATURE_STATUS_CLASS}[${SIGNATURE_STATUS_REASON_ATTRIBUTE}="no-signature-by-design"] .${SIGNATURE_STATUS_CHIP_CLASS} {
    background: transparent;
    color: inherit;
    opacity: 0.75;
    box-shadow: inset 0 0 0 1px currentColor;
  }
  .${SIGNATURE_STATUS_CHIP_CLASS}::before {
    content: '\\24D8\\00A0';
    font-weight: 400;
  }
  .${SIGNATURE_STATUS_CHIP_CLASS} span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .${SIGNATURE_STATUS_BOX_CLASS} {
    position: fixed;
    z-index: 2147483000;
    box-sizing: border-box;
    width: ${SIGNATURE_STATUS_BOX_WIDTH_PX}px;
    padding: 10px 12px;
    border: 1px solid var(--isa-hairline);
    border-radius: 8px;
    background: var(--isa-surface);
    color: var(--isa-ink);
    box-shadow: 0 6px 20px var(--isa-shadow);
    font-size: 12px;
    font-weight: 400;
    line-height: 17px;
    white-space: normal;
    text-align: left;
  }
  .${SIGNATURE_STATUS_BOX_CLASS} strong {
    display: block;
    margin-bottom: 2px;
    font-weight: 600;
  }
  .${SIGNATURE_STATUS_LINK_CLASS} {
    display: block;
    margin-top: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--isa-warn);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }
`;

function companySignatureStatus(inboxInfo) {
  if (!normalizedCompanies[inboxInfo.name] || inboxInfo.signatureSafe !== false) return null;
  if (sidebarLagsConversation()) return null;

  const candidates = [...new Set(Object.values(inboxInfo.sources || {}).filter(Boolean))];
  if (candidates.length < 2) return null;

  return {
    reason: 'brand-unclear',
    key: `brand-unclear:${candidates.join('|')}`,
    label: 'No signature: brand unclear',
    detail: `Brand signals point to ${candidates.join(' and ')}. Change the Brand field or move the conversation.`
  };
}

function draftSenderStatus() {
  const email = getSelectedSenderEmail();
  if (!email || getSenderInboxMapping(email)) return null;

  return {
    reason: 'sender-unknown',
    key: `sender-unknown:${email}`,
    label: 'No signature for this sender',
    detail: `The extension has no signature for ${email}. Pick a brand sender address, or ask the extension owner to add this one.`,
    link: false
  };
}

function signatureStatusTarget() {
  const onDraft = isNewConversationView();
  if (!onDraft && !currentConversationId) return null;
  if (!onDraft && !getComposerContainer()) return null;

  const editor = detectActualTextField();
  if (!editor || getComposerMode(editor) !== 'email') return null;

  if (onDraft) return draftSenderStatus() || draftTeamInboxStatus();

  const inboxInfo = detectInboxType();
  if (!inboxInfo) return null;

  const problem = inboxInfo.type === 'company' ? companySignatureStatus(inboxInfo) : null;
  return problem || signedAsSignatureStatus(inboxInfo);
}

function signedAsSignatureStatus(inboxInfo) {
  if (inboxInfo.type === 'excluded') {
    return {
      reason: 'no-signature-by-design',
      key: `no-signature-by-design:${inboxInfo.teamId || inboxInfo.name}`,
      label: 'No signature in this inbox',
      heading: 'No signature, on purpose',
      detail: 'This inbox never adds a signature. Nothing is missing.',
      link: false
    };
  }

  const company = inboxInfo.type === 'company' ? inboxInfo.name : null;
  const config = replySignatureConfig(inboxInfo);
  if (!company || !config) return null;

  const wanted = activeSignatureLanguage();
  const language = config[wanted] ? wanted : 'english';
  const code = DRAFT_LANGUAGE_CODES[language] || 'EN';
  return {
    reason: 'signed-as',
    key: `signed-as:${company}:${language}`,
    label: `${company}, ${code}`,
    heading: 'This reply is signed as',
    detail: `${company}, in the ${code} signature. To change the language, use the language buttons beside this chip.`
  };
}

function settledSignatureStatus(target) {
  if (!target || !SIGNATURE_STATUS_SETTLED_REASONS.has(target.reason)) {
    signatureStatusPending = { key: null, since: 0 };
    return target;
  }

  const now = Date.now();
  if (signatureStatusPending.key !== target.key) signatureStatusPending = { key: target.key, since: now };

  const remaining = TIMING.signatureStatusSettleMs - (now - signatureStatusPending.since);
  if (remaining <= 0) return target;

  if (!signatureStatusSettleTimer && typeof setTimeout === 'function') {
    signatureStatusSettleTimer = setTimeout(() => {
      signatureStatusSettleTimer = null;
      refreshSignatureStatus();
    }, remaining);
  }
  return null;
}

function ownSignatureStatusHolders() {
  return queryAllIntercom(`.${SIGNATURE_STATUS_CLASS}`)
    .filter(holder => !ownedByAnotherInstall(holder, SIGNATURE_STATUS_OWNER_ATTRIBUTE));
}

function signatureStatusChip(holder) {
  return holder.querySelector(`.${SIGNATURE_STATUS_CHIP_CLASS}`);
}

function signatureStatusBox(holder) {
  return holder.querySelector(`.${SIGNATURE_STATUS_BOX_CLASS}`);
}

function handleSignatureStatusKeydown(event) {
  if (event.key === 'Escape') closeSignatureStatusBox();
}

function handleSignatureStatusOutsideClick(event) {
  const holder = signatureStatusOpenHolder;
  if (!holder) return;
  const path = event.composedPath ? event.composedPath() : [];
  if (path.includes(holder) || holder.contains(event.target)) return;
  closeSignatureStatusBox();
}

function closeSignatureStatusBox() {
  const holder = signatureStatusOpenHolder;
  if (!holder) return;
  signatureStatusOpenHolder = null;
  document.removeEventListener('keydown', handleSignatureStatusKeydown, true);
  document.removeEventListener('click', handleSignatureStatusOutsideClick, true);
  window.removeEventListener('resize', closeSignatureStatusBox);
  window.removeEventListener('scroll', closeSignatureStatusBox, true);
  signatureStatusBox(holder)?.remove();
  signatureStatusChip(holder)?.setAttribute('aria-expanded', 'false');
}

function openSignaturesWorkspace() {
  if (!extensionRuntimeAlive()) return;
  try {
    chrome.runtime.sendMessage({ type: 'open-preview', section: 'signatures' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    debugLog('[Signature] Could not open the signatures page:', error);
  }
}

function placeSignatureStatusBox(holder, box) {
  const chip = signatureStatusChip(holder).getBoundingClientRect();
  const bar = holder.closest(SELECTORS.composerActionsBar);
  const rightLimit = (bar ? bar.getBoundingClientRect().right : window.innerWidth) - SIGNATURE_STATUS_EDGE_GAP_PX;
  const left = Math.max(SIGNATURE_STATUS_EDGE_GAP_PX, Math.min(chip.left, rightLimit - SIGNATURE_STATUS_BOX_WIDTH_PX));
  box.style.left = `${Math.round(left)}px`;
  box.style.bottom = `${Math.round(window.innerHeight - chip.top + SIGNATURE_STATUS_BOX_GAP_PX)}px`;
}

function fillSignatureStatusBox(box, target) {
  const heading = createOwnElement('strong');
  heading.textContent = target.heading || SIGNATURE_STATUS_HEADING;
  const detail = createOwnElement('span');
  detail.textContent = target.detail;
  box.replaceChildren(heading, detail);
  if (target.link === false) return;

  const link = createOwnElement('button');
  link.type = 'button';
  link.className = SIGNATURE_STATUS_LINK_CLASS;
  link.textContent = 'Open signatures';
  link.addEventListener('mousedown', event => event.preventDefault());
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSignaturesWorkspace();
  });
  box.appendChild(link);
}

function openSignatureStatusBox(holder) {
  closeSignatureStatusBox();

  const chip = signatureStatusChip(holder);
  const box = createOwnElement('div');
  box.className = SIGNATURE_STATUS_BOX_CLASS;

  fillSignatureStatusBox(box, signatureStatusTargets.get(holder));
  holder.appendChild(box);
  chip.setAttribute('aria-expanded', 'true');
  placeSignatureStatusBox(holder, box);

  signatureStatusOpenHolder = holder;
  document.addEventListener('keydown', handleSignatureStatusKeydown, true);
  document.addEventListener('click', handleSignatureStatusOutsideClick, true);
  window.addEventListener('resize', closeSignatureStatusBox);
  window.addEventListener('scroll', closeSignatureStatusBox, true);
}

function buildSignatureStatusHolder() {
  const holder = createOwnElement('span');
  holder.className = SIGNATURE_STATUS_CLASS;
  claimDecoration(holder, SIGNATURE_STATUS_OWNER_ATTRIBUTE);
  holder.setAttribute('role', 'status');

  const chip = createOwnElement('button');
  chip.type = 'button';
  chip.className = SIGNATURE_STATUS_CHIP_CLASS;
  chip.setAttribute('aria-expanded', 'false');
  chip.appendChild(createOwnElement('span'));
  chip.addEventListener('mousedown', event => event.preventDefault());
  chip.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (signatureStatusOpenHolder === holder) closeSignatureStatusBox();
    else openSignatureStatusBox(holder);
  });

  holder.appendChild(chip);
  return holder;
}

function paintSignatureStatusHolder(holder, target) {
  const chip = signatureStatusChip(holder);
  const label = chip.firstElementChild;
  if (holder.getAttribute(SIGNATURE_STATUS_REASON_ATTRIBUTE) !== target.reason) {
    holder.setAttribute(SIGNATURE_STATUS_REASON_ATTRIBUTE, target.reason);
  }
  const relabelled = label.textContent !== target.label;
  if (relabelled) label.textContent = target.label;
  const previous = signatureStatusTargets.get(holder);
  signatureStatusTargets.set(holder, target);
  if (chip.title !== target.detail) chip.title = target.detail;
  const box = signatureStatusBox(holder);
  if (box && (!previous || previous.key !== target.key || previous.detail !== target.detail)) {
    fillSignatureStatusBox(box, target);
  }
  return relabelled;
}

function removeSignatureStatusHolder(holder) {
  if (signatureStatusOpenHolder === holder) closeSignatureStatusBox();
  holder.remove();
}

function fitSignatureStatusHolder(holder, host) {
  holder.style.maxWidth = '';
  const overflow = holder.getBoundingClientRect().right - host.getBoundingClientRect().right;
  if (overflow > 0) holder.style.maxWidth = `${Math.max(0, Math.round(holder.getBoundingClientRect().width - overflow))}px`;
}

function alignWithComposerActions(element, host) {
  const bar = host.parentElement;
  if (!bar || !bar.matches(SELECTORS.composerActionsBar)) return;
  const actions = bar.lastElementChild;
  if (!actions || actions === host) return;

  const own = element.getBoundingClientRect();
  const other = actions.getBoundingClientRect();
  if (!own.height || !other.height) return;

  const offset = Math.round((own.top + own.height / 2) - (other.top + other.height / 2));
  if (offset && Math.abs(offset) <= SIGNATURE_STATUS_MAX_ALIGN_PX) {
    element.style.position = 'relative';
    element.style.top = `${-offset}px`;
  }
}

function refreshSignatureStatus() {
  safeExecute(() => {
    const target = settledSignatureStatus(signatureStatusTarget());
    const own = ownSignatureStatusHolders();
    if (!target) {
      own.forEach(removeSignatureStatusHolder);
      return;
    }

    const host = composerLanguagePickerHost();
    if (!host) return;

    let holder = own.find(candidate => candidate.parentElement === host) || null;
    own.filter(candidate => candidate !== holder).forEach(removeSignatureStatusHolder);

    if (!holder) {
      if (host.querySelector(`.${SIGNATURE_STATUS_CLASS}`)) return;
      injectStyleOnce(SIGNATURE_STATUS_STYLE_ID, SIGNATURE_STATUS_CSS);
      holder = buildSignatureStatusHolder();
      paintSignatureStatusHolder(holder, target);
      host.appendChild(holder);
      alignWithComposerActions(holder, host);
      fitSignatureStatusHolder(holder, host);
    } else if (paintSignatureStatusHolder(holder, target)) {
      fitSignatureStatusHolder(holder, host);
    }

  }, 'refreshSignatureStatus');
}

function insertSignatureHtml(editor, html, language = null) {
  const signatureHtml = html.replace(/^<br>/, '');
  const before = editor.innerHTML;
  editor.innerHTML = before + signatureHtml;
  const readback = editor.innerHTML;
  lastInsertedSignature = language ? { editor, html: readback, language, before } : null;
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
