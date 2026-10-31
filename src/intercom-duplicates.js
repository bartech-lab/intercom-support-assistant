const DUPLICATE_ROW_CLASS = 'isa-duplicate-customer-row';
const DUPLICATE_CHIP_CLASS = 'isa-duplicate-customer-chip';
const DUPLICATE_STRIP_CLASS = 'isa-duplicate-customer-strip';
const DUPLICATE_STYLE_ID = 'isa-duplicate-customer-style';
const DUPLICATE_GROUP_ATTRIBUTE = 'data-isa-duplicate-group';
const CONTACT_KEY_PREFIX = 'contact:';
const EMAIL_KEY_PREFIX = 'email:';
const DUPLICATE_DASHED_CLASS = 'isa-dup-dashed';
const DUPLICATE_STRIP_GLYPH_CLASS = 'isa-duplicate-customer-strip-glyph';
const DUPLICATE_STRIP_LABEL_CLASS = 'isa-duplicate-customer-strip-label';
const SIBLING_TRANSITION_SETTLE_MS = 400;
const DUPLICATE_CLOSED_MAX_CONVERSATIONS = 500;
const DUPLICATE_HUES = [
  { light: '#c2255c', lightInk: '#ffffff', dark: '#f06595', darkInk: '#16161a' },
  { light: '#2b8a3e', lightInk: '#ffffff', dark: '#51cf66', darkInk: '#16161a' },
  { light: '#1c7ed6', lightInk: '#ffffff', dark: '#4dabf7', darkInk: '#16161a' },
  { light: '#e8590c', lightInk: '#ffffff', dark: '#ff922b', darkInk: '#16161a' },
  { light: '#9c36b5', lightInk: '#ffffff', dark: '#da77f2', darkInk: '#16161a' },
  { light: '#0c8599', lightInk: '#ffffff', dark: '#3bc9db', darkInk: '#16161a' }
];
const DUPLICATE_STYLE_COUNT = DUPLICATE_HUES.length * 2;

let duplicateRowIdentity = new Map();
let duplicateIdentityTeamId = null;
let duplicateStyleByCustomer = new Map();
let duplicateStylesAssigned = 0;
let duplicateIdentitySignature = null;
let duplicateIdentityGroups = null;
let duplicateStripMemo = null;
let duplicateClosedConversations = new Set();

function duplicateStyleForCustomer(customerKey) {
  if (!duplicateStyleByCustomer.has(customerKey)) {
    duplicateStyleByCustomer.set(customerKey, duplicateStylesAssigned % DUPLICATE_STYLE_COUNT);
    duplicateStylesAssigned += 1;
  }
  const index = duplicateStyleByCustomer.get(customerKey);
  return {
    index,
    hueSlot: index % DUPLICATE_HUES.length,
    dashed: index >= DUPLICATE_HUES.length
  };
}
function collectCustomerNameCandidates(row) {
  const ignored = CUSTOMER_NAME_IGNORED_SELECTOR;
  const pieces = [];
  (function walk(node) {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = (child.textContent || '').trim();
        if (text) pieces.push(text);
      } else if (child.nodeType === 1) {
        if (child.matches && child.matches(ignored)) return;
        walk(child);
      }
    });
  })(row);
  return pieces;
}

function rowNameElement(row) {
  const ignored = CUSTOMER_NAME_IGNORED_SELECTOR;
  let found = null;
  (function walk(node) {
    if (found) return;
    for (const child of node.childNodes) {
      if (found) return;
      if (child.nodeType === 3) {
        if ((child.textContent || '').trim().length > 1) {
          found = node;
          return;
        }
      } else if (child.nodeType === 1) {
        if (child.matches && child.matches(ignored)) continue;
        walk(child);
      }
    }
  })(row);
  return found;
}

function customerKeyFromRow(row) {
  const name = collectCustomerNameCandidates(row).find(piece => piece.length > 1);
  if (!name) return null;
  return name.replace(/\s+/g, ' ').toLowerCase();
}

function customerKeyIsGroupable(customerKey) {
  if (!customerKey) return false;
  if (customerKey.startsWith(CONTACT_KEY_PREFIX)) return true;
  if (customerKey.startsWith(EMAIL_KEY_PREFIX)) return true;
  return !companyAliasMap[normalizeKey(normalizeInboxText(customerKey))];
}

function identityCustomerKey(identity) {
  return identity.email
    ? `${EMAIL_KEY_PREFIX}${identity.email}`
    : `${CONTACT_KEY_PREFIX}${identity.contactId}`;
}

function identityKeysForRows(rows) {
  const identities = listIdentitiesForCurrentInbox();
  if (!identities) return null;

  const keys = new Map();
  identities.forEach((identity, conversationId) => {
    if (duplicateClosedConversations.has(conversationId)) return;
    keys.set(conversationId, identityCustomerKey(identity));
  });
  return keys.size ? keys : null;
}

function refreshDuplicateCustomerIdentity() {
  const teamId = getTeamIdFromHref(window.location.href);
  if (!teamId) return null;
  if (teamId !== duplicateIdentityTeamId) {
    duplicateStyleByCustomer = new Map();
    duplicateStylesAssigned = 0;
    duplicateIdentityTeamId = teamId;
    duplicateIdentitySignature = null;
    duplicateIdentityGroups = null;
    duplicateStripMemo = null;
    duplicateClosedConversations = new Set();
  }

  const rows = conversationListRows();
  if (!rows.length) return null;

  const identityKeys = identityKeysForRows(rows);
  const rowKeys = identityKeys ? null
    : rows.map(row => [row.getAttribute('data-conversation-id'), customerKeyFromRow(row)]);
  const signature = identityKeys
    ? `${listIdentityVersion}::${conversationListRowSignature()}`
    : `${listIdentityVersion}::${rowKeys.map(([id, key]) => `${id}=${key || ''}`).join(',')}`;
  if (duplicateIdentityGroups && signature === duplicateIdentitySignature) {
    return duplicateIdentityGroups;
  }

  duplicateRowIdentity = new Map();
  let identifiedEveryRow = true;

  if (identityKeys) {
    identityKeys.forEach((customerKey, conversationId) => {
      duplicateRowIdentity.set(conversationId, customerKey);
    });
  } else {
    rowKeys.forEach(([conversationId, customerKey]) => {
      if (!conversationId) return;
      if (duplicateClosedConversations.has(conversationId)) return;
      if (customerKey) duplicateRowIdentity.set(conversationId, customerKey);
      else identifiedEveryRow = false;
    });
  }

  const groups = new Map();
  duplicateRowIdentity.forEach((customerKey, conversationId) => {
    if (!groups.has(customerKey)) groups.set(customerKey, []);
    groups.get(customerKey).push(conversationId);
  });

  duplicateIdentitySignature = identifiedEveryRow ? signature : null;
  duplicateIdentityGroups = identifiedEveryRow ? groups : null;
  return groups;
}

function rememberDuplicateConversationOpen(conversationId) {
  if (!duplicateClosedConversations.delete(conversationId)) return;
  duplicateIdentitySignature = null;
  duplicateIdentityGroups = null;
}

function forgetDuplicateConversation(conversationId) {
  duplicateClosedConversations.add(conversationId);
  while (duplicateClosedConversations.size > DUPLICATE_CLOSED_MAX_CONVERSATIONS) {
    duplicateClosedConversations.delete(duplicateClosedConversations.values().next().value);
  }
  duplicateRowIdentity.delete(conversationId);
  duplicateIdentitySignature = null;
  duplicateIdentityGroups = null;

  if (!duplicateStripMemo) return;
  if (duplicateStripMemo.conversationId === conversationId) {
    duplicateStripMemo = null;
    return;
  }
  duplicateStripMemo.members = duplicateStripMemo.members.filter(id => id !== conversationId);
}

function duplicateHueClass(slot) {
  return `isa-dup-c${slot + 1}`;
}

function duplicateHueVariables(mode) {
  return DUPLICATE_HUES.map((hue, slot) => `
    .${duplicateHueClass(slot)} {
      --isa-dup-hue: ${mode === 'dark' ? hue.dark : hue.light};
      --isa-dup-ink: ${mode === 'dark' ? hue.darkInk : hue.lightInk};
    }`).join('');
}

const DUPLICATE_CUSTOMER_CSS = `${ROW_CHIP_TRAY_CSS}
    ${duplicateHueVariables('light')}

    @media (prefers-color-scheme: dark) {
      ${duplicateHueVariables('dark')}
    }

    .${DUPLICATE_ROW_CLASS} {
      position: relative !important;
    }

    .${DUPLICATE_ROW_CLASS}::before {
      content: '';
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      border: 1px solid var(--isa-dup-hue);
      border-radius: inherit;
      background-color: color-mix(in srgb, var(--isa-dup-hue) 8%, transparent);
      pointer-events: none;
    }

    .${DUPLICATE_ROW_CLASS}.${DUPLICATE_DASHED_CLASS}::before {
      border-style: dashed;
    }

    .${DUPLICATE_CHIP_CLASS} {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      align-self: center;
      flex: 0 0 auto;
      gap: 2px;
      height: 16px;
      padding: 0 5px;
      border-radius: 9999px;
      border: 1px solid color-mix(in srgb, var(--isa-dup-hue) 45%, transparent);
      font-size: 11px;
      font-weight: 600;
      line-height: 14px;
      color: var(--isa-dup-hue);
      background-color: color-mix(in srgb, var(--isa-dup-hue) 12%, transparent);
      white-space: nowrap;
    }

    .${DUPLICATE_STRIP_CLASS} {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 4px 0 6px;
      padding: 0 4px;
      font-size: 12px;
    }

    .${DUPLICATE_STRIP_CLASS} .${DUPLICATE_STRIP_GLYPH_CLASS} {
      color: var(--isa-dup-hue);
      font-size: 13px;
    }

    .${DUPLICATE_STRIP_CLASS} .${DUPLICATE_STRIP_LABEL_CLASS} {
      color: inherit;
      opacity: 0.65;
    }

    .${DUPLICATE_STRIP_CLASS} a {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      height: 18px;
      padding: 0 7px;
      border-radius: 9999px;
      border: 1px solid color-mix(in srgb, var(--isa-dup-hue) 40%, transparent);
      font-size: 11px;
      font-weight: 600;
      line-height: 16px;
      color: var(--isa-dup-hue);
      text-decoration: none;
      white-space: nowrap;
    }

    .${DUPLICATE_STRIP_CLASS} a[aria-current="true"] {
      border-color: var(--isa-dup-hue);
      background-color: var(--isa-dup-hue);
      color: var(--isa-dup-ink);
    }
  `;

function injectDuplicateCustomerStyle() {
  injectStyleOnce(DUPLICATE_STYLE_ID, DUPLICATE_CUSTOMER_CSS);
}

function clearDuplicateRow(row) {
  row.classList.remove(DUPLICATE_ROW_CLASS, DUPLICATE_DASHED_CLASS);
  DUPLICATE_HUES.forEach((_, slot) => row.classList.remove(duplicateHueClass(slot)));
  row.removeAttribute(DUPLICATE_GROUP_ATTRIBUTE);
  row.querySelectorAll(`.${DUPLICATE_CHIP_CLASS}`).forEach(chip => chip.remove());
  pruneRowChipTray(row);
}

function decorateDuplicateRow(row, customerKey, groupSize) {
  const style = duplicateStyleForCustomer(customerKey);
  const marker = `${customerKey}::${groupSize}::${style.index}`;

  const applyClasses = () => {
    const hueClass = duplicateHueClass(style.hueSlot);
    if (!row.classList.contains(DUPLICATE_ROW_CLASS)) row.classList.add(DUPLICATE_ROW_CLASS);
    if (!row.classList.contains(hueClass)) row.classList.add(hueClass);
    if (row.classList.contains(DUPLICATE_DASHED_CLASS) !== style.dashed) {
      row.classList.toggle(DUPLICATE_DASHED_CLASS, style.dashed);
    }
  };

  const existingChip = row.querySelector(`.${DUPLICATE_CHIP_CLASS}`);

  if (row.getAttribute(DUPLICATE_GROUP_ATTRIBUTE) === marker && existingChip) {
    applyClasses();
    const keptTray = rowChipTray(row);
    if (existingChip.parentElement !== keptTray) keptTray.appendChild(existingChip);
    return;
  }

  clearDuplicateRow(row);
  applyClasses();
  row.setAttribute(DUPLICATE_GROUP_ATTRIBUTE, marker);
  const tray = rowChipTray(row);

  const chip = createOwnElement('span');
  chip.className = DUPLICATE_CHIP_CLASS;
  chip.textContent = `⧉${groupSize}`;
  chip.title = `${groupSize} conversations from this customer in this inbox`;

  tray.appendChild(chip);
}

function duplicateGroupsByConversation() {
  const verdict = conversationListVerdict();
  if (verdict === LIST_VERDICT_UNKNOWN) return null;
  if (verdict === LIST_VERDICT_OTHER) return new Map();

  const groups = refreshDuplicateCustomerIdentity();
  if (!groups) return null;
  const duplicates = new Map();
  groups.forEach((conversationIds, customerKey) => {
    if (conversationIds.length < 2) return;
    if (!customerKeyIsGroupable(customerKey)) return;
    conversationIds.forEach(id => duplicates.set(id, {
      customerKey,
      groupSize: conversationIds.length
    }));
  });
  return duplicates;
}

function refreshDuplicateCustomerHighlights() {
  safeExecute(() => {
    injectDuplicateCustomerStyle();

    const duplicates = duplicateGroupsByConversation();
    if (!duplicates) return;

    conversationListRows().forEach((row) => {
      const group = duplicates.get(row.getAttribute('data-conversation-id'));
      if (group) {
        decorateDuplicateRow(row, group.customerKey, group.groupSize);
      } else if (row.hasAttribute(DUPLICATE_GROUP_ATTRIBUTE)
        || row.classList.contains(DUPLICATE_ROW_CLASS)) {
        clearDuplicateRow(row);
      }
    });

    refreshDuplicateCustomerStrip(duplicates);
  }, 'refreshDuplicateCustomerHighlights');
}

function findDuplicateStripHost() {
  const composer = queryIntercom(SELECTORS.composerContainer);
  if (composer && composer.parentElement) return composer.parentElement;
  return null;
}

function removeDuplicateStrips() {
  queryAllIntercom(`.${DUPLICATE_STRIP_CLASS}`).forEach(strip => strip.remove());
}

function mountedConversationIds() {
  return new Set(conversationListRows()
    .map(row => row.getAttribute('data-conversation-id'))
    .filter(Boolean));
}

function rememberedStripMembers(conversationId, customerKey, derivedMembers) {
  const mounted = mountedConversationIds();
  const remembered = (duplicateStripMemo && duplicateStripMemo.conversationId === conversationId
    && duplicateStripMemo.customerKey === customerKey)
    ? duplicateStripMemo.members
    : [];

  const survivors = remembered.filter(id =>
    !mounted.has(id) || duplicateRowIdentity.get(id) === customerKey);
  const members = [...new Set([...survivors, ...derivedMembers])];

  duplicateStripMemo = { conversationId, customerKey, members };
  return members;
}

function refreshDuplicateCustomerStrip(duplicateConversationIds) {
  const conversationId = getConversationId();
  if (!conversationId || conversationListVerdict() !== LIST_VERDICT_OPEN) {
    duplicateStripMemo = null;
    removeDuplicateStrips();
    return;
  }

  if (duplicateStripMemo && duplicateStripMemo.conversationId !== conversationId) {
    duplicateStripMemo = null;
  }

  const group = duplicateConversationIds.get(conversationId);
  const customerKey = group ? group.customerKey
    : (duplicateStripMemo ? duplicateStripMemo.customerKey : null);

  if (!customerKey) {
    removeDuplicateStrips();
    return;
  }

  const derived = [...duplicateRowIdentity.entries()]
    .filter(([, key]) => key === customerKey)
    .map(([id]) => id);
  const members = rememberedStripMembers(conversationId, customerKey, derived);

  if (members.length < 2) {
    duplicateStripMemo = null;
    removeDuplicateStrips();
    return;
  }

  const supportMembers = members
    .filter(memberId => inboundOriginForConversation(memberId)?.role === 'support');
  const marker = `${conversationId}::${members.join(',')}::${supportMembers.join(',')}`;
  const existing = queryAllIntercom(`.${DUPLICATE_STRIP_CLASS}`);
  if (existing.length === 1 && existing[0].getAttribute(DUPLICATE_GROUP_ATTRIBUTE) === marker) return;
  existing.forEach(strip => strip.remove());

  const host = findDuplicateStripHost();
  if (!host) return;

  const strip = createOwnElement('div');
  const style = duplicateStyleForCustomer(customerKey);
  strip.className = `${DUPLICATE_STRIP_CLASS} ${duplicateHueClass(style.hueSlot)}`;
  strip.setAttribute(DUPLICATE_GROUP_ATTRIBUTE, marker);

  strip.title = `${members.length} open conversations from this customer in this inbox`;

  const glyph = document.createElement('span');
  glyph.className = DUPLICATE_STRIP_GLYPH_CLASS;
  glyph.textContent = '⧉';
  strip.appendChild(glyph);

  const label = document.createElement('span');
  label.className = DUPLICATE_STRIP_LABEL_CLASS;
  label.textContent = `${members.length} open conversations from this customer`;
  strip.appendChild(label);

  members.forEach((memberId, index) => {
    const link = document.createElement('a');
    link.href = duplicateSiblingHref(memberId);
    const origin = inboundOriginForConversation(memberId);
    const support = origin && origin.role === 'support';
    link.textContent = support ? `${index + 1} ✉` : `${index + 1}`;
    if (support) link.title = `Arrived at ${origin.address}`;
    if (memberId === conversationId) link.setAttribute('aria-current', 'true');
    link.addEventListener('click', event => safeExecute(
      () => openSiblingConversation(event, memberId),
      'openSiblingConversation'
    ));
    strip.appendChild(link);
  });

  host.insertBefore(strip, host.firstChild);
}

function siblingRow(conversationId) {
  return conversationListRows()
    .find(candidate => candidate.getAttribute('data-conversation-id') === conversationId) || null;
}

function transitionToSibling(conversationId) {
  const href = conversationHrefInCurrentInbox(conversationId);
  window.history.pushState(window.history.state, '', href);
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}

function openSiblingConversation(event, conversationId) {
  if (event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  event.preventDefault();

  const row = siblingRow(conversationId);
  if (row) {
    row.click();
    return;
  }

  transitionToSibling(conversationId);

  window.setTimeout(() => safeExecute(() => {
    if (getConversationId() === conversationId) return;
    const settled = siblingRow(conversationId);
    if (settled) settled.click();
  }, 'openSiblingConversation settle'), SIBLING_TRANSITION_SETTLE_MS);
}

function conversationHrefInCurrentInbox(conversationId) {
  const { pathname, search } = window.location;
  const rewritten = pathname.replace(/\/conversations?\/\d+/, `/conversation/${conversationId}`);
  if (rewritten !== pathname) return `${rewritten}${search}`;
  return `${pathname.replace(/\/+$/, '')}/conversation/${conversationId}${search}`;
}

function duplicateSiblingHref(conversationId) {
  const row = conversationListRows()
    .find(candidate => candidate.getAttribute('data-conversation-id') === conversationId);
  const rowHref = row && row.getAttribute('href');
  if (rowHref && rowHref.includes('/inbox/team/')) return rowHref;
  return conversationHrefInCurrentInbox(conversationId);
}
