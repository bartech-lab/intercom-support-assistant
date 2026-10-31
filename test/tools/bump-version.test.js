'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  run,
  nextVersion,
  compareVersions,
  changelogSection,
  planBump
} = require('../../tools/bump-version');

const REPO = path.join(__dirname, '..', '..');
const DATE = '2026-09-26';
const NOTES = '### Fixed\n\n- The composer no longer loses a draft after a reload.';

const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-version-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const FIXTURE_CHANGELOG = [
  '# Changelog',
  '',
  'Intro line.',
  '',
  '## [2.0.18.9] - 2026-09-25',
  '',
  '### Added',
  '',
  '- Top entry.',
  '',
  '## [2.0.18.8] - 2026-09-24',
  '',
  '### Fixed',
  '',
  '- Middle entry fix.',
  '',
  '### Changed',
  '',
  '- Middle entry change.',
  '',
  '## [2.0.18.7] - 2026-09-23',
  '',
  '### Fixed',
  '',
  '- Last entry.',
  ''
].join('\n');

function fixtureFiles(version = '2.0.18.9') {
  return {
    manifest: JSON.stringify({ manifest_version: 3, name: 'Intercom Support Assistant', version, permissions: ['storage'] }, null, 2) + '\n',
    popup: `<html><body><footer><span>v${version}</span></footer></body></html>\n`,
    readme: `# Intercom Support Assistant\n\nCurrent version: **v${version}**. See the changelog.\n`,
    changelog: FIXTURE_CHANGELOG.replace('2.0.18.9', version)
  };
}

function writeRoot(files) {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'manifest.json'), files.manifest);
  fs.writeFileSync(path.join(root, 'src', 'popup.html'), files.popup);
  fs.writeFileSync(path.join(root, 'README.md'), files.readme);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), files.changelog);
  return root;
}

function realFiles() {
  return {
    manifest: fs.readFileSync(path.join(REPO, 'src', 'manifest.json'), 'utf8'),
    popup: fs.readFileSync(path.join(REPO, 'src', 'popup.html'), 'utf8'),
    readme: fs.readFileSync(path.join(REPO, 'README.md'), 'utf8'),
    changelog: fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8')
  };
}

function readRoot(root) {
  return {
    manifest: fs.readFileSync(path.join(root, 'src', 'manifest.json')),
    popup: fs.readFileSync(path.join(root, 'src', 'popup.html')),
    readme: fs.readFileSync(path.join(root, 'README.md')),
    changelog: fs.readFileSync(path.join(root, 'CHANGELOG.md'))
  };
}

function readRootText(root) {
  const bytes = readRoot(root);
  return Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, value.toString('utf8')]));
}

function assertBytesEqual(before, afterFiles) {
  for (const key of Object.keys(before)) {
    assert.ok(before[key].equals(afterFiles[key]), `${key} changed`);
  }
}

function writeNotes(content) {
  const file = path.join(tempDir(), 'notes.md');
  fs.writeFileSync(file, content);
  return file;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectRejected(files, argv, pattern) {
  const root = writeRoot(files);
  const before = readRoot(root);
  const result = run([...argv, '--apply'], { root, date: DATE });
  assert.ok(Array.isArray(result.errors), 'errors must be an array');
  assert.ok(result.errors.length > 0, 'expected at least one error');
  if (pattern) assert.match(result.errors.join('\n'), pattern);
  assert.equal(result.applied, false);
  assertBytesEqual(before, readRoot(root));
  return result;
}

test('nextVersion patch increments the fourth part', () => {
  assert.equal(nextVersion('2.0.18.8', 'patch'), '2.0.18.9');
  assert.equal(nextVersion('2.0.18.9', 'patch'), '2.0.18.10');
});

test('nextVersion minor increments the third part and resets the fourth to zero', () => {
  assert.equal(nextVersion('2.0.18.8', 'minor'), '2.0.19.0');
});

test('nextVersion returns an explicit version unchanged', () => {
  assert.equal(nextVersion('2.0.18.8', '2.1.0.0'), '2.1.0.0');
});

test('compareVersions compares each part numerically, not as text', () => {
  assert.equal(compareVersions('2.0.18.10', '2.0.18.9'), 1);
  assert.equal(compareVersions('2.0.18.9', '2.0.18.10'), -1);
  assert.equal(compareVersions('2.0.18.8', '2.0.18.8'), 0);
  assert.equal(compareVersions('2.0.9.0', '2.0.10.0'), -1);
  assert.equal(compareVersions('3.0.0.0', '2.9.99.99'), 1);
});

test('changelogSection returns the second entry body, bounded by the next heading', () => {
  assert.equal(
    changelogSection(FIXTURE_CHANGELOG, '2.0.18.8'),
    '### Fixed\n\n- Middle entry fix.\n\n### Changed\n\n- Middle entry change.'
  );
});

test('changelogSection returns the last entry body when no heading follows it', () => {
  assert.equal(changelogSection(FIXTURE_CHANGELOG, '2.0.18.7'), '### Fixed\n\n- Last entry.');
});

test('changelogSection returns null for a version without an entry', () => {
  assert.equal(changelogSection(FIXTURE_CHANGELOG, '2.0.18.6'), null);
  assert.equal(changelogSection(FIXTURE_CHANGELOG, '2.0.18'), null);
});

test('an applied patch bump on the real files updates all four and keeps everything else', () => {
  const original = realFiles();
  const current = JSON.parse(original.manifest).version;
  const next = nextVersion(current, 'patch');
  const root = writeRoot(original);
  const result = run(['patch', `--notes=${writeNotes(NOTES + '\n')}`, '--apply'], { root, date: DATE });

  assert.deepEqual(result.errors, []);
  assert.equal(result.applied, true);
  assert.equal(result.current, current);
  assert.equal(result.version, next);

  const updated = readRootText(root);

  const oldManifest = JSON.parse(original.manifest);
  const newManifest = JSON.parse(updated.manifest);
  assert.equal(newManifest.version, next);
  assert.deepEqual({ ...newManifest, version: current }, oldManifest);

  assert.ok(updated.popup.includes(`v${next}`));
  assert.ok(!updated.popup.includes(`v${current}`));
  assert.equal(updated.popup.split(`v${next}`).join(`v${current}`), original.popup);

  assert.ok(updated.readme.includes(`**v${next}**`));
  assert.ok(!updated.readme.includes(`**v${current}**`));
  assert.equal(updated.readme.split(`**v${next}**`).join(`**v${current}**`), original.readme);

  const oldTop = `## [${current}]`;
  const oldIndex = original.changelog.indexOf(oldTop);
  const newOldIndex = updated.changelog.indexOf(oldTop);
  assert.ok(oldIndex > 0 && newOldIndex > oldIndex);
  assert.equal(updated.changelog.slice(0, oldIndex), original.changelog.slice(0, oldIndex));
  assert.equal(updated.changelog.slice(newOldIndex), original.changelog.slice(oldIndex));
  const inserted = updated.changelog.slice(oldIndex, newOldIndex);
  assert.match(inserted, new RegExp(`^## \\[${escapeRegExp(next)}\\] - ${DATE}\\n\\s*${escapeRegExp(NOTES)}\\s*$`));
  assert.equal(changelogSection(updated.changelog, next), NOTES);
  assert.equal(changelogSection(updated.changelog, current), changelogSection(original.changelog, current));
});

test('the bumped files satisfy the release-check version patterns', () => {
  const root = writeRoot(fixtureFiles('2.0.18.9'));
  const result = run(['patch', `--notes=${writeNotes(NOTES)}`, '--apply'], { root, date: DATE });
  assert.deepEqual(result.errors, []);
  const updated = readRootText(root);
  const versionPattern = '(\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?)';
  assert.equal(JSON.parse(updated.manifest).version, '2.0.18.10');
  assert.equal(updated.popup.match(new RegExp(`v${versionPattern}`))[1], '2.0.18.10');
  assert.equal(updated.changelog.match(new RegExp(`^## \\[${versionPattern}\\]`, 'm'))[1], '2.0.18.10');
  assert.equal(updated.readme.match(new RegExp(`\\*\\*v${versionPattern}\\*\\*`))[1], '2.0.18.10');
});

test('an explicit version is applied as given', () => {
  const root = writeRoot(fixtureFiles());
  const result = run(['2.1.0.0', `--notes=${writeNotes(NOTES)}`, '--apply'], { root, date: DATE });
  assert.deepEqual(result.errors, []);
  assert.equal(result.applied, true);
  assert.equal(result.version, '2.1.0.0');
  const updated = readRootText(root);
  assert.equal(JSON.parse(updated.manifest).version, '2.1.0.0');
  assert.ok(updated.popup.includes('v2.1.0.0'));
  assert.ok(updated.readme.includes('**v2.1.0.0**'));
  assert.match(updated.changelog, /^## \[2\.1\.0\.0\] - 2026-09-26$/m);
});

test('a minor bump resets the fourth part and is applied', () => {
  const root = writeRoot(fixtureFiles());
  const result = run(['minor', `--notes=${writeNotes(NOTES)}`, '--apply'], { root, date: DATE });
  assert.deepEqual(result.errors, []);
  assert.equal(result.version, '2.0.19.0');
  const updated = readRootText(root);
  assert.equal(JSON.parse(updated.manifest).version, '2.0.19.0');
  assert.equal(updated.changelog.match(/^## \[([^\]]+)\] - (\S+)$/m).slice(1).join(' '), `2.0.19.0 ${DATE}`);
});

test('a dry run reports the plan and leaves every file byte-identical', () => {
  const root = writeRoot(fixtureFiles());
  const before = readRoot(root);
  const result = run(['patch', `--notes=${writeNotes(NOTES)}`], { root, date: DATE });
  assert.deepEqual(result.errors, []);
  assert.equal(result.applied, false);
  assert.equal(result.current, '2.0.18.9');
  assert.equal(result.version, '2.0.18.10');
  assertBytesEqual(before, readRoot(root));
});

test('planBump is pure and returns the new file contents', () => {
  const files = fixtureFiles();
  const snapshot = { ...files };
  const result = planBump(files, 'patch', NOTES, DATE);
  assert.deepEqual(files, snapshot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.current, '2.0.18.9');
  assert.equal(result.version, '2.0.18.10');
  assert.equal(JSON.parse(result.files.manifest).version, '2.0.18.10');
  assert.ok(result.files.popup.includes('v2.0.18.10'));
  assert.ok(result.files.readme.includes('**v2.0.18.10**'));
  assert.equal(changelogSection(result.files.changelog, '2.0.18.10'), NOTES);
});

test('a version equal to the current one is rejected and nothing is written', () => {
  expectRejected(fixtureFiles('2.0.18.9'), ['2.0.18.9', `--notes=${writeNotes(NOTES)}`]);
});

for (const lower of ['2.0.18.6', '2.0.17.20', '1.9.99.99']) {
  test(`version ${lower} below the current 2.0.18.9, with no CHANGELOG entry, is rejected as not greater and nothing is written`, () => {
    const files = fixtureFiles('2.0.18.9');
    assert.equal(files.changelog.includes(`[${lower}]`), false);
    const result = expectRejected(files, [lower, `--notes=${writeNotes(NOTES)}`], /must be greater than the current 2\.0\.18\.9/);
    assert.equal(result.errors.some((error) => /already has an entry/i.test(error)), false);
  });
}

test('an explicit version equal to the current one is rejected with a must-be-greater-than-the-current error', () => {
  expectRejected(
    fixtureFiles('2.0.18.9'),
    ['2.0.18.9', `--notes=${writeNotes(NOTES)}`],
    /must be greater than the current 2\.0\.18\.9/
  );
});

test('2.0.18.10 over 2.0.18.9 is accepted because comparison is numeric', () => {
  const root = writeRoot(fixtureFiles('2.0.18.9'));
  const result = run(['2.0.18.10', `--notes=${writeNotes(NOTES)}`, '--apply'], { root, date: DATE });
  assert.deepEqual(result.errors, []);
  assert.equal(result.applied, true);
  assert.equal(JSON.parse(readRootText(root).manifest).version, '2.0.18.10');
});

for (const malformed of ['2.0.19', 'v2.0.19.0', 'abc', '2.0.19.0.1']) {
  test(`malformed version ${JSON.stringify(malformed)} is rejected and nothing is written`, () => {
    expectRejected(fixtureFiles(), [malformed, `--notes=${writeNotes(NOTES)}`]);
  });
}

test('a target version that already has a CHANGELOG entry is rejected and nothing is written', () => {
  const files = fixtureFiles('2.0.18.9');
  files.changelog = files.changelog.replace('## [2.0.18.9]', '## [2.0.18.10] - 2026-09-26\n\n### Fixed\n\n- Stray.\n\n## [2.0.18.9]');
  expectRejected(files, ['patch', `--notes=${writeNotes(NOTES)}`]);
});

test('a bump without --notes is rejected and nothing is written', () => {
  expectRejected(fixtureFiles(), ['patch']);
});

test('empty notes are rejected and nothing is written', () => {
  expectRejected(fixtureFiles(), ['patch', `--notes=${writeNotes('')}`]);
});

test('whitespace-only notes are rejected and nothing is written', () => {
  expectRejected(fixtureFiles(), ['patch', `--notes=${writeNotes('  \n\t\n  ')}`]);
});

test('notes without an Added, Changed, Fixed or Removed heading are rejected', () => {
  expectRejected(fixtureFiles(), ['patch', `--notes=${writeNotes('- A bullet with no section heading.')}`]);
  expectRejected(fixtureFiles(), ['patch', `--notes=${writeNotes('### Notes\n\n- Unknown section name.')}`]);
});

test('notes with any of the four allowed headings are accepted', () => {
  for (const heading of ['Added', 'Changed', 'Fixed', 'Removed']) {
    const result = planBump(fixtureFiles(), 'patch', `### ${heading}\n\n- Item.`, DATE);
    assert.deepEqual(result.errors, [], heading);
  }
});

test('notes containing a level-two heading are rejected and nothing is written', () => {
  expectRejected(fixtureFiles(), ['patch', `--notes=${writeNotes('## [2.0.18.10] - 2026-09-26\n\n### Fixed\n\n- Item.')}`]);
  expectRejected(fixtureFiles(), ['patch', `--notes=${writeNotes('### Fixed\n\n- Item.\n\n## Something else')}`]);
});

test('a popup that shows the current version zero times is rejected and nothing is written', () => {
  const files = fixtureFiles('2.0.18.9');
  files.popup = '<html><body><footer><span>v2.0.18.8</span></footer></body></html>\n';
  expectRejected(files, ['patch', `--notes=${writeNotes(NOTES)}`]);
});

test('a popup that shows the current version twice is rejected and nothing is written', () => {
  const files = fixtureFiles('2.0.18.9');
  files.popup = '<html><body><h1>v2.0.18.9</h1><footer><span>v2.0.18.9</span></footer></body></html>\n';
  expectRejected(files, ['patch', `--notes=${writeNotes(NOTES)}`]);
});

test('a README without the bold current version is rejected and nothing is written', () => {
  const files = fixtureFiles('2.0.18.9');
  files.readme = '# Intercom Support Assistant\n\nCurrent version: v2.0.18.9. See the changelog.\n';
  expectRejected(files, ['patch', `--notes=${writeNotes(NOTES)}`]);
});

test('a README showing an older bold version is rejected and nothing is written', () => {
  const files = fixtureFiles('2.0.18.9');
  files.readme = '# Intercom Support Assistant\n\nCurrent version: **v2.0.18.8**. See the changelog.\n';
  expectRejected(files, ['patch', `--notes=${writeNotes(NOTES)}`]);
});

test('--print-notes returns the second entry, not the top one', () => {
  const root = writeRoot(fixtureFiles());
  const result = run(['--print-notes=2.0.18.8'], { root });
  assert.equal(result.printed, '### Fixed\n\n- Middle entry fix.\n\n### Changed\n\n- Middle entry change.');
});

test('--print-notes returns the top entry', () => {
  const root = writeRoot(fixtureFiles());
  assert.equal(run(['--print-notes=2.0.18.9'], { root }).printed, '### Added\n\n- Top entry.');
});

test('--print-notes returns the last entry, which has no following heading', () => {
  const root = writeRoot(fixtureFiles());
  assert.equal(run(['--print-notes=2.0.18.7'], { root }).printed, '### Fixed\n\n- Last entry.');
});

test('--print-notes throws for a version without an entry and writes nothing', () => {
  const root = writeRoot(fixtureFiles());
  const before = readRoot(root);
  assert.throws(() => run(['--print-notes=2.0.18.6'], { root }), Error);
  assertBytesEqual(before, readRoot(root));
});

test('--print-notes on the real CHANGELOG returns its top entry, which runs to the end of the file', () => {
  const original = realFiles();
  const headings = [...original.changelog.matchAll(/^## \[([^\]]+)\]/gm)];
  assert.ok(headings.length >= 1);
  const top = headings[0][1];
  const start = original.changelog.indexOf('\n', headings[0].index) + 1;
  const end = headings[1] ? headings[1].index : original.changelog.length;
  const expected = original.changelog.slice(start, end).trim();
  assert.ok(expected.length > 0);
  const root = writeRoot(original);
  assert.equal(run([`--print-notes=${top}`], { root }).printed, expected);
});
