#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = {
  manifest: path.join('src', 'manifest.json'),
  popup: path.join('src', 'popup.html'),
  readme: 'README.md',
  changelog: 'CHANGELOG.md'
};
const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;
const SECTION_RE = /^### (Added|Changed|Fixed|Removed|Security|Deprecated)$/m;

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

function nextVersion(current, request) {
  const parts = current.split('.').map(Number);
  if (request === 'patch') return [parts[0], parts[1], parts[2], parts[3] + 1].join('.');
  if (request === 'minor') return [parts[0], parts[1], parts[2] + 1, 0].join('.');
  return request;
}

function changelogSection(changelog, version) {
  const escaped = version.replace(/\./g, '\\.');
  const match = changelog.match(new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## |^---\\s*$|(?![\\s\\S]))`, 'm'));
  return match ? match[1].trim() : null;
}

function planBump(files, request, notes, date) {
  const errors = [];
  const manifest = JSON.parse(files.manifest);
  const current = manifest.version;
  const version = nextVersion(current, request);

  if (!VERSION_RE.test(version)) errors.push(`version ${version} must look like 2.0.18.9, or pass patch or minor`);
  else if (compareVersions(version, current) <= 0) errors.push(`version ${version} must be greater than the current ${current}`);
  if (changelogSection(files.changelog, version) !== null) errors.push(`CHANGELOG.md already has an entry for ${version}`);

  const body = (notes || '').trim();
  if (!body) errors.push('release notes are empty; write them to a file and pass --notes=<file>');
  else if (!SECTION_RE.test(body)) errors.push('release notes need at least one "### Added|Changed|Fixed|Removed" heading');
  if (/^## /m.test(body)) errors.push('release notes must not contain a "## " heading; the tool writes the version heading');

  const popupCount = (files.popup.match(new RegExp(`v${current.replace(/\./g, '\\.')}\\b`, 'g')) || []).length;
  if (popupCount !== 1) errors.push(`src/popup.html should show v${current} exactly once, found ${popupCount}`);
  if (!files.readme.includes(`**v${current}**`)) errors.push(`README.md does not show **v${current}**`);
  if (!/^## \[/m.test(files.changelog)) errors.push('CHANGELOG.md has no "## [" entry to insert above');

  if (errors.length) return { errors, current, version, files };

  manifest.version = version;
  const firstEntry = files.changelog.search(/^## \[/m);
  return {
    errors,
    current,
    version,
    files: {
      manifest: files.manifest.replace(`"version": "${current}"`, `"version": "${version}"`),
      popup: files.popup.replace(`v${current}`, `v${version}`),
      readme: files.readme.replace(`**v${current}**`, `**v${version}**`),
      changelog: `${files.changelog.slice(0, firstEntry)}## [${version}] - ${date}\n\n${body}\n\n${files.changelog.slice(firstEntry)}`
    }
  };
}

function readFiles(root) {
  return Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), 'utf8')]));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function run(argv, { root = ROOT, date = today() } = {}) {
  const args = argv.filter(value => !value.startsWith('--'));
  const flag = name => {
    const found = argv.find(value => value.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : null;
  };

  const printVersion = flag('print-notes');
  if (printVersion) {
    const section = changelogSection(fs.readFileSync(path.join(root, FILES.changelog), 'utf8'), printVersion);
    if (section === null) throw new Error(`CHANGELOG.md has no entry for ${printVersion}`);
    return { printed: section };
  }

  if (!args[0]) throw new Error('usage: node tools/bump-version.js <patch|minor|X.Y.Z.W> --notes=<file> [--apply]\n       node tools/bump-version.js --print-notes=<X.Y.Z.W>');
  const notesPath = flag('notes');
  const notes = notesPath ? fs.readFileSync(path.resolve(notesPath), 'utf8') : '';
  const plan = planBump(readFiles(root), args[0], notes, date);
  const apply = argv.includes('--apply') && !plan.errors.length;
  if (apply) {
    for (const [key, file] of Object.entries(FILES)) fs.writeFileSync(path.join(root, file), plan.files[key]);
  }
  return { ...plan, applied: apply };
}

if (require.main === module) {
  try {
    const outcome = run(process.argv.slice(2));
    if (outcome.printed !== undefined) {
      process.stdout.write(outcome.printed + '\n');
    } else if (outcome.errors.length) {
      outcome.errors.forEach(error => process.stderr.write(`error  ${error}\n`));
      process.stderr.write('nothing written\n');
      process.exit(1);
    } else {
      process.stdout.write(`${outcome.current} -> ${outcome.version} in ${Object.values(FILES).join(', ')}\n`);
      process.stdout.write(outcome.applied ? 'written\n' : 'dry run, nothing written; rerun with --apply\n');
    }
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exit(1);
  }
}

module.exports = { planBump, nextVersion, changelogSection, compareVersions, run };
