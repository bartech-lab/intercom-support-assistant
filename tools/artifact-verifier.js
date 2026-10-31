const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const REQUIRED_FILES = [
  'manifest.json',
  'shared-runtime.js',
  'intercom-config.js',
  'signature-normalizer.js',
  'alert-sounds.js',
  'alert-settings-ui.js',
  'support-tools-ui.js',
  'dom-capture.js',
  'intercom-util.js',
  'intercom-language.js',
  'intercom-signatures.js',
  'intercom-dom.js',
  'intercom-sidebar.js',
  'intercom-list-state.js',
  'intercom-duplicates.js',
  'intercom-row-decorations.js',
  'intercom-context.js',
  'intercom-bridge.js',
  'intercom-composer.js',
  'intercom-attachments.js',
  'intercom-guards.js',
  'intercom-autoselect.js',
  'intercom-alerts-ui.js',
  'intercom-temporary-notes.js',
  'intercom-note-cleanup.js',
  'intercom-temporary-notes-ui.js',
  'intercom-note-runtime.js',
  'intercom-boot.js',
  'signatures-data.js',
  'background.js',
  'theme.js',
  'workspace-theme.css',
  'popup.html',
  'popup.js',
  'preview-page.html',
  'preview-page.js',
  'intercom-page-hook.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

const SCRIPT_FILES = [
  'shared-runtime.js',
  'intercom-config.js',
  'signature-normalizer.js',
  'alert-sounds.js',
  'alert-settings-ui.js',
  'support-tools-ui.js',
  'dom-capture.js',
  'intercom-util.js',
  'intercom-language.js',
  'intercom-signatures.js',
  'intercom-dom.js',
  'intercom-sidebar.js',
  'intercom-list-state.js',
  'intercom-duplicates.js',
  'intercom-row-decorations.js',
  'intercom-context.js',
  'intercom-bridge.js',
  'intercom-composer.js',
  'intercom-attachments.js',
  'intercom-guards.js',
  'intercom-autoselect.js',
  'intercom-alerts-ui.js',
  'intercom-temporary-notes.js',
  'intercom-note-cleanup.js',
  'intercom-temporary-notes-ui.js',
  'intercom-note-runtime.js',
  'intercom-boot.js',
  'signatures-data.js',
  'background.js',
  'theme.js',
  'popup.js',
  'preview-page.js',
  'intercom-page-hook.js'
];

const CONFIG_OBJECTS = [
  'excludedInboxes',
  'alertInboxPattern',
  'promotionalBanners',
  'companies',
  'companySignatureLinkMap',
  'companyAliases',
  'teamSignature',
  'teamSignatureInboxes',
  'teamIdToCompany',
  'senderFromEmailToInbox'
];

const EXPECTED_RUNTIME_FILES = new Set([
  ...REQUIRED_FILES,
  'icons/isa-logo.svg'
]);

const DEV_FILE_NAMES = new Set([
  '.git',
  '.codex',
  '.claude',
  'node_modules',
  'package.json',
  'package-lock.json',
  'opencode.jsonc',
  'src',
  'tools',
  'test',
  'docs',
  'dist',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'CHANGELOG.md',
  'RELEASE.md'
]);

function createResults() {
  return {
    requiredFiles: [],
    manifestReferences: [],
    jsSyntax: [],
    configReferences: [],
    devFileScan: []
  };
}

function addError(results, group, message) {
  results[group].push(message);
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isSensitivePath(filePath) {
  const base = path.basename(filePath);
  return base === '.env' || base.startsWith('.env.') || filePath.endsWith('.zip');
}

function walkFiles(rootDir, visitor, relativeDir = '') {
  const currentDir = path.join(rootDir, relativeDir);
  for (const entry of fs.readdirSync(currentDir)) {
    const relativePath = path.join(relativeDir, entry);
    const fullPath = path.join(rootDir, relativePath);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      visitor(fullPath, toPosixPath(relativePath), true);
      walkFiles(rootDir, visitor, relativePath);
    } else {
      visitor(fullPath, toPosixPath(relativePath), false);
    }
  }
}

function readManifest(artifactDir) {
  const manifestPath = path.join(artifactDir, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function loadIntercomConfig(configContent, fileName = 'intercom-config.js') {
  const context = {
    window: {},
    URL
  };
  vm.createContext(context);
  vm.runInContext(configContent, context, { filename: fileName });
  if (!context.window.ISA_INTERCOM_CONFIG || typeof context.window.ISA_INTERCOM_CONFIG !== 'object') {
    throw new Error('window.ISA_INTERCOM_CONFIG was not assigned');
  }
  return context.window.ISA_INTERCOM_CONFIG;
}

function validateConfigReferences(configContent) {
  const errors = [];
  let config;

  try {
    config = loadIntercomConfig(configContent);
  } catch (error) {
    return [`intercom-config.js: ${error.message}`];
  }

  CONFIG_OBJECTS.forEach((objectName) => {
    if (!(objectName in config)) {
      errors.push(`intercom-config.js: missing ${objectName}`);
    }
  });

  if (!config.companies || typeof config.companies !== 'object') {
    return errors;
  }

  const companyNames = new Set(Object.keys(config.companies));
  const keyedByCompany = [
    'companySignatureLinkMap',
    'companyAliases',
    'promotionalBanners'
  ];

  keyedByCompany.forEach((groupName) => {
    Object.keys(config[groupName] || {}).forEach((companyName) => {
      if (!companyNames.has(companyName)) {
        errors.push(`${groupName}: ${companyName} is not present in companies`);
      }
    });
  });

  Object.entries(config.teamIdToCompany || {}).forEach(([teamId, companyName]) => {
    if (!companyNames.has(companyName)) {
      errors.push(`teamIdToCompany ${teamId}: invalid company ${companyName}`);
    }
  });

  return errors;
}

function isSafeArtifactPath(filePath) {
  return typeof filePath === 'string' &&
    filePath.length > 0 &&
    !path.isAbsolute(filePath) &&
    !filePath.split(/[\\/]+/).includes('..');
}

function assertReferencedFile(results, artifactDir, filePath) {
  if (!isSafeArtifactPath(filePath)) {
    addError(results, 'manifestReferences', `manifest references unsafe path ${filePath}`);
    return;
  }

  const fullPath = path.join(artifactDir, filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    addError(results, 'manifestReferences', `manifest references missing file ${filePath}`);
  }
}

function validateManifest(results, artifactDir) {
  let manifest;
  try {
    manifest = readManifest(artifactDir);
  } catch (error) {
    addError(results, 'manifestReferences', `manifest.json: ${error.message}`);
    return null;
  }

  if (manifest.manifest_version !== 3) {
    addError(results, 'manifestReferences', 'manifest_version must be 3');
  }
  if (!manifest.version) {
    addError(results, 'manifestReferences', 'manifest version is missing');
  }

  function assertMainWorldHookBlock(results, manifest, { file, match, label }) {
    const blocks = (manifest.content_scripts || [])
      .filter(contentScript => (contentScript.js || []).includes(file));
    if (blocks.length !== 1) {
      addError(results, 'manifestReferences', `${label} page hook must appear in exactly one content_scripts block`);
      return;
    }
    const block = blocks[0];
    if (block.js.length !== 1) {
      addError(results, 'manifestReferences', `${label} page hook block must contain only ${file}`);
    }
    if (block.run_at !== 'document_start') {
      addError(results, 'manifestReferences', `${label} page hook must run at document_start`);
    }
    if (block.world !== 'MAIN') {
      addError(results, 'manifestReferences', `${label} page hook must run in world MAIN`);
    }
    const matches = Array.isArray(block.matches) ? block.matches : [];
    if (matches.length !== 1 || matches[0] !== match) {
      addError(results, 'manifestReferences', `${label} page hook must match exactly ${match}`);
    }
  }

  const INTERCOM_RUNTIME_ORDER = [
    'shared-runtime.js',
    'intercom-config.js',
    'signature-normalizer.js',
    'alert-sounds.js',
    'dom-capture.js',
    'intercom-util.js',
    'intercom-language.js',
    'intercom-signatures.js',
    'intercom-dom.js',
    'intercom-sidebar.js',
    'intercom-list-state.js',
    'intercom-duplicates.js',
    'intercom-row-decorations.js',
    'intercom-context.js',
    'intercom-bridge.js',
    'intercom-composer.js',
    'intercom-attachments.js',
    'intercom-guards.js',
    'intercom-autoselect.js',
    'intercom-alerts-ui.js',
    'intercom-temporary-notes.js',
    'intercom-note-cleanup.js',
    'intercom-temporary-notes-ui.js',
    'intercom-note-runtime.js',
    'intercom-boot.js'
  ];
  const runtimeContentScript = (manifest.content_scripts || [])
    .find(contentScript => (contentScript.js || []).includes('intercom-boot.js'));
  const scripts = runtimeContentScript && runtimeContentScript.js;
  if (
    !Array.isArray(scripts) ||
    scripts.length !== INTERCOM_RUNTIME_ORDER.length ||
    INTERCOM_RUNTIME_ORDER.some((name, index) => scripts[index] !== name)
  ) {
    addError(results, 'manifestReferences', `Intercom runtime content script must list exactly ${INTERCOM_RUNTIME_ORDER.join(', ')}`);
  }

  assertMainWorldHookBlock(results, manifest, {
    file: 'intercom-page-hook.js',
    match: 'https://app.intercom.com/*',
    label: 'Intercom'
  });
  (manifest.content_scripts || []).forEach((contentScript, index) => {
    (contentScript.js || []).forEach((scriptPath) => {
      assertReferencedFile(results, artifactDir, scriptPath, `content_scripts[${index}]`);
    });
  });

  if (manifest.background && manifest.background.service_worker) {
    assertReferencedFile(results, artifactDir, manifest.background.service_worker);
  }

  if (manifest.action && manifest.action.default_popup) {
    assertReferencedFile(results, artifactDir, manifest.action.default_popup);
  }

  [manifest.icons, manifest.action && manifest.action.default_icon].forEach((icons) => {
    Object.values(icons || {}).forEach((iconPath) => {
      assertReferencedFile(results, artifactDir, iconPath);
    });
  });

  const allowedHosts = new Set(['https://app.intercom.com/*']);
  for (const scope of manifest.host_permissions || []) {
    if (!allowedHosts.has(scope)) {
      addError(results, 'manifestReferences', `unexpected host scope ${scope}`);
    }
  }

  return manifest;
}

function verifyExtractedArtifact(artifactDir, options = {}) {
  const rootDir = path.resolve(artifactDir);
  const extraRuntimeFiles = new Set(options.extraRuntimeFiles || []);
  const extraScriptFiles = new Set(options.extraScriptFiles || []);
  const results = createResults();

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    addError(results, 'requiredFiles', `${artifactDir} is not a directory`);
    return results;
  }

  REQUIRED_FILES.forEach((fileName) => {
    const fullPath = path.join(rootDir, fileName);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      addError(results, 'requiredFiles', `missing ${fileName}`);
    }
  });

  validateManifest(results, rootDir);

  [...new Set([...SCRIPT_FILES, ...extraScriptFiles])].forEach((fileName) => {
    const fullPath = path.join(rootDir, fileName);
    if (!fs.existsSync(fullPath)) return;
    try {
      execFileSync(process.execPath, ['-c', fullPath], { stdio: 'pipe' });
    } catch (error) {
      addError(results, 'jsSyntax', `${fileName}: ${String(error.stderr || error.message).trim()}`);
    }
  });

  const configPath = path.join(rootDir, 'intercom-config.js');
  if (fs.existsSync(configPath)) {
    validateConfigReferences(fs.readFileSync(configPath, 'utf8')).forEach((error) => {
      addError(results, 'configReferences', error);
    });
  }

  walkFiles(rootDir, (_fullPath, relativePath, isDirectory) => {
    const firstPart = relativePath.split('/')[0];
    const baseName = path.basename(relativePath);
    if (DEV_FILE_NAMES.has(firstPart) || DEV_FILE_NAMES.has(baseName) || isSensitivePath(relativePath)) {
      addError(results, 'devFileScan', `forbidden file ${relativePath}`);
      return;
    }
    if (!isDirectory && !EXPECTED_RUNTIME_FILES.has(relativePath) &&
      !extraRuntimeFiles.has(relativePath)) {
      addError(results, 'devFileScan', `unexpected runtime file ${relativePath}`);
    }
  });

  return results;
}

function flattenErrors(results) {
  return Object.values(results).flat();
}

function hasErrors(results) {
  return flattenErrors(results).length > 0;
}

function formatVerificationResults(results) {
  const labels = {
    requiredFiles: 'required files',
    manifestReferences: 'manifest references',
    jsSyntax: 'JS syntax',
    configReferences: 'config references',
    devFileScan: 'dev-file scan'
  };

  return Object.keys(labels).map((group) => {
    const errors = results[group];
    if (!errors.length) {
      return `PASS ${labels[group]}`;
    }
    return [`FAIL ${labels[group]}`, ...errors.map((error) => `  - ${error}`)].join('\n');
  }).join('\n');
}

module.exports = {
  verifyExtractedArtifact,
  flattenErrors,
  hasErrors,
  formatVerificationResults
};
