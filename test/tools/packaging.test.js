'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
function builtCopy(prefix) {
  const result = spawnSync(process.execPath, ['tools/build-release.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const copy = fs.mkdtempSync(path.join(require('os').tmpdir(), prefix));
  fs.cpSync(path.join(ROOT, 'dist'), copy, { recursive: true });
  return copy;
}

test('the build ships the Intercom page hook as an isolated MAIN-world block', () => {
  const script = 'tools/build-release.js';
  const dist = 'dist';
  const result = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, dist, 'manifest.json'), 'utf8'));
  const hookBlocks = manifest.content_scripts.filter(entry => entry.js.includes('intercom-page-hook.js'));
  assert.equal(hookBlocks.length, 1, `${dist} declares the hook exactly once`);
  assert.deepEqual(hookBlocks[0].js, ['intercom-page-hook.js'], `${dist} hook block holds only the hook`);
  assert.equal(hookBlocks[0].run_at, 'document_start', `${dist} hook run_at`);
  assert.equal(hookBlocks[0].world, 'MAIN', `${dist} hook world`);
  assert.deepEqual(hookBlocks[0].matches, ['https://app.intercom.com/*'], `${dist} hook matches`);
  assert.ok(fs.existsSync(path.join(ROOT, dist, 'intercom-page-hook.js')), `${dist}/intercom-page-hook.js`);

  const isolated = manifest.content_scripts.find(entry => entry.js.includes('intercom-boot.js'));
  assert.deepEqual(isolated.js,
    [
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
    ],
    `${dist} isolated Intercom order is unchanged`);
  assert.equal(isolated.world, undefined, `${dist} Intercom runtime stays in the isolated world`);
});

test('the extension asks for no permission or host scope beyond the Intercom app', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
  assert.deepEqual([...manifest.permissions].sort(), ['notifications', 'scripting', 'storage', 'tabs']);
  assert.deepEqual([...manifest.host_permissions], ['https://app.intercom.com/*']);
  assert.ok(!manifest.host_permissions.some(scope => /eu\.intercom|au\.intercom/.test(scope)),
    'regional Intercom hosts are deliberately not granted');
});

test('the build ships the support tools and the preview page mounts every card', () => {
  const script = 'tools/build-release.js';
  const dist = 'dist';
  const result = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`);

  assert.ok(fs.existsSync(path.join(ROOT, dist, 'support-tools-ui.js')), `${dist}/support-tools-ui.js`);

  const preview = fs.readFileSync(path.join(ROOT, dist, 'preview-page.html'), 'utf8');
  assert.match(preview, /<script src="support-tools-ui\.js"><\/script>/, `${dist} preview script tag`);
  assert.match(preview, /id="isa-support-tools"/, `${dist} captures mount point`);
  assert.match(preview, /id="isa-settings-backup"/, `${dist} backup mount point`);
  assert.match(preview, /id="isa-debug-flags"/, `${dist} debug flag mount point`);
  assert.match(preview, /class="tools-grid"/, `${dist} tools grid`);
  assert.equal((preview.match(/class="tools-column"/g) || []).length, 2, `${dist} two tool columns`);
  assert.ok(!fs.existsSync(path.join(ROOT, dist, 'dom-tools-ui.js')), `${dist} must not ship the merged-away card`);
  assert.ok(!preview.includes('dom-tools-ui.js'), `${dist} preview must not load the merged-away card`);
});

test('the support tools add no permission and stay out of every tab', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['scripting', 'tabs', 'storage', 'notifications']);
  assert.ok(!JSON.stringify(manifest.content_scripts).includes('support-tools-ui.js'),
    'the support tools are a preview-page script, never a content script');
});

test('the build references no host outside Intercom, the brand placeholders, and the source link', () => {
  const copy = builtCopy('isa-default-build-');
  try {
    const allowed = /^(app\.intercom\.com|js\.intercomcdn\.com|github\.com|www\.w3\.org|[a-z0-9-]+\.example)$/;
    const unexpected = [];
    for (const file of fs.readdirSync(copy).filter(name => /\.(js|html|json|css)$/.test(name))) {
      const text = fs.readFileSync(path.join(copy, file), 'utf8');
      for (const match of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
        if (!allowed.test(match[1].toLowerCase())) unexpected.push(`${file}: ${match[1]}`);
      }
    }
    assert.deepEqual(unexpected, []);
    assert.ok(!fs.existsSync(path.join(copy, 'diagnostics.js')), 'no diagnostics module ships');
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
