const NORMALIZED_LABEL_MEMO_MAX = 200;
const normalizedLabelMemo = new Map();
const REQUIRED_LABEL_MARKER = /\s*\*+\s*$/;

function normalizeLabelText(text) {
  const source = text || '';
  const memoized = normalizedLabelMemo.get(source);
  if (memoized !== undefined) return memoized;

  const normalized = normalizeInboxText(source).replace(REQUIRED_LABEL_MARKER, '').toLowerCase();
  if (normalizedLabelMemo.size >= NORMALIZED_LABEL_MEMO_MAX) {
    normalizedLabelMemo.delete(normalizedLabelMemo.keys().next().value);
  }
  normalizedLabelMemo.set(source, normalized);
  return normalized;
}

function computeReactAttributeRows() {
  const rows = [
    ...queryAllIntercom(SELECTORS.reactUserAttributeRows),
    ...queryAllIntercom(SELECTORS.reactConversationAttributeRows)
  ].filter(row => !row.closest(SELECTORS.duplicateSuggestionCard));

  return rows.filter(row => !rows.some(other => other !== row && row.contains(other)));
}

function computeAttributeRows() {
  const conversationRows = queryAllIntercom(SELECTORS.conversationAttributeRows);
  const sidebarRows = queryAllIntercom(SELECTORS.sidebarAttributeRows);
  const userDetailsRows = queryAllIntercom(SELECTORS.userDetailsAttributeRows);
  const reactRows = computeReactAttributeRows();

  const allRows = [...new Set([...conversationRows, ...sidebarRows, ...userDetailsRows, ...reactRows])];

  if (allRows.length > 0) {
    debugLog('[Attribute Rows] Found', allRows.length, 'rows (conversation-attr:', conversationRows.length, ', sidebar:', sidebarRows.length, ', user-details:', userDetailsRows.length, ', react:', reactRows.length, ')');
    return allRows;
  }

  const section = getSidebarSection();
  if (!section) {
    debugLog('[Attribute Rows] No anchored rows and no sidebar section, giving up');
    return [];
  }

  debugLog('[Attribute Rows] No anchored rows found, falling back to class selectors inside the sidebar');
  return [...section.querySelectorAll(SELECTORS.fallbackAttributeRows)];
}

function getAttributeRows() {
  return passCached('attributeRows', computeAttributeRows);
}

const ROW_LABEL_SELECTORS = [
  () => SELECTORS.reactAttributeLabel,
  () => SELECTORS.reactConversationAttributeLabel,
  () => SELECTORS.attributeLabelInner,
  () => SELECTORS.attributeLabel,
  () => 'label, span.truncate'
];

function getRowLabel(container) {
  for (const resolve of ROW_LABEL_SELECTORS) {
    for (const candidate of container.querySelectorAll(resolve())) {
      if ((candidate.textContent || '').trim()) return candidate;
    }
  }
  return null;
}

function rowLabelMatches(container, labelText) {
  const label = getRowLabel(container);
  return Boolean(label) && normalizeLabelText(label.textContent) === normalizeLabelText(labelText);
}

function attributeRowByStableId(attributeId) {
  return queryIntercom(`[id="conversation-attr-${attributeId}"]`);
}

function findAttributeRowByLabel(labelText) {
  return passCached(`attributeRowByLabel:${labelText}`, () => {
    const attributeId = FIELD_ATTRIBUTE_IDS[labelText];
    if (attributeId) {
      const anchored = attributeRowByStableId(attributeId);
      if (anchored) return anchored;
    }
    return getAttributeRows().find(row => rowLabelMatches(row, labelText)) || null;
  });
}

function getRowValueScope(row) {
  return row.querySelector(SELECTORS.reactAttributeValue) ||
    row.querySelector(SELECTORS.reactValueColumn) ||
    row;
}

function getRowValueElement(row, valueSelectors) {
  const scope = getRowValueScope(row);
  const scopes = scope === row ? [row] : [scope, row];

  for (const searchRoot of scopes) {
    for (const selector of valueSelectors) {
      const element = searchRoot.querySelector(selector);
      if (element && (element.textContent || '').trim()) return element;
    }
  }

  if (scope !== row && (scope.textContent || '').trim()) return scope;
  return null;
}

function userIdValueSelectors() {
  return [
    '[data-original-user-id]',
    SELECTORS.userIdPrimaryValue,
    SELECTORS.userIdFallbackValue,
    SELECTORS.userIdLooseValue,
    SELECTORS.attributeValue
  ];
}

function getAttributeValueByLabel(labelText, valueSelectors) {
  const row = findAttributeRowByLabel(labelText);
  if (!row) return null;

  const valueElement = getRowValueElement(row, valueSelectors);
  return valueElement ? valueElement.textContent.trim() : null;
}

function getSidebarConversationId() {
  const reactRow = queryIntercom(SELECTORS.reactConversationIdRow);
  if (reactRow) {
    const reactValue = getRowValueElement(reactRow, [SELECTORS.attributeValue]);
    const reactText = reactValue ? reactValue.textContent.trim() : '';
    if (/^\d+$/.test(reactText)) return reactText;
  }

  const labels = queryAllIntercom(SELECTORS.attributeLabel);
  for (const label of labels) {
    if (normalizeLabelText(label.textContent) !== normalizeLabelText(FIELD_LABELS.conversationId)) continue;
    const row = label.parentElement;
    if (!row) continue;
    const value = (row.textContent || '').replace(label.textContent || '', '').trim();
    if (/^\d+$/.test(value)) return value;
  }
  return null;
}

function sidebarLagsConversation() {
  const sidebarId = getSidebarConversationId();
  if (!sidebarId) return false;
  const urlId = getConversationId();
  if (!urlId) return false;
  return sidebarId !== urlId;
}

function getSidebarSection() {
  return queryIntercom(SELECTORS.sidebarSection) ||
    queryIntercom(SELECTORS.reactSidebarSection) ||
    queryIntercom(SELECTORS.fallbackSidebarSection);
}

function getVisibleTeamInboxName() {
  return passCached('visibleTeamInboxName', computeVisibleTeamInboxName);
}

function computeVisibleTeamInboxName() {
  const draftAssignee = queryIntercom(SELECTORS.draftTeamAssigneeValue);
  if (draftAssignee) {
    const draftName = draftAssignee.textContent.trim();
    if (draftName) return draftName;
  }

  let teamInboxRow = findAttributeRowByLabel(FIELD_LABELS.teamInbox);

  if (!teamInboxRow) {
    const section = getSidebarSection();
    if (!section) return null;

    teamInboxRow = [...section.querySelectorAll(SELECTORS.inboxRows)]
      .find(row => {
        const label = row.querySelector(SELECTORS.inboxRowLabel);
        return label && normalizeLabelText(label.textContent) === normalizeLabelText(FIELD_LABELS.teamInbox);
      });

    if (!teamInboxRow) {
      teamInboxRow = [...section.querySelectorAll(SELECTORS.inboxRows)]
        .find(row => row.textContent.includes(FIELD_LABELS.teamInbox));
    }
  }

  if (!teamInboxRow) return null;

  let inboxNameElement = teamInboxRow.querySelector(SELECTORS.inboxName);

  if (!inboxNameElement) {
    const spans = teamInboxRow.querySelectorAll('span');
    inboxNameElement = [...spans].find(span => span.textContent.trim() && !span.querySelector('*'));
  }

  return inboxNameElement ? inboxNameElement.textContent : null;
}

function getCustomerEmail() {
  const labelled = getAttributeValueByLabel(FIELD_LABELS.email, [
    SELECTORS.emailValue,
    SELECTORS.attributeValue
  ]);
  if (labelled) return labelled;
  return unambiguousEmailFromAttributeRows() || networkIdentityField('email');
}

function networkIdentityField(field) {
  const conversationId = typeof getConversationId === 'function' ? getConversationId() : null;
  if (!conversationId) return null;
  const identity = typeof resolveNetworkIdentity === 'function' ? resolveNetworkIdentity(conversationId) : null;
  return identity?.[field] || null;
}

function unambiguousEmailFromAttributeRows() {
  const found = new Set();
  for (const row of getAttributeRows()) {
    for (const selector of [SELECTORS.emailValue, SELECTORS.attributeValue]) {
      const element = row.querySelector(selector);
      if (!element) continue;
      const text = (element.textContent || '').trim();
      if (SINGLE_EMAIL_VALUE_PATTERN.test(text)) found.add(text.toLowerCase());
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

function getEmailMetadataRecipients(container) {
  if (!container) return [];

  const collapsedMetadata = [...container.querySelectorAll(SELECTORS.emailMetadataCollapsed)];
  const text = collapsedMetadata.map(element => element.textContent || '').join(' ');
  return [...new Set((text.match(EMAIL_ADDRESS_PATTERN) || [])
    .map(email => email.toLowerCase()))];
}

const MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CSS = `
    .${MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CLASS} {
      position: relative !important;
      border: 0 !important;
    }

    .${MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CLASS}::before {
      content: '';
      position: absolute;
      top: 0;
      right: -16px;
      bottom: 0;
      left: -16px;
      box-sizing: border-box;
      border: 2px solid #eab308;
      border-radius: 8px 8px 0 0;
      pointer-events: none;
    }
  `;

function injectMultiRecipientEmailHighlightStyle() {
  injectStyleOnce(MULTI_RECIPIENT_EMAIL_HIGHLIGHT_STYLE_ID, MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CSS);
}

function rowChipAnchor(row) {
  const name = rowNameElement(row);
  const meta = row.querySelector(SELECTORS.conversationListRowMeta);

  if (meta && name && meta.contains(name)) {
    let wrapper = name;
    while (wrapper.parentElement && wrapper.parentElement !== meta) wrapper = wrapper.parentElement;
    if (wrapper.parentElement === meta) return { parent: meta, before: wrapper.nextSibling };
  }

  if (name && name.parentElement && name.parentElement !== row) {
    return { parent: name.parentElement, before: null };
  }

  const avatar = row.querySelector(SELECTORS.conversationListRowAvatar);
  const fallback = avatar && avatar.parentElement ? avatar.parentElement : row;
  return { parent: fallback, before: null };
}

const ROW_CHIP_TRAY_CLASS = 'isa-row-chip-tray';
const ROW_CHIP_TRAY_CSS = `
    .${ROW_CHIP_TRAY_CLASS} {
      display: inline-flex;
      flex-direction: row;
      align-items: center;
      flex: 0 0 auto;
      gap: 4px;
      margin-left: 6px;
      margin-right: auto;
    }
  `;

function rowChipTray(row) {
  const { parent, before } = rowChipAnchor(row);
  let tray = row.querySelector(`.${ROW_CHIP_TRAY_CLASS}`);

  if (!tray) {
    tray = createOwnElement('span');
    tray.className = ROW_CHIP_TRAY_CLASS;
  }

  if (before === tray) return tray;

  const placed = tray.parentElement === parent
    && (before === null ? tray.nextSibling === null : tray.nextSibling === before);
  if (!placed) parent.insertBefore(tray, before);

  return tray;
}

function pruneRowChipTray(row) {
  const tray = row.querySelector(`.${ROW_CHIP_TRAY_CLASS}`);
  if (tray && !tray.children.length) tray.remove();
}
