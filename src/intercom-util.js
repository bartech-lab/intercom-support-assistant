function safeExecute(fn, context = '', fallback = null) {
  try {
    return fn();
  } catch (e) {
    console.error(`[Error] ${context}:`, e);
    return fallback;
  }
}

let currentConversationId = null;
let cachedLanguageDetection = { conversationId: null, language: null, provisional: false };
let lastDetectionHadNoEvidence = false;
let debugEnabled = false;
const issuedSupportWarnings = new Set();
let lastComposerMiddleClickAt = 0;
let lastAppliedSenderEmail = null;
let lastAttemptedSenderEmail = null;
let lastObservedSenderEmail = null;
let teamInboxApplyCount = 0;
let applyingTeamInbox = false;
let teamInboxApplyGeneration = 0;
let inFlightTeamInboxTarget = null;

let passCacheActive = false;
let passCache = new Map();

function runWithPassCache(fn) {
  const alreadyInSession = passCacheActive;
  passCacheActive = true;
  try {
    return fn();
  } finally {
    if (!alreadyInSession) {
      passCacheActive = false;
      passCache.clear();
    }
  }
}

function passCached(key, compute) {
  if (!passCacheActive) return compute();
  if (passCache.has(key)) return passCache.get(key);
  const value = compute();
  passCache.set(key, value);
  return value;
}

function debugLog(...args) {
  if (debugEnabled) console.log(...args);
}

function supportWarnOnce(key, ...args) {
  const conversationKey = `${currentConversationId || 'unknown'}:${key}`;
  if (issuedSupportWarnings.has(conversationKey)) return;
  issuedSupportWarnings.add(conversationKey);
  console.warn(...args);
}

function supportNoteOnce(key, ...args) {
  const conversationKey = `${currentConversationId || 'unknown'}:${key}`;
  if (issuedSupportWarnings.has(conversationKey)) return;
  issuedSupportWarnings.add(conversationKey);
  console.debug(...args);
}

const CONFIG = window.ISA_INTERCOM_CONFIG;
const SIGNATURE_NORMALIZER = window.ISA_SIGNATURE_NORMALIZER;
const REQUIRED_RUNTIME_CONFIG = {
  excludedInboxes: 'array',
  alertInboxPattern: 'string',
  alertableInboxesSeed: 'array',
  retiredAlertInboxIds: 'array',
  promotionalBanners: 'object',
  companies: 'object',
  companySignatureLinkMap: 'object',
  companyAliases: 'object',
  teamSignature: 'object',
  teamSignatureInboxes: 'array',
  teamIdToCompany: 'object',
  greetingPools: 'object',
  senderFromEmailToInbox: 'object',
  supportInboundLocalParts: 'array'
};

function isRuntimePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function assertRuntimeConfig(config, normalizer) {
  if (!isRuntimePlainObject(config)) {
    throw new Error('Missing Intercom runtime config');
  }

  Object.entries(REQUIRED_RUNTIME_CONFIG).forEach(([name, expectedType]) => {
    const value = config[name];
    if (expectedType === 'array') {
      if (!Array.isArray(value)) {
        throw new Error(`Invalid Intercom runtime config: ${name} must be an array`);
      }
      return;
    }

    if (expectedType === 'string') {
      if (typeof value !== 'string') {
        throw new Error(`Invalid Intercom runtime config: ${name} must be a string`);
      }
      return;
    }

    if (!isRuntimePlainObject(value)) {
      throw new Error(`Invalid Intercom runtime config: ${name} must be an object`);
    }
  });

  if (!isRuntimePlainObject(normalizer) || typeof normalizer.normalizeCompanySignatures !== 'function') {
    throw new Error('Missing signature normalizer');
  }
}

try {
  assertRuntimeConfig(CONFIG, SIGNATURE_NORMALIZER);
} catch (error) {
  console.error('[Intercom Support Assistant / Intercom] Runtime bootstrap failed. intercom-config.js and signature-normalizer.js must load before intercom-util.js.', error);
  throw error;
}

const {
  excludedInboxes,
  alertInboxPattern,
  alertableInboxesSeed,
  retiredAlertInboxIds,
  promotionalBanners,
  companies,
  companySignatureLinkMap,
  companyAliases,
  teamSignature,
  teamSignatureInboxes,
  teamIdToCompany,
  greetingPools,
  senderFromEmailToInbox
} = CONFIG;

const SIGNATURE_LANGUAGES = ['english', 'german', 'french', 'italian', 'portuguese', 'spanish', 'dutch'];

const ALERT_INBOX_PATTERN = new RegExp(alertInboxPattern, 'i');

const normalizedCompanies = SIGNATURE_NORMALIZER.normalizeCompanySignatures(companies, companySignatureLinkMap);

Object.entries(normalizedCompanies).forEach(([companyName, config]) => {
  const banner = promotionalBanners[companyName];
  if (!banner) return;
  if (banner.expires && Date.now() > Date.parse(banner.expires + 'T23:59:59.999Z')) return;
  SIGNATURE_LANGUAGES.forEach(lang => {
    if (banner[lang] && config[lang]) {
      config[lang] = '<br>' + banner[lang] + config[lang];
    }
  });
});

const LOOKALIKE_LETTER_MAP = {
  '\u0421': 'C', '\u0441': 'c',
  '\u041E': 'O', '\u043E': 'o',
  '\u0410': 'A', '\u0430': 'a',
  '\u0415': 'E', '\u0435': 'e',
  '\u041D': 'H', '\u043D': 'h',
  '\u041A': 'K', '\u043A': 'k',
  '\u0420': 'P', '\u0440': 'p',
  '\u0422': 'T', '\u0442': 't',
  '\u0425': 'X', '\u0445': 'x',
  '\u0412': 'B', '\u0432': 'b',
  '\u041C': 'M', '\u043C': 'm'
};

const FIELD_LABELS = {
  teamInbox: 'Team Inbox',
  email: 'Email',
  company: 'Brand',
  companyWithColon: 'Brand:',
  location: 'Location',
  language: 'Language',
  userId: 'User id',
  escalationStatus: 'Escalation Status',
  conversationId: 'ID'
};

const FIELD_ATTRIBUTE_IDS = {
  Language: 'language'
};

const SINGLE_EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

const MULTI_RECIPIENT_EMAIL_HIGHLIGHT_CLASS = 'isa-multi-recipient-email-highlight';
const MULTI_RECIPIENT_EMAIL_HIGHLIGHT_STYLE_ID = 'isa-multi-recipient-email-highlight-style';

const ATTACHMENT_OWNER_ATTRIBUTE = 'data-isa-attachments-owner';

const EMAIL_ADDRESS_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;

const SELECTORS = {
  sidebarAttributeRows: '[data-intercom-target="inbox-right-nav-details"] .flex.flex-row.items-center',
  userDetailsAttributeRows: '[data-intercom-target="user-details"] .flex.flex-row.items-center',
  conversationAttributeRows: '[id^="conversation-attr-"]',
  reactUserAttributeRows: '[data-test-attribute-row]',
  reactConversationAttributeRows: '[data-testid^="sidebar-conversation-"]',
  duplicateSuggestionCard: '[data-testid^="potential-duplicate-"]',
  fallbackAttributeRows: '.flex.flex-row.items-center.h-8, .flex.flex-row.items-center.h-10',
  sidebarSection: '[data-intercom-target="inbox-right-nav-details"]',
  reactSidebarSection: '[data-test-conversation-details-scroll-container="true"]',
  fallbackSidebarSection: '.inbox2__conversation-details-sidebar, [data-sidebar-section-container]',
  inboxRows: '.flex.flex-row.items-center',
  inboxRowLabel: '.inbox2__attribute__label, [data-popover-opener]',
  inboxName: '.truncate.flex.items-center span, .truncate span',
  attributeLabelInner: '.inbox2__attribute__label .truncate',
  attributeLabel: '.inbox2__attribute__label',
  reactAttributeLabel: '[data-test-attribute-label]',
  reactConversationAttributeLabel: '[data-testid^="sidebar-conversation-"] > .w-2\\/5 > .truncate',
  reactAttributeValue: '[data-test-attribute-value]',
  reactValueColumn: '[class*="w-3/5"]',
  reactConversationIdRow: '[data-testid="sidebar-conversation-id"]',
  emailValue: '.popover__opener.truncate',
  conversationListContainer: '[data-intercom-target-conversation-list], [data-intercom-target="conversation-list"], [data-testid="conversation-listbox"]',
  conversationListRow: 'a[data-conversation-id]',
  conversationListRowAvatar: '.inbox2__avatar, [data-testid="conversation-list-row-avatar-slot"]',
  conversationListRowMeta: '[data-testid="conversation-list-row-meta"]',
  conversationListStateFilter: '[data-intercom-target="filter-button"], [data-testid="state-filter-trigger"]',
  yourInboxNavEntry: '[data-intercom-target="your-inbox"]',
  yourInboxNavLink: 'a[data-intercom-target="your-inbox"][href*="/inbox/admin/"], [data-intercom-target="your-inbox"] a[href*="/inbox/admin/"]',
  yourInboxNavScope: '[data-intercom-target="inbox-left-nav-customizable"]',
  emailMetadataContainer: '[data-testid="email-metadata-container"]',
  emailMetadataCollapsed: '[data-testid="email-metadata-collapsed"]',
  attributeValue: '[data-test-attribute-value], .u__one-truncated-line, .w-3\\/5 .truncate, .w-3\\/5 span',
  userIdContainers: '.flex.flex-row.items-center.h-8',
  userIdPrimaryValue: '.w-3\\/5 span.truncate',
  userIdFallbackValue: '.w-3\\/5 .truncate',
  userIdLooseValue: '[class*="w-3/5"] span',
  customerMessageBlocks: '[data-testid="user-email-content"], .email-html-content--inbound',
  clientMessages: '.inbox2__user-email-content .intercom-interblocks-html, .inbox2__user-email-content .interblocks-html',
  conversationSpace: '[data-intercom-target="conversation-space"]',
  conversationStreamFallback: '[data-intercom-target-conversation-stream]',
  reactConversationStream: '[data-testid="conversation-stream-scroll-container"]',
  locationValue: '.w-3\\/5 .truncate',
  composerContainer: '[data-testid="composer-orchestrator"]',
  composerContainerFallback: '.inbox2__composer__container, [data-conversation-reply-composer-root], [data-conversation-reply-composer]',
  composerPaneEmailIcon: 'svg.o__standard__email-filled',
  composerPaneNoteIcon: 'svg.o__standard__edit',
  noteSendButton: '[data-intercom-target="note-send-button"]',
  sendButtonFallback: '[data-testid="send-button"]',
  textEditor: '[data-testid="composer-editor-area"] .ProseMirror, .ProseMirror[contenteditable="true"], [role="textbox"][contenteditable="true"]',
  composerEditorMatch: '.ProseMirror[contenteditable="true"], [data-insertable="true"][contenteditable="true"], .embercom-prosemirror-composer-editor[contenteditable="true"]',
  composerModeLabel: 'button span, [role="button"] span, button, [role="button"]',
  inProgressStatusText: '.u__one-truncated-line',
  conversationToolbar: '[data-intercom-target="conversation-toolbar"]',
  conversationHeader: '[data-testid="conversation-header"]',
  modernCloseButton: 'button[data-test-state-multiselect-close="true"][aria-label="Close"]',
  modernReopenButton: 'button[data-test-state-multiselect-reopen="true"][aria-label="Re-open"]',
  closeConversationIcon: 'svg.o__standard__close-conversation',
  snoozeIcon: 'svg.o__standard__snooze',
  reopenConversationIcon: 'svg.o__standard__reopen-conversation',
  agentReplyPart: '[data-testid="teammate-email-reply-part"]',
  noteEditAction: '[data-testid="content-part-actions-edit-note"]',
  partContentHtml: '.intercom-interblocks-html, .interblocks-html',
  senderSelectorField: '[data-sender-selector-field]',
  draftChannelPicker: '[data-testid="new-conversation-channel-picker"]',
  draftSenderArea: '[data-testid="composer-sender-area"]',
  draftSenderPill: '[data-test-sender-pill="true"]',
  draftTeamAssigneeRow: '[data-testid="draft-team-assignee"]',
  draftTeamAssigneeValue: '[data-testid="team-assignee-selector"]',
  draftRecipientRow: '[data-testid="recipient-to-row"]',
  draftRecipientInput: '[data-testid="recipient-to-input"]',
  draftRecipientSelector: '[data-testid="recipient-selector"]',
  composerActionsBar: '[data-testid="composer-actions-bar"]',
  senderPillContent: '.inbox2__name-and-email-pill-content',
  senderDropdown: '.inbox2__outbound-sender-dropdown',
  senderOptionRow: '[role="button"]',
  assignMenu: '[data-intercom-target-action-menu="assign-to"]',
  assignSearchInput: 'input[data-command-k-input], #cmd-k-input',
  assignOptionsPane: '[data-command-k-assignment-pane]',
  assignOptionName: 'span.flex-grow.truncate',
  assignPalette: '[data-command-palette]',
  assignPaletteOption: '[role="option"][id*="-assign-team-"]'
};

const ANCHOR_HEALTH_VERSION = 1;
const DOM_CAPTURE_MESSAGE = 'isa-dom-capture';
const CANDIDATE_LIMIT = 40;
const CANDIDATE_ATTRIBUTES = [
  { key: 'testid', attribute: 'data-testid', selector: '[data-testid]' },
  { key: 'intercomTarget', attribute: 'data-intercom-target', selector: '[data-intercom-target]' },
  { key: 'ariaLabel', attribute: 'aria-label', selector: 'svg[aria-label], button[aria-label], [role="button"][aria-label]' }
];

const TRUNCATABLE_PANELS = [
  {
    id: 'conversationAttributes',
    label: 'Conversation attributes',
    seeAll: '[data-testid="see-all-attributes"]',
    fields: ['company', 'language', 'escalationStatus']
  },
  {
    id: 'userAttributes',
    label: 'User data',
    seeAll: '[data-testid="see-all-user-attributes"]',
    fields: ['email', 'userId', 'location']
  }
];

const CRITICAL_ANCHORS = [
  {
    id: 'attributeRows', label: 'Sidebar attribute rows', feature: 'Brand detection, close safeguards', views: 'conversation',
    selectors: ['conversationAttributeRows', 'sidebarAttributeRows', 'userDetailsAttributeRows', 'reactUserAttributeRows', 'reactConversationAttributeRows']
  },
  {
    id: 'attributeLabel', label: 'Attribute row labels', feature: 'Row lookup by label', views: 'conversation',
    backup: 'rowLabel',
    selectors: ['attributeLabel', 'inboxRowLabel', 'reactAttributeLabel', 'reactConversationAttributeLabel']
  },
  {
    id: 'attributeValue', label: 'Attribute row values', feature: 'Customer email and user id', views: 'conversation',
    selectors: ['emailValue', 'attributeValue', 'reactAttributeValue']
  },
  {
    id: 'conversationSurface', label: 'Conversation stream', feature: 'Language detection, duplicates', views: 'conversation',
    selectors: ['conversationSpace', 'conversationStreamFallback', 'reactConversationStream']
  },
  {
    id: 'customerMessages', label: 'Customer message blocks', feature: 'Language detection, support origin', views: 'conversation',
    absentWhen: 'agentReplyPart',
    selectors: ['customerMessageBlocks', 'clientMessages']
  },
  {
    id: 'composer', label: 'Reply composer', feature: 'Signature insertion', views: 'conversation',
    selectors: ['composerContainer', 'composerContainerFallback']
  },
  {
    id: 'composerEditor', label: 'Composer editor', feature: 'Signature insertion target', views: ['conversation', 'new-conversation'],
    selectors: ['textEditor', 'composerEditorMatch']
  },
  {
    id: 'composerMode', label: 'Email versus note mode', feature: 'Fail-closed signature guard', views: 'conversation',
    selectors: ['composerPaneEmailIcon', 'noteSendButton', 'sendButtonFallback']
  },
  {
    id: 'closeAction', label: 'Conversation state control', feature: 'Close guard', views: 'conversation',
    selectors: ['modernCloseButton', 'modernReopenButton', 'closeConversationIcon', 'reopenConversationIcon']
  },
  {
    id: 'escalationStatus', label: 'Escalation Status row', feature: 'Close guard', views: 'conversation',
    probe: 'escalationStatus',
    selectors: []
  },
  {
    id: 'draftChannel', label: 'Draft channel picker', feature: 'New conversation composer mode', views: 'new-conversation',
    selectors: ['draftChannelPicker']
  },
  {
    id: 'draftSender', label: 'Draft sender', feature: 'Sender to Team Inbox autoselect', views: 'new-conversation',
    selectors: ['draftSenderArea', 'draftSenderPill', 'senderSelectorField']
  },
  {
    id: 'draftTeamInbox', label: 'Draft Team Inbox', feature: 'Team Inbox autoselect', views: 'new-conversation',
    selectors: ['draftTeamAssigneeRow', 'draftTeamAssigneeValue']
  },
  {
    id: 'draftRecipient', label: 'Draft recipient field', feature: 'Signature language from the recipient', views: 'new-conversation',
    selectors: ['draftRecipientRow', 'draftRecipientInput', 'draftRecipientSelector']
  },
  {
    id: 'composerActions', label: 'Composer actions bar', feature: 'Signature language picker', views: 'new-conversation',
    selectors: ['composerActionsBar']
  },
  {
    id: 'conversationList', label: 'Conversation list', feature: 'Inbox alerts, duplicate marks', views: ['conversation', 'inbox-list'],
    selectors: ['conversationListContainer', 'conversationListRow', 'conversationListRowAvatar']
  },
  {
    id: 'yourInboxNav', label: 'Your inbox nav entry', feature: 'Your inbox alerts', views: 'inbox-list',
    selectors: ['yourInboxNavEntry', 'yourInboxNavScope']
  },
  {
    id: 'assignMenu', label: 'Assignment menu', feature: 'Team Inbox picker', views: 'any', transient: true,
    selectors: ['assignMenu', 'assignSearchInput', 'assignOptionsPane', 'assignPalette', 'assignPaletteOption']
  }
];

const TEAM_INBOX_SELECT_MAX_ATTEMPTS = 60;
const TEAM_INBOX_SELECT_RETRY_MS = 60;
const TEAM_INBOX_MAX_APPLIES_PER_SENDER = 2;
const TEAM_INBOX_COMMIT_FALLBACK_ATTEMPTS = 8;
const TEAM_INBOX_SUPPRESS_MS =
  TEAM_INBOX_SELECT_MAX_ATTEMPTS * TEAM_INBOX_SELECT_RETRY_MS + 500;
const SENDER_SELECTION_MAX_ATTEMPTS = 12;
const SENDER_SELECTION_RETRY_MS = 60;

const TIMING = {
  mutationThrottleMs: 100,
  alertSettleMs: 1500,
  listStateGraceMs: 2000,
  passHeartbeatMs: 1000
};

const IN_PROGRESS_HIGHLIGHT_CLASS = 'isa-in-progress-highlight';
const IN_PROGRESS_STYLE_ID = 'isa-in-progress-highlight-style';
const ASSIGN_SUPPRESS_CLASS = 'isa-assigning';
const IN_PROGRESS_BLOCK_MESSAGE = 'You can\'t close the ticket while the "Escalation Status" attribute is "In Progress"';
const NOTE_LINK_BLOCK_MESSAGE = 'You can\'t close the ticket: the last message is an internal note with a Slack, Jira, or Linear link. Snooze it instead';
const TRACKER_LINK_PATTERN = /slack\.com|atlassian\.net|jira|linear\.app/i;

const LANG_ENGLISH_WORDS = ['the', 'and', 'you', 'that', 'was', 'for', 'are', 'with', 'his', 'they', 'this', 'have', 'from', 'word', 'what', 'said', 'each', 'which', 'she', 'how', 'their', 'will', 'about', 'could', 'other', 'after', 'first', 'these', 'want', 'way', 'many', 'use', 'her', 'make', 'like', 'into', 'him', 'has', 'two', 'more', 'very', 'know', 'just', 'also', 'back', 'than', 'only', 'those', 'come', 'day', 'most', 'us', 'is', 'it', 'to', 'of', 'in', 'a', 'on', 'at', 'by', 'as', 'or', 'if', 'be', 'do', 'go', 'get', 'see', 'can', 'say', 'all', 'now', 'my', 'me', 'we', 'he', 'so', 'no', 'up', 'out', 'down', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'any', 'both', 'few', 'some', 'such', 'own', 'same', 'too', 'but', 'not', 'yes', 'hello', 'hi', 'thanks', 'thank', 'please', 'dear', 'regards', 'best', 'package', 'shipping', 'order', 'delivery', 'parcel', 'help', 'support', 'customer', 'team', 'message', 'email', 'contact'];
const LANG_FRENCH_WORDS = ['et', 'pas', 'bonjour', 'merci', 'svp', 'vous', 'avez', 'être', 'est', 'sont', 'pour', 'dans', 'avec', 'très', 'bien', 'oui', 'non', 'je', 'tu', 'il', 'elle', 'nous', 'ils', 'elles', 'le', 'la', 'les', 'un', 'une', 'des', 'ce', 'cette', 'ces', 'mon', 'ton', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses', 'notre', 'votre', 'leur', 'nos', 'vos', 'leurs', 'du', 'au', 'aux', 'qui', 'quoi', 'dont', 'où', 'quand', 'comment', 'pourquoi', 'parce', 'car', 'mais', 'donc', 'or', 'voici', 'voilà', 'voila', 'bonsoir', 'commande', 'colis', 'livraison', 'adresse', 'aide', 'veuillez', 'pourriez', 'toujours', 'encore', 'jamais', 'rien', 'pouvez', 'voudrais', 'reçu', 'problème', 'demande', 'réponse', 'jours', 'semaine', 'cordialement', 'envoyé de', 'envoyé depuis'];
const LANG_GERMAN_WORDS = ['und', 'nicht', 'bitte', 'danke', 'kann', 'ich', 'sie', 'haben', 'ist', 'sind', 'war', 'der', 'die', 'das', 'ein', 'eine', 'zu', 'auf', 'mit', 'für', 'von', 'an', 'bei', 'nach', 'aus', 'durch', 'über', 'unter', 'vor', 'hinter', 'neben', 'zwischen', 'ja', 'nein', 'gut', 'schlecht', 'sehr', 'viel', 'wenig', 'hier', 'da', 'dort', 'jetzt', 'dann', 'später', 'früher', 'heute', 'morgen', 'gestern', 'warum', 'habe', 'keine', 'kein', 'mein', 'meine', 'wurde', 'noch', 'schon', 'immer', 'wieder', 'leider', 'lieferung', 'bestellung', 'sendung', 'rücksendung', 'hilfe', 'guten', 'woche', 'gesendet'];
const LANG_ITALIAN_WORDS = ['non', 'grazie', 'per favore', 'può', 'posso', 'avere', 'essere', 'sono', 'il', 'la', 'lo', 'gli', 'le', 'un', 'uno', 'una', 'con', 'su', 'tra', 'fra', 'sì', 'no', 'buono', 'cattivo', 'molto', 'poco', 'qui', 'lì', 'ora', 'poi', 'dopo', 'prima', 'oggi', 'domani', 'ieri', 'salve', 'vorrei', 'ricevere', 'ricevuta', 'promozione', 'tramite', 'consegna', 'pacco', 'adesso', 'ancora', 'perché', 'però', 'scusi', 'cortesemente', 'spedizione', 'indirizzo', 'ciao', 'buongiorno', 'buonasera', 'settimana', 'giorni', 'risposta', 'richiesta', 'inviato da', 'inviato dal'];

const LANG_PORTUGUESE_WORDS = ['não', 'obrigado', 'obrigada', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'você', 'estou', 'tenho', 'pode', 'fazer', 'muito', 'também', 'ainda', 'quando', 'onde', 'minha', 'pacote', 'morada', 'encomenda', 'ajuda', 'sempre', 'agora', 'gostaria', 'nenhum', 'já', 'foi', 'porquê', 'através', 'entrega', 'devolução', 'encomendas', 'nao', 'voce', 'tambem', 'fatura', 'resposta', 'ontem', 'hoje', 'amanhã', 'quero', 'meu', 'uma', 'são', 'suporte', 'explicação', 'enviado do', 'enviado a partir do'];

const LANG_SPANISH_WORDS = ['hola', 'gracias', 'buenos', 'buenas', 'días', 'usted', 'ustedes', 'vosotros', 'señor', 'señora', 'quiero', 'quisiera', 'necesito', 'puedo', 'pueden', 'tengo', 'estoy', 'hacer', 'paquete', 'pedido', 'dirección', 'devolución', 'ahora', 'siempre', 'muy', 'todavía', 'ayuda', 'pero', 'también', 'año', 'mucho', 'muchas', 'ninguno', 'gustaría', 'factura', 'tienda', 'ayer', 'hoy', 'mañana', 'alguien', 'nadie', 'recibir', 'solicitud', 'correo', 'respuesta', 'seguimiento', 'envío', 'reembolso', 'enviado desde', 'el', 'los', 'las', 'del', 'y', 'es', 'mi', 'por favor', 'cuando', 'porque', 'hace', 'tiene', 'esta', 'este'];

const LANG_DUTCH_WORDS = ['hallo', 'goedemorgen', 'goedemiddag', 'goedenavond', 'dank', 'bedankt', 'alstublieft', 'alsjeblieft', 'graag', 'groeten', 'groet', 'vriendelijke', 'het', 'een', 'ik', 'niet', 'mijn', 'jullie', 'uw', 'zijn', 'heb', 'heeft', 'hebben', 'kunt', 'kunnen', 'wil', 'wilt', 'zou', 'nog', 'ook', 'maar', 'omdat', 'waarom', 'wanneer', 'hoe', 'wat', 'waar', 'vandaag', 'gisteren', 'week', 'dagen', 'bestelling', 'pakket', 'levering', 'bezorging', 'retour', 'terugbetaling', 'adres', 'hulp', 'vraag', 'antwoord', 'probleem', 'helaas', 'hartelijk', 'verzonden vanaf', 'verstuurd vanaf', 'mvg', 'geen', 'gekregen', 'ontvangen', 'besteld'];

const LANG_UNSUPPORTED_ATTRIBUTE_VALUES = ['catalan', 'czech', 'danish', 'finnish', 'greek', 'hungarian', 'norwegian', 'polish', 'romanian', 'slovenian', 'swedish', 'turkish'];

let installIdMemo = null;

function extensionInstallId() {
  if (installIdMemo) return installIdMemo;

  let runtimeId = null;
  try {
    runtimeId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || null;
  } catch (error) {
    runtimeId = null;
  }

  installIdMemo = runtimeId || `isa-${Math.random().toString(36).slice(2)}`;
  return installIdMemo;
}

function ownedByAnotherInstall(element, ownerAttribute) {
  const owner = element.getAttribute(ownerAttribute);
  return Boolean(owner) && owner !== extensionInstallId();
}

function decoratedByAnotherInstall(element, ownerAttribute, present) {
  return present && ownedByAnotherInstall(element, ownerAttribute);
}

function claimDecoration(element, ownerAttribute) {
  element.setAttribute(ownerAttribute, extensionInstallId());
}
