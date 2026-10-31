function langWordRegex(word) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'u');
}

const LANG_ENGLISH_REGEXES = LANG_ENGLISH_WORDS.map(langWordRegex);
const LANG_FRENCH_REGEXES = LANG_FRENCH_WORDS.map(langWordRegex);
const LANG_GERMAN_REGEXES = LANG_GERMAN_WORDS.map(langWordRegex);
const LANG_ITALIAN_REGEXES = LANG_ITALIAN_WORDS.map(langWordRegex);
const LANG_PORTUGUESE_REGEXES = LANG_PORTUGUESE_WORDS.map(langWordRegex);
const LANG_SPANISH_REGEXES = LANG_SPANISH_WORDS.map(langWordRegex);
const LANG_DUTCH_REGEXES = LANG_DUTCH_WORDS.map(langWordRegex);

const companyKeys = Object.keys(companies);
const normalizeKey = s => s.toLowerCase().replace(/\s+/g, '');

function normalizeInboxText(str) {
  if (!str) return str;

  return str
    .replace(/[\u0410-\u044F]/g, ch => LOOKALIKE_LETTER_MAP[ch] || ch)
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getConversationId() {
  const match = window.location.pathname.match(/\/conversations?\/(\d+)/);
  return match ? match[1] : null;
}

function getTeamIdFromHref(href) {
  if (!href) return null;

  const match = href.match(/\/inbox\/team\/(\d+)(?:[/?]|$)/);
  return match ? match[1] : null;
}

function getActiveTeamId() {
  return getTeamIdFromHref(window.location.href);
}

function getActiveInboxId() {
  if (ALERT_ACTIVE_ADMIN_INBOX.test(window.location.href)) return ALERT_YOUR_INBOX_ID;
  return getActiveTeamId();
}

function extractCountryFromLocation(location) {
  const parts = location.split(',');
  return parts[parts.length - 1].trim();
}
function scoreLanguages(rawText) {
  const text = (rawText || '').toLowerCase();
  const count = (regexes) => regexes.filter(re => re.test(text)).length;
  const matches = (regexes, words) => words.filter((word, i) => regexes[i].test(text));
  const diacritics = (pattern) => (text.match(pattern) || []).length * 0.5;

  const languages = [
    { language: 'german', matched: matches(LANG_GERMAN_REGEXES, LANG_GERMAN_WORDS), words: count(LANG_GERMAN_REGEXES), chars: diacritics(/[\u00e4\u00f6\u00fc\u00df]/g) },
    { language: 'french', matched: matches(LANG_FRENCH_REGEXES, LANG_FRENCH_WORDS), words: count(LANG_FRENCH_REGEXES), chars: diacritics(/[\u00eb\u00ef\u00fb]/g) },
    { language: 'italian', matched: matches(LANG_ITALIAN_REGEXES, LANG_ITALIAN_WORDS), words: count(LANG_ITALIAN_REGEXES), chars: diacritics(/[\u00ec\u00f2]/g) },
    { language: 'portuguese', matched: matches(LANG_PORTUGUESE_REGEXES, LANG_PORTUGUESE_WORDS), words: count(LANG_PORTUGUESE_REGEXES), chars: diacritics(/[\u00e3\u00f5]/g) },
    { language: 'spanish', matched: matches(LANG_SPANISH_REGEXES, LANG_SPANISH_WORDS), words: count(LANG_SPANISH_REGEXES), chars: diacritics(/[\u00f1\u00bf\u00a1]/g) },
    { language: 'dutch', matched: matches(LANG_DUTCH_REGEXES, LANG_DUTCH_WORDS), words: count(LANG_DUTCH_REGEXES), chars: 0 }
  ].map(entry => ({ ...entry, score: entry.words + entry.chars }));

  return {
    englishWordCount: count(LANG_ENGLISH_REGEXES),
    languages,
    totalForeignScore: languages.reduce((sum, entry) => sum + entry.score, 0)
  };
}

function detectLanguageFromAgentEmails() {
  const parts = queryAllIntercom(SELECTORS.agentReplyPart);
  if (!parts.length) return null;

  const text = parts
    .map(part => part.querySelector(SELECTORS.partContentHtml) || part)
    .map(element => (element.textContent || '').toLowerCase())
    .join(' ');

  const best = bestLanguageCandidate(scoreLanguages(text).languages);
  return best ? best.language : null;
}

function bestLanguageCandidate(languages) {
  const qualifying = languages.filter(candidate => candidate.score >= 3 && candidate.words >= 2);
  if (!qualifying.length) return null;
  return qualifying.slice().sort((a, b) => b.score - a.score)[0];
}

function conversationClientBlocks() {
  let clientMessages = [...queryAllIntercom(SELECTORS.customerMessageBlocks)]
    .map(block => block.querySelector(SELECTORS.partContentHtml) || block);
  if (!clientMessages.length) {
    clientMessages = document.querySelectorAll(SELECTORS.clientMessages);
  }

  debugLog('[Language Detection] Client messages found:', clientMessages.length);

  return Array.from(clientMessages).map(el => (el.textContent || '').toLowerCase());
}

function detectLanguageFromConversation() {
  const blocks = conversationClientBlocks();

  if (!blocks.length) {
    debugLog('[Language Detection] No client messages found');
    return null;
  }

  const text = blocks.join(' ');

  debugLog('[Language Detection] Analyzing conversation text (first 200 chars):', text.substring(0, 200));

  const { englishWordCount, languages, totalForeignScore } = scoreLanguages(text);

  debugLog('[Language Detection] English word count:', englishWordCount);
  languages.forEach((candidate) => {
    debugLog('[Language Detection] Score -', candidate.language, candidate.score, '(words:', candidate.words, ')');
  });

  const hasForeignBlock = blocks.some((block) => {
    const blockScores = scoreLanguages(block);
    const best = bestLanguageCandidate(blockScores.languages);
    return best && best.score >= blockScores.englishWordCount;
  });

  if (englishWordCount >= 3 && !hasForeignBlock && totalForeignScore < englishWordCount * 1.5) {
    debugLog('[Language Detection] Predominantly English (English words:', englishWordCount, ', foreign score:', totalForeignScore, ')');
    return null;
  }

  const best = bestLanguageCandidate(languages);
  if (best) {
    debugLog('[Language Detection] Detected', best.language, 'from conversation (score:', best.score, ')');
    return best.language;
  }

  debugLog('[Language Detection] No language detected from conversation content');
  return null;
}

const LANG_LOCALE_CODES = {
  en: 'english',
  de: 'german',
  fr: 'french',
  it: 'italian',
  pt: 'portuguese',
  es: 'spanish',
  nl: 'dutch'
};

function localeBaseCode(value) {
  const match = /^([a-z]{2})(?:[-_][a-z0-9]+)*$/.exec(value);
  return match ? match[1] : null;
}

function signatureLanguageFromAttribute(rawValue) {
  const value = (rawValue || '').trim().toLowerCase();
  if (!value) return null;

  const localeBase = localeBaseCode(value);
  if (localeBase && LANG_LOCALE_CODES[localeBase]) return LANG_LOCALE_CODES[localeBase];

  if (value.includes('german') || value.includes('deutsch')) return 'german';
  if (value.includes('french') || value.includes('fran')) return 'french';
  if (value.includes('italian') || value.includes('italiano')) return 'italian';
  if (value.includes('portuguese')) return 'portuguese';
  if (value.includes('spanish') || value.includes('espa')) return 'spanish';
  if (value.includes('dutch') || value.includes('nederlands')) return 'dutch';
  if (value.includes('english')) return 'english';

  return LANG_UNSUPPORTED_ATTRIBUTE_VALUES.some(name => value.includes(name)) ? 'english' : null;
}
const STREAM_LANGUAGE_CHANGE_PATTERN = /Attribute: 'Language' set to\s+(\p{L}+(?:[ -]\p{L}+){0,2})/giu;
const STREAM_LANGUAGE_LABEL_PATTERN = /Language:\s+(\p{L}+(?:[ -]\p{L}+){0,2})/iu;

function streamLanguageChanges(stream) {
  const changes = [];
  const walker = document.createTreeWalker(stream, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.includes("'Language' set to")) continue;
    for (let scope = node.parentElement; scope && stream.contains(scope); scope = scope.parentElement) {
      const match = [...scope.textContent.matchAll(STREAM_LANGUAGE_CHANGE_PATTERN)];
      if (match.length) {
        changes.push(match[match.length - 1][1]);
        break;
      }
    }
  }
  return changes;
}

function streamLanguageFromWords(phrase) {
  const words = phrase.split(/[ -]/);
  for (let count = 1; count <= words.length; count += 1) {
    const language = signatureLanguageFromAttribute(words.slice(0, count).join(' '));
    if (language) return language;
  }
  return null;
}

function detectLanguageFromConversationStream() {
  const conversationStream = getConversationStream();
  if (!conversationStream) {
    debugLog('[Language Detection] Conversation stream not found');
    return null;
  }

  const text = conversationStream.textContent || '';

  if (!text.includes("Attribute: 'Language' set to") && !text.includes("Language:")) {
    debugLog('[Language Detection] No language found in conversation stream');
    return null;
  }

  if (text.includes('could not detect with enough confidence')) {
    debugLog('[Language Detection] Intercom has LOW CONFIDENCE - deferring to conversation content analysis');
    return null;
  }

  const scopedChanges = streamLanguageChanges(conversationStream);
  const textChanges = [...text.matchAll(STREAM_LANGUAGE_CHANGE_PATTERN)].map(match => match[1]);
  const changes = scopedChanges.length ? scopedChanges : textChanges;
  const labelMatch = changes.length ? null : text.match(STREAM_LANGUAGE_LABEL_PATTERN);
  const langValue = changes.length ? changes[changes.length - 1] : labelMatch && labelMatch[1];

  if (langValue) {
    const lang = langValue.toLowerCase();
    debugLog('[Language Detection] Found language in conversation stream:', lang);
    const detectedLang = streamLanguageFromWords(lang);

    if (detectedLang) {
      debugLog('[Language Detection] Returning from conversation stream:', detectedLang);
      return detectedLang;
    }
  }

  debugLog('[Language Detection] No language found in conversation stream');
  return null;
}

function detectCustomerLanguage() {
  debugLog('[Language Detection] Starting language detection...');
  lastDetectionHadNoEvidence = false;

  let conversationLanguage;
  let conversationScores;
  let locationHint;

  function getConversationLanguage() {
    if (conversationLanguage === undefined) {
      conversationLanguage = detectLanguageFromConversation();
    }
    return conversationLanguage;
  }

  function conversationSupportsLanguage(candidateLanguage) {
    if (conversationScores === undefined) {
      const blocks = conversationClientBlocks();
      conversationScores = blocks.length ? scoreLanguages(blocks.join(' ')).languages : null;
    }
    if (!conversationScores) return false;
    const candidate = conversationScores.find(entry => entry.language === candidateLanguage);
    if (!candidate) return false;
    if (candidate.chars > 0) return true;
    return candidate.matched.some(word => word.replace(/[^\p{L}]/gu, '').length >= 3);
  }

  function getLocationHint() {
    if (locationHint !== undefined) {
      return locationHint;
    }

    let isMultilingual = false;
    let language = null;

    const locationText = getAttributeValueByLabel(FIELD_LABELS.location, [
      SELECTORS.locationValue
    ]);

    if (locationText) {
      debugLog('[Language Detection] Found location:', locationText);
      const country = extractCountryFromLocation(locationText).toLowerCase();
      debugLog('[Language Detection] Extracted country:', country);

      if (country.includes('belgium')) {
        debugLog('[Language Detection] Belgium detected - will use as weak hint only');
        isMultilingual = true;
      } else if (country.includes('italy')) {
        language = 'italian';
      } else if (country.includes('france')) {
        language = 'french';
      } else if (country.includes('spain')) {
        language = 'spanish';
      } else if (country.includes('netherlands')) {
        language = 'dutch';
      } else if (country.includes('portugal')) {
        language = 'portuguese';
      } else if (
        country.includes('germany') ||
        country.includes('austria') ||
        country.includes('switzerland')
      ) {
        language = 'german';
      }
    }

    locationHint = { language, isMultilingual };
    return locationHint;
  }

  function resolveAttributeLanguage(candidateLanguage, source) {
    if (candidateLanguage === 'english') {
      return candidateLanguage;
    }

    const hint = getLocationHint();
    if (hint.language === candidateLanguage) {
      return candidateLanguage;
    }

    const convLang = getConversationLanguage();
    if (convLang === candidateLanguage) {
      return candidateLanguage;
    }

    if (convLang !== null) {
      debugLog(`[Language Detection] ${source} ${candidateLanguage} contradicted by conversation content - falling back to English`);
      return 'english';
    }

    if (hint.language && !conversationSupportsLanguage(candidateLanguage)) {
      debugLog(`[Language Detection] ${source} ${candidateLanguage} has no support in the conversation - using the location hint ${hint.language}`);
      return hint.language;
    }

    return candidateLanguage;
  }

  const liveConversationId = getConversationId();
  const networkLang = liveConversationId ? resolveNetworkLanguage(liveConversationId) : null;
  if (networkLang) {
    const resolved = resolveAttributeLanguage(networkLang, 'Network');
    debugLog('[Language Detection] Using language observed on the network:', resolved);
    return resolved;
  }

  const streamLang = detectLanguageFromConversationStream();
  if (streamLang) {
    const resolved = resolveAttributeLanguage(streamLang, 'Stream');
    debugLog('[Language Detection] Using language from conversation stream:', resolved);
    return resolved;
  }

  const languageValue = getAttributeValueByLabel(FIELD_LABELS.language, [
    SELECTORS.attributeValue
  ]);

  if (languageValue) {
    const lang = languageValue.trim().toLowerCase();
    debugLog('[Language Detection] Found language in sidebar:', lang);
    const sidebarLang = signatureLanguageFromAttribute(lang);

    if (sidebarLang) {
      const resolved = resolveAttributeLanguage(sidebarLang, 'Sidebar');
      return resolved;
    }
  }

  const convLang = getConversationLanguage();
  if (convLang) {
    debugLog('[Language Detection] Using language from conversation content:', convLang);
    return convLang;
  }

  const agentLang = detectLanguageFromAgentEmails();
  if (agentLang) {
    debugLog('[Language Detection] Using language the agents already wrote in:', agentLang);
    return agentLang;
  }

  const hint = getLocationHint();
  if (hint.language) {
    debugLog(`[Language Detection] ${hint.language} detected from location`);
    return hint.language;
  }

  if (hint.isMultilingual) {
    debugLog('[Language Detection] Belgium user with inconclusive language - defaulting to English');
    return 'english';
  }

  debugLog('[Language Detection] No language detected - falling back to English');
  lastDetectionHadNoEvidence = true;
  return 'english';
}
