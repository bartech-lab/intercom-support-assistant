function pickSignature(obj, language) {
  return obj[language] || obj.english;
}

const greetingLanguageByLine = (() => {
  const map = {};
  Object.entries(greetingPools).forEach(([language, greetings]) => {
    (greetings || []).forEach((greeting) => { map[greeting] = language; });
  });
  if (!map['Liebe Grüße']) map['Liebe Grüße'] = 'german';
  if (!map['Mit freundlichen Grüßen']) map['Mit freundlichen Grüßen'] = 'german';
  return map;
})();

function splitSignature(signatureHtml, language) {
  if (typeof signatureHtml !== 'string') return null;

  const parts = signatureHtml.split('<br>');
  const separatorIndex = parts.findIndex((part) => part.trim() === '--');
  if (separatorIndex === -1) return null;

  const greetingIndex = separatorIndex + 1;
  const resolved = language || greetingLanguageByLine[(parts[greetingIndex] || '').trim()];
  if (!resolved) return null;

  return { parts, greetingIndex, language: resolved };
}

function pickFromPool(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyGreetingVariation(signatureHtml, language) {
  const split = splitSignature(signatureHtml, language);
  if (!split) return signatureHtml;

  const pool = greetingPools[split.language];
  if (!pool || !pool.length) return signatureHtml;

  split.parts[split.greetingIndex] = pickFromPool(pool);
  return split.parts.join('<br>');
}
