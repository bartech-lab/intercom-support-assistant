const SUPPORT_ORIGIN_ROW_CLASS = 'isa-support-origin-row';
const SUPPORT_ORIGIN_CHIP_CLASS = 'isa-support-origin-chip';
const SUPPORT_ORIGIN_STYLE_ID = 'isa-support-origin-style';
const SUPPORT_ORIGIN_ATTRIBUTE = 'data-isa-support-origin';
const SUPPORT_ORIGIN_INK = { light: '#525252', dark: '#a3a3a3' };

const CUSTOMER_NAME_IGNORED_SELECTOR = [
  SELECTORS.conversationListRowAvatar,
  `.${ROW_CHIP_TRAY_CLASS}`,
  `.${DUPLICATE_CHIP_CLASS}`,
  `.${SUPPORT_ORIGIN_CHIP_CLASS}`
].join(', ');

const SUPPORT_ORIGIN_CSS = `${ROW_CHIP_TRAY_CSS}
    .${SUPPORT_ORIGIN_ROW_CLASS} {
      position: relative !important;
      --isa-origin-ink: ${SUPPORT_ORIGIN_INK.light};
    }

    .${SUPPORT_ORIGIN_ROW_CLASS}::after {
      content: '';
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 4px;
      border-bottom: 2px dashed var(--isa-origin-ink);
      pointer-events: none;
    }

    .${SUPPORT_ORIGIN_CHIP_CLASS} {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      align-self: center;
      flex: 0 0 auto;
      height: 16px;
      padding: 0 5px;
      border: 1px solid ${SUPPORT_ORIGIN_INK.light};
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      line-height: 14px;
      color: ${SUPPORT_ORIGIN_INK.light};
      background-color: transparent;
      white-space: nowrap;
    }

    @media (prefers-color-scheme: dark) {
      .${SUPPORT_ORIGIN_ROW_CLASS} {
        --isa-origin-ink: ${SUPPORT_ORIGIN_INK.dark};
      }

      .${SUPPORT_ORIGIN_CHIP_CLASS} {
        border-color: ${SUPPORT_ORIGIN_INK.dark};
        color: ${SUPPORT_ORIGIN_INK.dark};
      }
    }
  `;

function injectSupportOriginStyle() {
  injectStyleOnce(SUPPORT_ORIGIN_STYLE_ID, SUPPORT_ORIGIN_CSS);
}

function clearSupportOriginRow(row) {
  row.classList.remove(SUPPORT_ORIGIN_ROW_CLASS);
  row.removeAttribute(SUPPORT_ORIGIN_ATTRIBUTE);
  row.querySelectorAll(`.${SUPPORT_ORIGIN_CHIP_CLASS}`).forEach(chip => chip.remove());
  pruneRowChipTray(row);
}

function decorateSupportOriginRow(row, address) {
  const applyClasses = () => {
    if (!row.classList.contains(SUPPORT_ORIGIN_ROW_CLASS)) {
      row.classList.add(SUPPORT_ORIGIN_ROW_CLASS);
    }
  };

  const existingChip = row.querySelector(`.${SUPPORT_ORIGIN_CHIP_CLASS}`);

  if (row.getAttribute(SUPPORT_ORIGIN_ATTRIBUTE) === address && existingChip) {
    applyClasses();
    const keptTray = rowChipTray(row);
    if (existingChip.parentElement !== keptTray) keptTray.appendChild(existingChip);
    return;
  }

  clearSupportOriginRow(row);
  applyClasses();
  row.setAttribute(SUPPORT_ORIGIN_ATTRIBUTE, address);
  const tray = rowChipTray(row);

  const chip = createOwnElement('span');
  chip.className = SUPPORT_ORIGIN_CHIP_CLASS;
  chip.textContent = '✉';
  chip.title = `Arrived at ${address}`;

  tray.appendChild(chip);
}

function refreshSupportOriginHighlights() {
  safeExecute(() => {
    injectSupportOriginStyle();

    const verdict = conversationListVerdict();
    if (verdict === LIST_VERDICT_UNKNOWN) return;

    const openOnly = verdict === LIST_VERDICT_OPEN;
    conversationListRows().forEach((row) => {
      const conversationId = row.getAttribute('data-conversation-id');
      const origin = openOnly && conversationId
        ? inboundOriginForConversation(conversationId)
        : null;
      if (origin && origin.role === 'support') {
        decorateSupportOriginRow(row, origin.address);
      } else if (row.hasAttribute(SUPPORT_ORIGIN_ATTRIBUTE)
        || row.classList.contains(SUPPORT_ORIGIN_ROW_CLASS)) {
        clearSupportOriginRow(row);
      }
    });
  }, 'refreshSupportOriginHighlights');
}

function refreshMultiRecipientEmailHighlights() {
  safeExecute(() => {
    injectMultiRecipientEmailHighlightStyle();
    queryAllIntercom(`.${MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CLASS}`).forEach(element => {
      element.classList.remove(MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CLASS);
    });

    if (!getVisibleTeamInboxName()?.trim() || !getCompanyFromAttributes()) return;

    queryAllIntercom(SELECTORS.emailMetadataContainer).forEach(container => {
      if (getEmailMetadataRecipients(container).length >= 2) {
        container.classList.add(MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CLASS);
      }
    });
  }, 'refreshMultiRecipientEmailHighlights');
}
