#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

  if (manifest.name !== PRODUCT_NAME) {
    fail(`manifest name must be "${PRODUCT_NAME}"`);
  }

  if (manifest.description !== PRODUCT_DESCRIPTION) {
    fail('manifest description does not match the current product description');
  }

  ['signatures-data.js'].forEach((fileName) => {
    if (!fs.existsSync(path.join(SRC, fileName))) {
      fail(`missing generated file ${fileName}`);
    }
  });

  fs.readdirSync(SRC).filter(fileName => fileName.endsWith('.js')).forEach((fileName) => {
    if (/^\s*const DEBUG = true\s*;/m.test(readSrc(fileName))) {
      fail(`${fileName} still has DEBUG = true; set it back to false`);
    }
  });

  runNodeScript('build-release.js');

  console.log('');
  console.log('Release checks passed');
}

main();
