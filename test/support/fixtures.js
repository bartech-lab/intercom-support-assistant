'use strict';

function conversationAttrRow(id, label, value, valueClass = 'u__one-truncated-line') {
  return `
    <div id="conversation-attr-${id}" class="flex flex-row items-center align-center h-8">
      <label for="conversation-attr-${id}"
             class="flex-shrink-0 py-px inbox2__attribute__label border border-transparent truncate mr-px w-2/5">
        ${label}
      </label>
      <div class="w-3/5 px-1 border border-transparent">
        <div>
          <div class="popover__opener ds-new__dropdown__opener w-full">
            <button class="inbox2__select-attribute__button flex flex-row">
              <span class="${valueClass}">${value}</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function capturedAttrRow(id, label, value) {
  return `
    <div class="flex flex-row items-center align-center h-8" id="conversation-attr-${id}">
      <label for="conversation-attr-${id}"
             class="flex-shrink-0 py-px inbox2__attribute__label border border-transparent truncate mr-px w-2/5"
             data-popover-opener="ember204" data-test-popover-container="ember204">
        <svg class="interface-icon o__standard o__standard__fin" width="16" height="16"></svg>
        ${label}
      </label>
      <div class="w-3/5 px-1 border border-transparent">
        <div>
          <div class="popover__opener ds-new__dropdown__opener w-full" data-popover-opener="ember140">
            <button class="group border border-transparent flex flex-row o__open py-px px-1 inbox2__select-attribute__button justify-between items-center">
              <span class="u__one-truncated-line">${value}</span>
              <span class="ml-1 text-accent opacity-0"><svg width="8" height="8"></svg></span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function userDetailRow(label, valueHtml) {
  return `
    <div class="flex flex-row items-center h-8">
      <p class="w-2/5 py-px inbox2__attribute__label border border-transparent flex-shrink-0">
        <span class="truncate">${label}</span>
      </p>
      <p class="flex px-1 overflow-hidden border border-transparent w-3/5">
        <span class="flex overflow-hidden">${valueHtml}</span>
      </p>
    </div>`;
}

function teamInboxRow(name) {
  return `
    <div class="flex flex-row items-center h-8">
      <p class="w-2/5 py-px inbox2__attribute__label border border-transparent flex-shrink-0" data-popover-opener="team-inbox-label">Team Inbox</p>
      <p class="w-3/5 px-1 border border-transparent overflow-hidden">
        <div class="popover__opener overlay__opener" data-popover-opener="team-inbox-value">
          <div class="cursor-pointer" role="button">
            <div class="truncate flex items-center ml-1">
              <img class="w-4 h-4" src="x">
              <span class="ml-2">${name}</span>
            </div>
          </div>
        </div>
      </p>
    </div>`;
}

function sidebarSection({ teamInbox, conversationAttrs = [] } = {}) {
  const rows = [];
  if (teamInbox) rows.push(teamInboxRow(teamInbox));
  rows.push(...conversationAttrs);
  return `<div data-intercom-target="inbox-right-nav-details">
    <h2 class="u__one-truncated-line">Details</h2>
    ${rows.join('\n')}
  </div>`;
}

function userDetailsSection(rows = []) {
  return `<div data-intercom-target="user-details">${rows.join('\n')}</div>`;
}

function composer({ mode } = {}) {
  let paneButton = '';
  let noteSend = '';
  if (mode === 'email') {
    paneButton = `<button><svg class="interface-icon o__standard o__standard__email-filled"></svg><span>Email</span></button>`;
  } else if (mode === 'note') {
    paneButton = `<button><svg class="interface-icon o__standard o__standard__edit"></svg><span>Note</span></button>`;
    noteSend = `<button data-intercom-target="note-send-button"><span class="truncate">Add note</span></button>`;
  }

  const editor = `<div data-testid="composer-editor-area">
      <div contenteditable="true" role="textbox" dir="auto" data-insertable="true"
           class="ProseMirror embercom-prosemirror-composer-editor"><p></p></div>
    </div>`;

  return `<div data-testid="composer-orchestrator">
    <div class="inbox2__composer__container" data-conversation-reply-composer-root="">
      ${paneButton}
      <div data-conversation-reply-composer="">${editor}</div>
      ${noteSend}
      <button>Send</button>
    </div>
  </div>`;
}

function conversationSpace({ customerText = '', agentText = '', noteHtml = '', notePosition = 'last' } = {}) {
  const customerBlock = (body) => `<div data-testid="user-email-content" class="email-html-content--inbound">
         <div class="intercom-interblocks-html">${body}</div>
       </div>`;
  const customerParts = Array.isArray(customerText)
    ? customerText.filter(Boolean)
    : (customerText ? [customerText] : []);
  const customer = customerParts.map(customerBlock).join('\n');
  const agent = agentText
    ? `<div data-testid="teammate-email-reply-part">
         <div class="intercom-interblocks-html">${agentText}</div>
       </div>`
    : '';
  const note = noteHtml
    ? `<div class="conversation__note-part">
         <div class="intercom-interblocks-html">${noteHtml}</div>
         <div class="part-actions"><button data-testid="content-part-actions-edit-note">Edit</button></div>
       </div>`
    : '';
  const parts = notePosition === 'first'
    ? `${note}${agent}${customer}`
    : `${agent}${customer}${note}`;
  return `<div data-intercom-target="conversation-space" data-intercom-target-conversation-stream="">
    ${parts}
  </div>`;
}

function conversationToolbar({ close = true, snooze = false } = {}) {
  const closeBtn = close
    ? `<button><div class="flex items-center"><svg class="interface-icon o__standard o__standard__close-conversation"></svg></div>Close</button>`
    : '';
  const snoozeBtn = snooze
    ? `<button><div class="flex items-center"><svg class="interface-icon o__standard o__standard__snooze"></svg></div>Snooze</button>`
    : '';
  return `<div data-intercom-target="conversation-toolbar">${closeBtn}${snoozeBtn}</div>`;
}

function conversationHeader({ close = true, reopen = false } = {}) {
  const closeBtn = close
    ? `<button data-test-state-multiselect-close="true" aria-label="Close"><span>Close</span></button>`
    : '';
  const reopenBtn = reopen
    ? `<button data-test-state-multiselect-reopen="true" aria-label="Re-open"><span>Re-open</span></button>`
    : '';
  return `<div data-testid="conversation-header">${closeBtn}${reopenBtn}</div>`;
}

function inboxNavLink({ teamId, label, count = null } = {}) {
  const badge = count === null ? '' : `<span class="count">${count}</span>`;
  return `<a href="https://app.intercom.com/a/inbox/demo1234/inbox/team/${teamId}?view=List">
    <span class="label">${label}</span>${badge}
  </a>`;
}

function yourInboxNavLink({ adminId = '9003960', count = null, tagged = true, onAnchor = false } = {}) {
  const badge = count === null ? '' : `<span class="count">${count}</span>`;
  const target = onAnchor ? ' data-testid="left-nav-row" data-intercom-target="your-inbox"' : '';
  const anchor = `<a${target} href="/a/inbox/demo1234/inbox/admin/${adminId}?view=List" data-href-to-ignore="">
    <div class="inbox2__avatar"></div>
    <span class="label">Your inbox</span>${badge}
  </a>`;
  return tagged && !onAnchor ? `<div data-intercom-target="your-inbox">${anchor}</div>` : anchor;
}

function pinnedTeammateNavLink({ adminId, count = null } = {}) {
  const badge = count === null ? '' : `<span class="count">${count}</span>`;
  return `<a href="/a/inbox/demo1234/inbox/admin/${adminId}?view=List" data-href-to-ignore="">
    <span class="label">Teammate ${adminId}</span>${badge}
  </a>`;
}

function conversationListRow({
  conversationId,
  name,
  subject = 'Subject',
  preview = 'Preview text',
  age = '2h',
  initial = null,
  teamId = '123'
} = {}) {
  const avatarInitial = initial === null ? (name || '?').trim().charAt(0) : initial;
  const avatar = avatarInitial === ''
    ? ''
    : `<div class="inbox2__avatar">${avatarInitial}</div>`;
  return `<a tabindex="0" href="/a/inbox/demo1234/inbox/team/${teamId}/conversation/${conversationId}?view=List" class="ember-view group" data-conversation-id="${conversationId}">
    <div class="flex flex-row gap-1"><div class="flex flex-col items-end">${avatar}</div></div>
    <div class="flex flex-col flex-1 gap-2">
      <div class="flex flex-row items-center h-4">
        <div class="flex min-w-0 mr-2">
          <div class="text-sm leading-4 line-clamp-1 break-all font-semibold min-w-0">${name}</div>
        </div>
        <div class="flex flex-grow"></div>
      </div>
      <div class="line-clamp-1 break-all min-w-0">${subject}</div>
      <div class="line-clamp-2">${preview}</div>
      <div class="text-right">${age}</div>
    </div>
  </a>`;
}

function listStateFilter(count, state) {
  return `<div id="reference-ember92" class="popover__opener" data-popover-opener="ember92" data-intercom-target="filter-button">
    <button class="inbox2__button inbox2__button--small">
      <span class="text-sm truncate max-w-full">
      ${count}
      ${state}
    </span>
    </button>
  </div>`;
}

function conversationList(rows = [], { state = null, count = '27' } = {}) {
  const filter = state === null ? '' : listStateFilter(count, state);
  return `${filter}<div data-intercom-target-conversation-list="">${rows.join('\n')}</div>`;
}

function inboxNav(links = [], pinned = []) {
  const customizable = pinned.length
    ? `<div data-intercom-target="inbox-left-nav-customizable">${pinned.join('\n')}</div>`
    : '';
  return `<nav data-isa-test="inbox-nav" data-intercom-target="inbox-left-nav">${links.join('\n')}${customizable}</nav>`;
}

function inboxNavRows(links = []) {
  const rows = links.map(link => `<li data-slot="item">${link}</li>`).join('\n');
  return `<nav data-isa-test="inbox-nav"><ul>${rows}</ul></nav>`;
}

const emailValue = (email) => `<div class="popover__opener truncate">${email}</div>`;
const userIdValue = (id) => `<span class="truncate" data-original-user-id="${id}">${id}</span>`;

function emailMetadataContainer(collapsedText, extraClass = '') {
  return `<div data-testid="email-metadata-container" class="${extraClass}">
    <div data-testid="email-metadata-collapsed">${collapsedText}</div>
  </div>`;
}

function inboxHtml(sections = {}) {
  const {
    sidebar = '', userDetails = '', composer: comp = '', conversation = '',
    toolbar = '', nav = '', list = ''
  } = sections;
  return `<!doctype html><html><body>
    ${toolbar}
    ${nav}
    ${list}
    <div id="app">
      ${conversation}
      ${comp}
      <aside>${sidebar}${userDetails}</aside>
    </div>
  </body></html>`;
}

function reactUserAttributeRow(attributeId, label, valueHtml) {
  return `
    <div class="group flex items-center gap-2 py-1 text-support" data-test-attribute-row="${attributeId}">
      <span class="flex shrink-0 items-center gap-2 w-2/5 min-w-0 text-muted">
        <span class="truncate" data-test-attribute-label="${attributeId}">${label}</span>
      </span>
      ${valueHtml}
    </div>`;
}

const reactAttributeValue = (attributeId, value) =>
  `<span class="w-3/5 truncate text-default" data-test-attribute-value="${attributeId}">${value}</span>`;

const reactEmailValue = (email) =>
  `<button type="button" class="w-3/5 min-w-0 truncate text-left text-default" data-test-attribute-value="email">${email}</button>`;

function reactUserDetailsSection(rows = []) {
  return `<div data-test-sidebar-section-item="user-details" data-sidebar-section-id="user-details">
    <div data-module-body="true" class="p-6 pt-0 pb-4 px-6">
      <div class="flex flex-col gap-3"><div class="flex flex-col">${rows.join('\n')}</div></div>
    </div>
  </div>`;
}

function reactDuplicateCard(contactId, rows = []) {
  return `<div class="mt-4 px-4 py-3" data-testid="potential-duplicate-${contactId}">
    <div class="flex flex-col gap-3"><div class="flex flex-col">${rows.join('\n')}</div></div>
  </div>`;
}

function reactConversationAttrRow(attributeId, label, value) {
  return `
    <div class="flex flex-row items-center min-h-8" data-testid="sidebar-conversation-attribute-${attributeId}">
      <div class="w-2/5 py-px text-muted shrink-0 min-w-0">
        <span class="block truncate min-w-0"><span class="flex items-center gap-1">${label}</span></span>
      </div>
      <div class="w-3/5 px-1 min-w-0">
        <button type="button" aria-label="${label}" data-testid="dropdown-menu-trigger">
          <span class="min-w-0 flex-1 truncate">${value}</span>
        </button>
      </div>
    </div>`;
}

function reactTeamAssigneeRow(name) {
  return `
    <div class="flex flex-row items-center min-h-8" data-testid="sidebar-conversation-team-assignee">
      <div class="w-2/5 py-px text-muted shrink-0 min-w-0">
        <span class="block truncate min-w-0"><span>Team Inbox</span></span>
      </div>
      <div class="w-3/5 px-1 min-w-0">
        <div class="overflow-hidden">
          <button type="button" aria-label="Change team" data-testid="team-assignee-selector">
            <span class="truncate flex items-center ml-1 min-w-0">
              <img alt="" data-testid="team-icon" src="x">
              <span class="ml-2">${name}</span>
            </span>
          </button>
        </div>
      </div>
    </div>`;
}

function reactConversationIdRow(conversationId) {
  return `
    <div class="flex flex-row items-center min-h-8" data-testid="sidebar-conversation-id">
      <div class="w-2/5 py-px text-muted shrink-0 min-w-0"><span class="block truncate"><span>ID</span></span></div>
      <div class="w-3/5 px-1 min-w-0"><span class="truncate">${conversationId}</span></div>
    </div>`;
}

function reactSidebarSection({ teamInbox, conversationId, conversationAttrs = [] } = {}) {
  const rows = [];
  if (teamInbox) rows.push(reactTeamAssigneeRow(teamInbox));
  if (conversationId) rows.push(reactConversationIdRow(conversationId));
  rows.push(...conversationAttrs);
  return `<div data-sidebar-section-container="true" data-test-conversation-details-scroll-container="true">
    <div data-test-sidebar-section-item="conversation-details" data-sidebar-section-id="conversation-details">
      <div data-module-body="true">${rows.join('\n')}</div>
    </div>
  </div>`;
}

function reactConversationStream({ customerText = '' } = {}) {
  return `<div data-testid="conversation-stream-scroll-container">
    <div data-testid="conversation-part-id-90010615105" data-part-entity-id="9009845162">
      <div data-testid="user-email-content"><div class="intercom-interblocks-html">${customerText}</div></div>
    </div>
  </div>`;
}

module.exports = {
  conversationAttrRow,
  capturedAttrRow,
  userDetailRow,
  teamInboxRow,
  sidebarSection,
  userDetailsSection,
  composer,
  conversationSpace,
  conversationToolbar,
  conversationHeader,
  emailValue,
  userIdValue,
  emailMetadataContainer,
  inboxNavLink,
  yourInboxNavLink,
  pinnedTeammateNavLink,
  inboxNav,
  inboxNavRows,
  conversationListRow,
  conversationList,
  listStateFilter,
  inboxHtml,
  reactUserAttributeRow,
  reactAttributeValue,
  reactEmailValue,
  reactUserDetailsSection,
  reactDuplicateCard,
  reactConversationAttrRow,
  reactTeamAssigneeRow,
  reactConversationIdRow,
  reactSidebarSection,
  reactConversationStream
};
