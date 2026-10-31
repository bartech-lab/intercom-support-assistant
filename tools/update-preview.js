#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normalizeCompanySignatures } = require('../src/signature-normalizer');

const SRC = path.join(__dirname, '..', 'src');
const CONFIG_JS_PATH = path.join(SRC, 'intercom-config.js');
const DATA_JS_PATH = path.join(SRC, 'signatures-data.js');

function loadIntercomConfig(file = CONFIG_JS_PATH) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const config = sandbox.window.ISA_INTERCOM_CONFIG;
  if (!config || typeof config !== 'object') throw new Error(`${file} does not define window.ISA_INTERCOM_CONFIG`);
  return JSON.parse(JSON.stringify(config));
}

function buildSignatureData(cfg) {
  const normalizedCompanies = normalizeCompanySignatures(cfg.companies, cfg.companySignatureLinkMap);
  const alertPattern = new RegExp(cfg.alertInboxPattern || '^urgent\\b', 'i');
  const alertRoster = Array.isArray(cfg.alertableInboxesSeed)
    ? cfg.alertableInboxesSeed
        .filter((inbox) => inbox && inbox.teamId)
        .map((inbox) => ({ teamId: String(inbox.teamId), label: String(inbox.label || inbox.teamId) }))
    : [];
  const retiredAlertInboxIds = Array.isArray(cfg.retiredAlertInboxIds)
    ? cfg.retiredAlertInboxIds.map(String)
    : [];
  const companyNames = new Set(Object.keys(cfg.companies || {}));
  const alertGroups = alertRoster.length
    ? cfg.alertableInboxesSeed
        .filter((inbox) => inbox && inbox.teamId && inbox.featured)
        .map((inbox) => {
          const detail = (inbox.companies || []).filter((company) => companyNames.has(company));
          return {
            label: String(inbox.label || inbox.teamId).replace(alertPattern, '').trim(),
            ids: [String(inbox.teamId)],
            detail: detail.length > 1 ? detail : []
          };
        })
    : [];
  return {
    companies: normalizedCompanies,
    teamSignature: cfg.teamSignature,
    teamSignatureInboxes: Array.isArray(cfg.teamSignatureInboxes) ? cfg.teamSignatureInboxes.map(String) : [],
    promotionalBanners: cfg.promotionalBanners,
    alertInboxPattern: String(cfg.alertInboxPattern || ''),
    alertRoster,
    retiredAlertInboxIds,
    alertGroups
  };
}

function serializeSignatureData(data) {
  return `window.SIGNATURE_DATA = ${JSON.stringify(data, null, 2)};\n`;
}

function generatePreview() {
  try {
    fs.writeFileSync(DATA_JS_PATH, serializeSignatureData(buildSignatureData(loadIntercomConfig())));
    console.log('Generated src/signatures-data.js');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  generatePreview();
}

module.exports = {
  buildSignatureData,
  loadIntercomConfig,
  serializeSignatureData
};
