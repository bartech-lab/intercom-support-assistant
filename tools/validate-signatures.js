#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadIntercomConfig } = require('./update-preview');

const CONFIG_JS_PATH = path.join(__dirname, '..', 'src', 'intercom-config.js');
const REQUIRED_LANGUAGES = ['english', 'german', 'french', 'italian', 'portuguese', 'spanish', 'dutch'];
const REQUIRED_CONFIG_OBJECTS = [
  'excludedInboxes',
  'alertInboxPattern',
  'alertableInboxesSeed',
  'retiredAlertInboxIds',
  'promotionalBanners',
  'companies',
  'companySignatureLinkMap',
  'companyAliases',
  'teamSignature',
  'teamSignatureInboxes',
  'teamIdToCompany',
  'greetingPools',
  'senderFromEmailToInbox',
  'supportInboundLocalParts'
];
const REQUIRED_OBJECT_CONFIGS = [
  'promotionalBanners',
  'companies',
  'companySignatureLinkMap',
  'companyAliases',
  'teamSignature',
  'teamIdToCompany',
  'greetingPools',
  'senderFromEmailToInbox'
];

function objectSource(content, name) {
  const start = content.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`${name}: object not found in intercom-config.js`);
  let depth = 0;
  for (let i = content.indexOf('{', start); i < content.length; i += 1) {
    if (content[i] === '{') depth += 1;
    if (content[i] === '}') depth -= 1;
    if (depth === 0) return content.slice(start, i + 1);
  }
  throw new Error(`${name}: unbalanced braces in intercom-config.js`);
}

function collectTopLevelKeys(source) {
  const keys = [];
  const regex = /^  ("[^"]+"|'[^']+'|[A-Za-z0-9_]+)\s*:/gm;
  let match;

  while ((match = regex.exec(source))) {
    keys.push(match[1].replace(/^["']|["']$/g, ''));
  }

  return keys;
}

function validateDuplicates(groupName, source, errors) {
  const keys = collectTopLevelKeys(source);
  const seen = new Set();

  keys.forEach((key) => {
    if (seen.has(key)) {
      errors.push(`${groupName}: duplicate top-level key ${key}`);
    }
    seen.add(key);
  });
}

function validateConfigExport(source, errors) {
  const exportMatch = source.match(/window\.ISA_INTERCOM_CONFIG\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!exportMatch) {
    errors.push('window.ISA_INTERCOM_CONFIG: missing export');
    return;
  }

  const exportBody = exportMatch[1];
  REQUIRED_CONFIG_OBJECTS.forEach((name) => {
    if (!new RegExp(`\\b${name}\\b`).test(exportBody)) {
      errors.push(`window.ISA_INTERCOM_CONFIG: missing ${name}`);
    }
  });
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateConfigShapes(config, errors) {
  if (!Array.isArray(config.excludedInboxes)) {
    errors.push('excludedInboxes: must be an array');
  } else {
    config.excludedInboxes.forEach((inboxName, index) => {
      if (typeof inboxName !== 'string' || !inboxName.trim()) {
        errors.push(`excludedInboxes[${index}]: must be a non-empty string`);
      }
    });
  }

  REQUIRED_OBJECT_CONFIGS.forEach((name) => {
    if (!isPlainObject(config[name])) {
      errors.push(`${name}: must be a plain object`);
    }
  });

  Object.entries(config.senderFromEmailToInbox || {}).forEach(([email, inboxLabel]) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email !== email.toLowerCase()) {
      errors.push(`senderFromEmailToInbox ${email}: must be a lowercase email address`);
    }
    if (typeof inboxLabel !== 'string' || !inboxLabel.trim()) {
      errors.push(`senderFromEmailToInbox ${email}: must have a non-empty Team Inbox label`);
    }
  });
}

function validateEntries(groupName, collection, errors, warnings) {
  Object.entries(collection).forEach(([name, config]) => {
    if (!isPlainObject(config)) {
      errors.push(`${groupName} ${name}: must be an object`);
      return;
    }

    if (!config.emoji || typeof config.emoji !== 'string') {
      errors.push(`${groupName} ${name}: missing emoji`);
    }

    REQUIRED_LANGUAGES.forEach((language) => {
      if (!(language in config)) {
        errors.push(`${groupName} ${name}: missing ${language}`);
        return;
      }

      if (typeof config[language] !== 'string') {
        errors.push(`${groupName} ${name}: ${language} must be a string`);
        return;
      }

      if (config[language].trim() === '') {
        errors.push(`${groupName} ${name}: ${language} is empty`);
      }

      const hrefs = [...config[language].matchAll(/href='([^']+)'/g)].map((match) => match[1]);
      hrefs.forEach((href) => {
        if (href.startsWith('mailto:')) {
          return;
        }

        try {
          new URL(href);
        } catch (error) {
          errors.push(`${groupName} ${name}: invalid URL ${href}`);
        }
      });

      if (!config[language].includes('<br>')) {
        warnings.push(`${groupName} ${name}: ${language} has no <br> formatting`);
      }
    });
  });
}

function validateUrl(groupName, name, value, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${groupName} ${name}: missing URL`);
    return;
  }

  try {
    new URL(value);
  } catch (error) {
    errors.push(`${groupName} ${name}: invalid URL ${value}`);
  }
}

function validateHtmlLinks(groupName, name, value, errors) {
  const hrefs = [...value.matchAll(/href='([^']+)'/g)].map((match) => match[1]);
  hrefs.forEach((href) => validateUrl(groupName, `${name} href`, href, errors));
}

function parseExpiryDate(expires) {
  if (typeof expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
    return null;
  }

  const timestamp = Date.parse(`${expires}T23:59:59.999Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function validatePromotionalBanners(companies, promotionalBanners, errors, warnings) {
  const companyNames = new Set(Object.keys(companies));
  const now = Date.now();
  const archiveThresholdMs = 30 * 24 * 60 * 60 * 1000;

  Object.entries(promotionalBanners).forEach(([companyName, banner]) => {
    if (!companyNames.has(companyName)) {
      errors.push(`promotionalBanners ${companyName}: unknown company`);
    }

    if (!isPlainObject(banner)) {
      errors.push(`promotionalBanners ${companyName}: must be an object`);
      return;
    }

    const expiresAt = parseExpiryDate(banner.expires);
    if (!expiresAt) {
      errors.push(`promotionalBanners ${companyName}: expires must be YYYY-MM-DD`);
    } else if (now > expiresAt) {
      const ageMs = now - expiresAt;
      const archiveHint = ageMs > archiveThresholdMs ? '; remove it from intercom-config.js' : '';
      warnings.push(`promotionalBanners ${companyName}: expired on ${banner.expires}${archiveHint}`);
    }

    const presentLanguages = REQUIRED_LANGUAGES.filter(language => language in banner);
    if (!presentLanguages.length) {
      errors.push(`promotionalBanners ${companyName}: at least one language body is required`);
    }

    REQUIRED_LANGUAGES.forEach((language) => {
      if (!(language in banner)) {
        warnings.push(`promotionalBanners ${companyName}: missing ${language}`);
        return;
      }

      if (typeof banner[language] !== 'string' || !banner[language].trim()) {
        errors.push(`promotionalBanners ${companyName}: ${language} must be a non-empty string`);
        return;
      }

      validateHtmlLinks('promotionalBanners', `${companyName}.${language}`, banner[language], errors);
    });
  });
}

function validateCompanySignatureLinkMap(companies, companySignatureLinkMap, errors) {
  const companyNames = new Set(Object.keys(companies));

  companyNames.forEach((companyName) => {
    if (!companySignatureLinkMap[companyName]) {
      errors.push(`companySignatureLinkMap: missing ${companyName}`);
    }
  });

  Object.entries(companySignatureLinkMap).forEach(([companyName, url]) => {
    if (!companyNames.has(companyName)) {
      errors.push(`companySignatureLinkMap ${companyName}: unknown company`);
    }
    validateUrl('companySignatureLinkMap', companyName, url, errors);
  });
}

function validateCompanyAliases(companies, companyAliases, errors) {
  const companyNames = new Set(Object.keys(companies));
  const owners = new Map();

  Object.entries(companyAliases).forEach(([companyName, aliases]) => {
    if (!companyNames.has(companyName)) {
      errors.push(`companyAliases ${companyName}: unknown company`);
    }
    if (!Array.isArray(aliases) || aliases.some(alias => typeof alias !== 'string' || !alias.trim())) {
      errors.push(`companyAliases ${companyName}: must be an array of non-empty strings`);
      return;
    }
    aliases.forEach((alias) => {
      const key = alias.trim().toLowerCase();
      if (owners.has(key) && owners.get(key) !== companyName) {
        errors.push(`companyAliases ${alias}: used by both ${owners.get(key)} and ${companyName}`);
      }
      owners.set(key, companyName);
    });
  });
}

function validateTeamMappings(companies, teamIdToCompany, errors) {
  const companyNames = new Set(Object.keys(companies));

  Object.entries(teamIdToCompany).forEach(([teamId, companyName]) => {
    if (!/^\d+$/.test(teamId)) {
      errors.push(`teamIdToCompany ${teamId}: team ID must be numeric`);
    }

    if (!companyNames.has(companyName)) {
      errors.push(`teamIdToCompany ${teamId}: unknown company ${companyName}`);
    }
  });
}

function validateTeamSignatureInboxes(teamSignatureInboxes, excludedInboxes, errors) {
  if (!Array.isArray(teamSignatureInboxes)) {
    errors.push('teamSignatureInboxes: must be an array');
    return;
  }
  const excluded = new Set((excludedInboxes || []).map(name => String(name).toLowerCase()));
  teamSignatureInboxes.forEach((inboxName, index) => {
    if (typeof inboxName !== 'string' || !inboxName.trim()) {
      errors.push(`teamSignatureInboxes[${index}]: must be a non-empty string`);
    } else if (excluded.has(inboxName.toLowerCase())) {
      errors.push(`teamSignatureInboxes ${inboxName}: is also in excludedInboxes`);
    }
  });
}

function validateAlertInboxPattern(pattern, errors) {
  if (typeof pattern !== 'string' || !pattern) {
    errors.push('alertInboxPattern: must be a non-empty string');
    return;
  }
  try {
    new RegExp(pattern, 'i');
  } catch (error) {
    errors.push(`alertInboxPattern: invalid regular expression (${error.message})`);
  }
}

function validateGreetingPools(greetingPools, errors) {
  REQUIRED_LANGUAGES.forEach((language) => {
    const pool = greetingPools[language];
    if (!Array.isArray(pool) || !pool.length) {
      errors.push(`greetingPools ${language}: must be a non-empty array`);
      return;
    }

    pool.forEach((greeting, index) => {
      if (typeof greeting !== 'string' || !greeting.trim()) {
        errors.push(`greetingPools ${language}[${index}]: must be a non-empty string`);
      }
    });
  });
}

function validateConfig(content, config) {
  const errors = [];
  const warnings = [];

  validateConfigExport(content, errors);
  validateConfigShapes(config, errors);
  ['companies', 'companySignatureLinkMap', 'companyAliases', 'promotionalBanners', 'teamIdToCompany', 'senderFromEmailToInbox']
    .forEach(name => validateDuplicates(name, objectSource(content, name), errors));
  validateEntries('Company', config.companies, errors, warnings);
  validateEntries('Team signature', { TEAM: config.teamSignature }, errors, warnings);
  validateCompanySignatureLinkMap(config.companies, config.companySignatureLinkMap, errors);
  validateCompanyAliases(config.companies, config.companyAliases, errors);
  validatePromotionalBanners(config.companies, config.promotionalBanners, errors, warnings);
  validateTeamMappings(config.companies, config.teamIdToCompany, errors);
  validateTeamSignatureInboxes(config.teamSignatureInboxes, config.excludedInboxes, errors);
  validateAlertInboxPattern(config.alertInboxPattern, errors);
  validateGreetingPools(config.greetingPools, errors);

  if (!Object.keys(config.companies || {}).length) {
    errors.push('companies: no entries found');
  }

  return { errors, warnings };
}

function main() {
  try {
    const content = fs.readFileSync(CONFIG_JS_PATH, 'utf8');
    const { errors, warnings } = validateConfig(content, loadIntercomConfig(CONFIG_JS_PATH));

    if (warnings.length) {
      console.log('Warnings:');
      warnings.forEach((warning) => console.log(`- ${warning}`));
      console.log('');
    }

    if (errors.length) {
      console.error('Validation failed:');
      errors.forEach((error) => console.error(`- ${error}`));
      process.exit(1);
    }

    console.log('Signature configuration is valid');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateConfig, objectSource };
