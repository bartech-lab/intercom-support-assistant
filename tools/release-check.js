#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ARTIFACT_PREFIX } = require('./build-release');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PRODUCT_NAME = 'Intercom Support Assistant';
const PRODUCT_DESCRIPTION = 'Localized signatures, close safeguards, new-message alerts, and self-deleting notes for the Intercom inbox.';

function runNodeScript(fileName) {
  const result = spawnSync(process.execPath, [path.join(__dirname, fileName)], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function read(fileName) {
  return fs.readFileSync(path.join(ROOT, fileName), 'utf8');
}

function readSrc(fileName) {
  return fs.readFileSync(path.join(SRC, fileName), 'utf8');
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function main() {
  runNodeScript('validate-signatures.js');
  runNodeScript('update-preview.js');

  const manifest = JSON.parse(readSrc('manifest.json'));
  const popup = readSrc('popup.html');
  const changelog = read('CHANGELOG.md');
  const readme = read('README.md');
  const version = manifest.version;

  if (manifest.name !== PRODUCT_NAME) {
    fail(`manifest name must be "${PRODUCT_NAME}"`);
  }

  if (manifest.description !== PRODUCT_DESCRIPTION) {
    fail('manifest description does not match the current product description');
  }

  const versionPattern = '(\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?)';
  const popupVersion = popup.match(new RegExp(`v${versionPattern}`));
  const changelogVersion = changelog.match(new RegExp(`^## \\[${versionPattern}\\]`, 'm'));
  const readmeVersion = readme.match(new RegExp(`\\*\\*v${versionPattern}\\*\\*`));

  if (!popupVersion || popupVersion[1] !== version) {
    fail(`popup version does not match manifest version ${version}`);
  }

  if (!changelogVersion || changelogVersion[1] !== version) {
    fail(`top CHANGELOG version does not match manifest version ${version}`);
  }

  if (!readmeVersion || readmeVersion[1] !== version) {
    fail(`README current version does not match manifest version ${version}`);
  }

  ['signatures-data.js'].forEach((fileName) => {
    if (!fs.existsSync(path.join(SRC, fileName))) {
      fail(`missing generated file ${fileName}`);
    }
  });

  fs.readdirSync(SRC).filter(fileName => fileName.endsWith('.js')).forEach((fileName) => {
    if (/^\s*const DEBUG = true\s*;/m.test(readSrc(fileName))) {
      fail(`${fileName} still has DEBUG = true; set it back to false before releasing`);
    }
  });

  runNodeScript('build-release.js');

  console.log('');
  console.log(`Release checks passed for v${version}`);
  console.log('Next steps:');
  console.log('1. Review git diff');
  console.log('2. Commit the release changes');
  console.log('3. Push the branch');
  console.log('4. Package the public release zip:');
  console.log('   node tools/build-release.js --zip');
  console.log(`5. Create release: gh release create v${version} ${ARTIFACT_PREFIX}-v${version}.zip --title "v${version}: <summary>" --notes "<release notes>"`);
}

main();
