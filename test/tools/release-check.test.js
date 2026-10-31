'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-check-'));
  tempDirs.push(dir);
  for (const entry of ['src', 'tools', 'docs']) {
    fs.cpSync(path.join(REPO, entry), path.join(dir, entry), { recursive: true });
  }
  for (const file of ['README.md', 'CHANGELOG.md', 'package.json']) {
    fs.copyFileSync(path.join(REPO, file), path.join(dir, file));
  }
  return dir;
}

function runReleaseCheck(root) {
  return spawnSync(process.execPath, [path.join('tools', 'release-check.js')], {
    cwd: root,
    encoding: 'utf8'
  });
}

function readManifestVersion(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src', 'manifest.json'), 'utf8')).version;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceInFile(filePath, search, replacement) {
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes(search), `fixture is missing ${JSON.stringify(search)} in ${filePath}`);
  fs.writeFileSync(filePath, content.split(search).join(replacement));
}

test('a clean checkout copy passes release-check', () => {
  const root = copyFixture();
  const result = runReleaseCheck(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Release checks passed for v/);
});

test('a manifest version disagreeing with the popup fails naming the popup', () => {
  const root = copyFixture();
  const version = readManifestVersion(root);
  replaceInFile(path.join(root, 'src', 'manifest.json'), `"version": "${version}"`, '"version": "9.9.9.9"');
  const result = runReleaseCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /popup version does not match manifest version 9\.9\.9\.9/);
});

test('a popup that no longer shows the current version fails naming the popup', () => {
  const root = copyFixture();
  const version = readManifestVersion(root);
  replaceInFile(path.join(root, 'src', 'popup.html'), `v${version}`, 'vSTALE');
  const result = runReleaseCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    new RegExp(`popup version does not match manifest version ${escapeRegExp(version)}`)
  );
});

test('a README showing an older bold version fails naming the README', () => {
  const root = copyFixture();
  const version = readManifestVersion(root);
  replaceInFile(path.join(root, 'README.md'), `**v${version}**`, '**v9.9.9.9**');
  const result = runReleaseCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    new RegExp(`README current version does not match manifest version ${escapeRegExp(version)}`)
  );
});

test('a top CHANGELOG entry with the wrong version fails naming the CHANGELOG', () => {
  const root = copyFixture();
  const version = readManifestVersion(root);
  replaceInFile(path.join(root, 'CHANGELOG.md'), `## [${version}]`, '## [9.9.9.9]');
  const result = runReleaseCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout + result.stderr,
    new RegExp(`top CHANGELOG version does not match manifest version ${escapeRegExp(version)}`)
  );
});

test('a manifest with the wrong product name fails naming the required name', () => {
  const root = copyFixture();
  replaceInFile(
    path.join(root, 'src', 'manifest.json'),
    '"name": "Intercom Support Assistant"',
    '"name": "Wrong Product Name"'
  );
  const result = runReleaseCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /manifest name must be "Intercom Support Assistant"/);
});

test('a manifest description that drifted from the shared product description fails', () => {
  const root = copyFixture();
  const manifestPath = path.join(root, 'src', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.description = 'A different description entirely.';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const result = runReleaseCheck(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /manifest description does not match the current product description/);
});
