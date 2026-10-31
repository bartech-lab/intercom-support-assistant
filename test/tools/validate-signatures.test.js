'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BANNERS, configWithBanners } = require('../support/fixtures-banners');

const REPO = path.join(__dirname, '..', '..');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-signatures-'));
  tempDirs.push(dir);
  fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(REPO, 'tools'), path.join(dir, 'tools'), { recursive: true });
  fs.cpSync(path.join(REPO, 'docs'), path.join(dir, 'docs'), { recursive: true });
  const config = path.join(dir, 'src', 'intercom-config.js');
  fs.writeFileSync(config, configWithBanners(fs.readFileSync(config, 'utf8')));
  return dir;
}

function runValidateSignatures(root) {
  return spawnSync(process.execPath, [path.join('tools', 'validate-signatures.js')], {
    cwd: root,
    encoding: 'utf8'
  });
}

function configPath(root) {
  return path.join(root, 'src', 'intercom-config.js');
}

function replaceInConfig(root, search, replacement) {
  const filePath = configPath(root);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes(search), `fixture is missing ${JSON.stringify(search)} in intercom-config.js`);
  fs.writeFileSync(filePath, content.replace(search, replacement));
}

test('a clean checkout copy passes with only expiry warnings, never a failure', () => {
  const root = copyFixture();
  const result = runValidateSignatures(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Signature configuration is valid/);
  const warningLines = result.stdout.split('\n').filter((line) => line.startsWith('- '));
  for (const line of warningLines) {
    assert.match(line, /^- promotionalBanners .+: expired on \d{4}-\d{2}-\d{2}(; remove it from intercom-config\.js)?$/, line);
  }
});

test('a company signature missing a required language fails, naming the company and language', () => {
  const root = copyFixture();
  replaceInConfig(
    root,
    '    german: "<br>--<br>Viele Grüße<br>Elena Duarte<br>Kundenservice @ Saltmarsh Crafts<br><a href=\'https://saltmarsh-crafts.example/\' target=\'_blank\'>https://saltmarsh-crafts.example/</a>",\n',
    ''
  );
  const result = runValidateSignatures(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Company Saltmarsh Crafts: missing german/);
});

test('the team signature missing a required language fails, naming TEAM and the language', () => {
  const root = copyFixture();
  replaceInConfig(
    root,
    '  german: "<br>--<br>Viele Grüße,<br>Ihr Support-Team",\n',
    ''
  );
  const result = runValidateSignatures(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Team signature TEAM: missing german/);
});

test('a promotional banner for a company that is not in companies fails as an unknown company', () => {
  const root = copyFixture();
  replaceInConfig(root, '"Brightwell": {\n    english: "📍Brightwell spring', '"Ghost Brand": {\n    english: "📍Brightwell spring');
  const result = runValidateSignatures(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /promotionalBanners Ghost Brand: unknown company/);
});

test('a promotional banner with a malformed expiry date fails instead of silently passing', () => {
  const root = copyFixture();
  replaceInConfig(root, 'expires: "2026-09-22"', 'expires: "22-09-2026"');
  const result = runValidateSignatures(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /expires must be YYYY-MM-DD/);
});

test('a promotional banner missing a language only warns, unlike a company or team signature doing the same', () => {
  const root = copyFixture();
  replaceInConfig(
    root,
    `    english: ${JSON.stringify(BANNERS['Brightwell'].english)},\n`,
    ''
  );
  const result = runValidateSignatures(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /promotionalBanners Brightwell: missing english/);
  assert.match(result.stdout, /Signature configuration is valid/);
});

test('one alias claimed by two companies fails, naming the alias and both companies', () => {
  const root = copyFixture();
  replaceInConfig(root, '"Marlowe Books": ["marlowe"]', '"Marlowe Books": ["kestrel"]');
  const result = runValidateSignatures(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /companyAliases kestrel: used by both Kestrel Kids and Marlowe Books/);
});
