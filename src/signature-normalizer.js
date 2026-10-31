(function (root, factory) {
  const normalizer = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = normalizer;
  }

  if (root) {
    root.ISA_SIGNATURE_NORMALIZER = normalizer;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  const roleTemplates = {
    english: (brandLink) => `Customer Support at ${brandLink}`,
    german: (brandLink) => `Kundenservice bei ${brandLink}`,
    french: (brandLink) => `Service client chez ${brandLink}`,
    italian: (brandLink) => `Assistenza clienti presso ${brandLink}`,
    portuguese: (brandLink) => `Apoio ao Cliente em ${brandLink}`,
    spanish: (brandLink) => `Atención al Cliente en ${brandLink}`,
    dutch: (brandLink) => `Klantenservice van ${brandLink}`
  };

  const roleLineMarkers = [
    'Customer Support',
    'Kundenservice',
    'Service client',
    'Assistenza clienti',
    'Apoio ao Cliente',
    'Atención al Cliente',
    'Klantenservice'
  ];

  function normalizeCompanySignature(signature, language, companyName, companySignatureLinkMap) {
    const roleTemplate = roleTemplates[language];
    const brandUrl = companySignatureLinkMap[companyName];
    if (!roleTemplate || !brandUrl || typeof signature !== 'string') {
      return signature;
    }

    const inlineBrandLink = `<a href='${brandUrl}' target='_blank'>${companyName}</a>`;
    const roleLine = roleTemplate(inlineBrandLink);
    const canonicalBrandHost = (() => {
      try {
        return new URL(brandUrl).hostname.replace(/^www\./i, '');
      } catch (_) {
        return null;
      }
    })();

    const parts = signature.split('<br>');
    const roleIndex = parts.findIndex((part) => roleLineMarkers.some((marker) => part.includes(marker)));
    if (roleIndex === -1) {
      return signature;
    }

    parts[roleIndex] = roleLine;

    const shouldRemoveBrandLink = (part) => {
      if (!part.includes('<a ') || !part.includes("href='")) return false;
      const hrefMatch = part.match(/href='([^']+)'/);
      if (!hrefMatch) return false;
      const href = hrefMatch[1];
      if (href.startsWith('mailto:')) return false;
      try {
        const url = new URL(href);
        const host = url.hostname.replace(/^www\./i, '');
        return canonicalBrandHost && host === canonicalBrandHost && url.pathname === '/';
      } catch (_) {
        return false;
      }
    };

    for (let i = parts.length - 1; i > roleIndex; i--) {
      if (shouldRemoveBrandLink(parts[i])) {
        parts.splice(i, 1);
      }
    }

    const brandLineIndex = roleIndex + 1;
    const brandLine = parts[brandLineIndex];
    if (brandLine && !brandLine.includes('<a ')) {
      const normalizePlain = (value) => value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');
      const normalizedBrand = normalizePlain(companyName);
      if (normalizePlain(brandLine) === normalizedBrand) {
        parts.splice(brandLineIndex, 1);
      }
    }

    return parts.join('<br>');
  }

  const NORMALIZED_LANGUAGES = ['english', 'german', 'french', 'italian', 'portuguese', 'spanish', 'dutch'];

  function normalizeCompanySignatures(inputCompanies, companySignatureLinkMap) {
    const output = {};

    Object.entries(inputCompanies).forEach(([companyName, config]) => {
      const normalized = { ...config };

      NORMALIZED_LANGUAGES.forEach((language) => {
        normalized[language] = normalizeCompanySignature(
          config[language], language, companyName, companySignatureLinkMap
        );
      });

      output[companyName] = normalized;
    });

    return output;
  }

  return {
    normalizeCompanySignature,
    normalizeCompanySignatures
  };
});
