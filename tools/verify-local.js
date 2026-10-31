#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`Failed to start ${command}: ${result.error.message}`);
    return 1;
  }

  return result.status === 0 ? 0 : (result.status || 1);
}

function runStage(number, label, command, args) {
  console.log(`\n=== [${number}/6] ${label} ===`);
  const status = runCommand(command, args);
  if (status !== 0) {
    console.error(`FAILED: ${label}`);
  }
  return status;
}

function jsFilesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => path.join(directory, fileName));
}

function testJsFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return testJsFiles(fullPath);
    return entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function syntaxFiles() {
  return [
    ...jsFilesIn(path.join(ROOT, 'tools')),
    ...jsFilesIn(path.join(ROOT, 'src')),
    ...testJsFiles(path.join(ROOT, 'test'))
  ].sort();
}

function runSyntaxChecks() {
  console.log('\n=== [2/6] JavaScript syntax checks ===');
  for (const fileName of syntaxFiles()) {
    const status = runCommand(process.execPath, ['--check', fileName]);
    if (status !== 0) {
      console.error(`FAILED: node --check ${path.relative(ROOT, fileName)}`);
      return status;
    }
  }
  return 0;
}

function confirmZipFiles() {
  console.log('\n=== [6/6] Confirm versioned ZIP file ===');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
  } catch (error) {
    console.error(`FAILED: could not read manifest.json: ${error.message}`);
    return 1;
  }

  const fileName = `Intercom-Support-Assistant-v${manifest.version}.zip`;
  const filePath = path.join(ROOT, fileName);
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    console.error(`FAILED: missing ${fileName}`);
    return 1;
  }
  if (!stats.isFile() || stats.size === 0) {
    console.error(`FAILED: ${fileName} is empty or not a regular file`);
    return 1;
  }
  console.log(`Verified ${fileName} (${stats.size} bytes)`);

  return 0;
}

function main() {
  let status = runStage(1, 'npm test', npmCommand, ['test']);
  if (status !== 0) return status;

  status = runSyntaxChecks();
  if (status !== 0) return status;

  status = runStage(3, 'git diff --check', 'git', ['diff', '--check']);
  if (status !== 0) return status;

  status = runStage(4, 'node tools/release-check.js', process.execPath, ['tools/release-check.js']);
  if (status !== 0) return status;

  status = runStage(5, 'node tools/build-release.js --zip', process.execPath, ['tools/build-release.js', '--zip']);
  if (status !== 0) return status;

  return confirmZipFiles();
}

process.exitCode = main();
