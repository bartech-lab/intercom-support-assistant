'use strict';

const CAPTURE_CONVERSATION_ID = '900202944780203';
const CAPTURE_PART_ENTITY_ID = '90036310761';
const CAPTURE_PART_ID = '90004380487';
const CAPTURE_STREAM_INDEX = 19;
const CAPTURE_FILENAME = 'Invoice 01-JAN-26 REF 00000000 000000000000000000000.pdf';
const CAPTURE_SIZE = '1.25 MB';
const CAPTURE_DATE = '3d';
const CAPTURE_CUSTOMER_SENDER = 'Customer One <customer.one@example.com>';
const CAPTURE_TEAMMATE_SENDER = 'Alex from Brand <support@example.com>';
const CAPTURE_HREF = 'https://brand-000000000000.intercom-attachments-5.com/i/o/demo1234/1000000000/000000000000000000000000/statement.pdf?expires=1790000000&signature=0000000000000000000000000000000000000000000000000000000000000000';

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attachmentConversationHeader({
  conversationId = CAPTURE_CONVERSATION_ID,
  title = 'Customer One',
  subtitle = 'Deliveries',
  withTitle = true,
  withMore = true,
  withSnooze = true,
  nested = false,
  otherInstall = false
} = {}) {
  const titleBlock = withTitle
    ? `<div data-inbox-conversation-header-title="true">
         <div data-conversation-title="true"><span>${title}</span></div>
         <div data-test-conversation-subtitle="true"><span>${subtitle}</span></div>
       </div>`
    : '';
  const idAttribute = conversationId === null ? '' : ` data-conversation-id="${conversationId}"`;
  const moreButton = withMore
    ? '<button data-test-conversation-header-more="true" data-testid="dropdown-menu-trigger"><svg></svg></button>'
    : '';
  const snoozeButton = withSnooze
    ? '<button data-test-conversation-header-snooze="true" data-testid="tooltip-trigger"><svg></svg></button>'
    : '';
  const titleCluster = `<div>
      <button data-testid="sidebar-toggle-button" data-base-ui-tooltip-trigger=""><svg></svg></button>
      ${titleBlock}
    </div>`;
  const owner = otherInstall ? ' data-isa-attachments-owner="another-install"' : '';
  const foreignButton = otherInstall
    ? '<button class="isa-attachments-button" data-isa-own="attachments"></button>'
    : '';
  const actionCluster = `<div${owner}>
      ${foreignButton}
      <button data-test-urgent-button="true" data-testid="tooltip-trigger"><span></span></button>
      ${moreButton}
      ${snoozeButton}
      <div>
        <button data-test-state-multiselect-close="true" data-testid="tooltip-trigger"><span>Close</span></button>
      </div>
    </div>`;
  const body = nested
    ? `<div>${titleCluster}${actionCluster}</div>`
    : `${titleCluster}${actionCluster}`;
  return `<div data-testid="conversation-header"${idAttribute}>${body}</div>`;
}

function attachmentUpload({
  filename = CAPTURE_FILENAME,
  size = CAPTURE_SIZE,
  href = CAPTURE_HREF,
  withSize = true
} = {}) {
  const sizeNode = withSize ? `<span data-testid="upload-size">${size}</span>` : '';
  return `<div>
    <div data-testid="upload" data-base-ui-tooltip-trigger="">
      <div><svg><path></path></svg></div>
      <div>
        <a href="${href}" data-testid="upload-link">${filename}</a>
        ${sizeNode}
      </div>
    </div>
  </div>`;
}

function attachmentMessagePart({
  partId = CAPTURE_PART_ID,
  entityId = CAPTURE_PART_ENTITY_ID,
  index = CAPTURE_STREAM_INDEX,
  role = 'customer',
  sender = CAPTURE_CUSTOMER_SENDER,
  date = CAPTURE_DATE,
  uploads = [attachmentUpload()],
  withSender = true,
  withDate = true,
  withRole = true
} = {}) {
  const contentTestId = role === 'teammate' ? 'teammate-email-reply-part' : 'user-email-content';
  const contentAttribute = withRole ? ` data-testid="${contentTestId}"` : '';
  const senderNode = withSender
    ? `<div data-testid="email-metadata-sender"><span>${escapeText(sender)}</span></div>`
    : '';
  const dateNode = withDate
    ? `<div data-testid="metadata">
         <span>
           <span data-testid="channel-tooltip" data-base-ui-tooltip-trigger=""><svg></svg></span>
           <span data-base-ui-tooltip-trigger="" data-testid="tooltip-trigger">${date}</span>
         </span>
       </div>`
    : '';
  const uploadsNode = uploads.length
    ? `<div data-testid="uploads">${uploads.join('\n')}</div>`
    : '';
  return `<div data-index="${index}" data-part-entity-id="${entityId}">
    <div data-testid="conversation-part-id-${partId}">
      <div>
        <div data-base-ui-tooltip-trigger="" data-testid="tooltip-trigger">
          <span data-testid="avatar-root"><span data-testid="avatar-fallback"><span>P</span></span></span>
        </div>
      </div>
      <div>
        <div${contentAttribute}>
          <div data-testid="email-metadata-container">
            ${senderNode}
            <div data-testid="email-metadata-collapsed"><span><span>to:</span></span></div>
          </div>
          <div data-testid="email-content"><div data-copilot-selectable="true"><div>Message body</div></div></div>
          ${uploadsNode}
          ${dateNode}
        </div>
      </div>
    </div>
  </div>`;
}

function attachmentStream(parts = [attachmentMessagePart()]) {
  return `<div data-testid="conversation-stream-scroll-container">${parts.join('\n')}</div>`;
}

function attachmentComposer() {
  return `<div data-testid="composer-orchestrator">
    <div data-testid="composer-input" contenteditable="true"></div>
  </div>`;
}

module.exports = {
  CAPTURE_CONVERSATION_ID,
  CAPTURE_STREAM_INDEX,
  CAPTURE_FILENAME,
  CAPTURE_SIZE,
  CAPTURE_DATE,
  CAPTURE_TEAMMATE_SENDER,
  CAPTURE_HREF,
  attachmentConversationHeader,
  attachmentUpload,
  attachmentMessagePart,
  attachmentStream,
  attachmentComposer
};
