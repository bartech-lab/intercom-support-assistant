const companyAliasMap = (() => {
  const map = {};

  function register(alias, company) {
    if (!alias || !company) return;
    const key = normalizeKey(normalizeInboxText(String(alias)));
    if (key && !map[key]) {
      map[key] = company;
    }
  }

  Object.keys(companies).forEach((company) => {
    register(company, company);
  });

  Object.entries(companyAliases).forEach(([company, aliases]) => {
    (aliases || []).forEach(alias => register(alias, company));
  });

  return map;
})();
const companyAliasKeys = Object.keys(companyAliasMap);

function resolveCompanyName(rawValue) {
  if (!rawValue) return null;

  const normalizedValue = normalizeKey(normalizeInboxText(String(rawValue)));
  if (!normalizedValue) return null;

  if (companyAliasMap[normalizedValue]) {
    return companyAliasMap[normalizedValue];
  }

  const aliasMatch = companyAliasKeys.find(alias => normalizedValue.includes(alias));
  return aliasMatch ? companyAliasMap[aliasMatch] : null;
}

function getCompanyFromInboxName(inboxName) {
  const normalizedInboxKey = normalizeKey(normalizeInboxText(inboxName || ''));
  if (!normalizedInboxKey) return null;

  return companyKeys.find(key => normalizedInboxKey.includes(normalizeKey(key))) || null;
}

function isTeamSignatureInbox(inboxName) {
  const normalizedInboxKey = normalizeKey(normalizeInboxText(inboxName || ''));
  if (!normalizedInboxKey) return false;

  return teamSignatureInboxes.some(name => normalizeKey(normalizeInboxText(name)) === normalizedInboxKey);
}

function hasConversationContext() {
  return Boolean(getConversationId()) || isNewConversationView();
}

function detectInboxType() {
  if (!hasConversationContext()) {
    return null;
  }

  const rawInboxName = getVisibleTeamInboxName();
  const normalizedInboxName = normalizeInboxText(rawInboxName || '');
  const displayName = rawInboxName || '';
  const urlTeamId = getTeamIdFromHref(window.location.href);
  const companyFromUrlTeam = urlTeamId ? teamIdToCompany[urlTeamId] : null;
  const companyFromNetworkTeam = resolveNetworkTeamCompany(getConversationId());
  const companyFromTeam = companyFromNetworkTeam || companyFromUrlTeam;
  const companyFromAttribute = getCompanyFromAttributes();
  const companyFromMailbox = getCompanyFromInboundMailbox();
  const companyFromInbox = getCompanyFromInboxName(normalizedInboxName);

  if (normalizedInboxName && /^Notifications\b|Notifications$/i.test(normalizedInboxName)) {
    return null;
  }

  if (normalizedInboxName) {
    const isExcluded = excludedInboxes.some(excluded =>
      normalizedInboxName.toLowerCase() === excluded.toLowerCase()
    );
    if (isExcluded) {
      debugLog(`[Inbox Detection] Excluding signatures for: ${rawInboxName}`);
      const resolvedCompany = companyFromMailbox || companyFromAttribute || companyFromInbox || companyFromUrlTeam;
      if (resolvedCompany) {
        return {
          type: 'excluded',
          name: resolvedCompany,
          teamId: urlTeamId || null,
          displayName
        };
      }
      return null;
    }

    if (isTeamSignatureInbox(normalizedInboxName)) {
      return {
        type: 'team',
        name: 'TEAM',
        displayName: rawInboxName
      };
    }
  }

  const uniqueCandidates = [...new Set([companyFromMailbox, companyFromAttribute, companyFromInbox, companyFromTeam].filter(Boolean))];
  const hasConflict = uniqueCandidates.length > 1;
  const resolvedCompany = companyFromNetworkTeam || companyFromMailbox
    || companyFromAttribute || companyFromInbox || companyFromUrlTeam;

  if (hasConflict && !sidebarLagsConversation()) {
    supportNoteOnce(
      `company-conflict-${uniqueCandidates.join('-')}`,
      '[Inbox Detection] Conflicting brand signals: ' +
        `Mailbox=${companyFromMailbox || '-'}, Brand=${companyFromAttribute || '-'}, Inbox=${companyFromInbox || '-'}, ` +
        `UrlTeam=${companyFromUrlTeam || '-'}, NetTeam=${companyFromNetworkTeam || '-'} ` +
        `-> using ${resolvedCompany}`
    );
  }

  if (resolvedCompany) {
    return {
      type: 'company',
      name: resolvedCompany,
      teamId: urlTeamId || null,
      displayName,
      sources: {
        mailbox: companyFromMailbox,
        attribute: companyFromAttribute,
        inbox: companyFromInbox,
        urlTeam: companyFromUrlTeam,
        networkTeam: companyFromNetworkTeam
      },
      signatureSafe: !hasConflict || Boolean(companyFromTeam && companyFromTeam === resolvedCompany)
    };
  }

  return null;
}

function getCompanyFromAttributes(options = {}) {
  const { allowRaw = false } = options;
  return passCached(`companyFromAttributes:${allowRaw}`,
    () => computeCompanyFromAttributes(allowRaw));
}

function getCompanyFromInboundMailbox() {
  const conversationId = typeof getConversationId === 'function' ? getConversationId() : null;
  if (!conversationId) return null;
  if (typeof resolveInboundMailboxCompany !== 'function') return null;
  return passCached('companyFromInboundMailbox',
    () => resolveInboundMailboxCompany(conversationId));
}

function getCompanyFromNetwork() {
  const conversationId = typeof getConversationId === 'function' ? getConversationId() : null;
  if (!conversationId) return null;

  const rawCompany = typeof resolveNetworkCompany === 'function' ? resolveNetworkCompany(conversationId) : null;
  if (!rawCompany) return null;

  return resolveCompanyName(rawCompany) || null;
}

function computeCompanyFromAttributes(allowRaw) {
  const networkCompany = getCompanyFromNetwork();
  if (networkCompany) return networkCompany;

  const attributeContainers = getAttributeRows();

  for (const container of attributeContainers) {
    if (!rowLabelMatches(container, FIELD_LABELS.company) && !rowLabelMatches(container, FIELD_LABELS.companyWithColon)) {
      continue;
    }

    const valueElement = getRowValueElement(container, [
      SELECTORS.attributeValue,
      SELECTORS.userIdPrimaryValue,
      SELECTORS.userIdFallbackValue,
      SELECTORS.userIdLooseValue
    ]);

    if (!valueElement) continue;

    const companyName = valueElement.textContent.trim();
    if (!companyName) continue;

    const matchedCompany = resolveCompanyName(companyName);
    if (matchedCompany) {
      return matchedCompany;
    }

    if (allowRaw) {
      return companyName;
    }
  }
  return null;
}
