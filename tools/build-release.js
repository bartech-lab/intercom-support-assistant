#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  verifyExtractedArtifact,
  formatVerificationResults,
  hasErrors
} = require('./artifact-verifier');
const ARTIFACT_PREFIX = 'Intercom-Support-Assistant';

const REPO_ROOT = path.join(__dirname, '..');
const SRC = path.join(REPO_ROOT, 'src');

function main() {
  const dist = 'dist';
  fs.rmSync(dist, { recursive: true, force: true });
  fs.cpSync(SRC, dist, { recursive: true });

  const distResults = verifyExtractedArtifact(dist);
  console.log(formatVerificationResults(distResults));

  if (hasErrors(distResults)) {
    console.error('\nFAILED');
    process.exit(1);
  }

  console.log('Done. dist/ is clean.');

  if (process.argv.includes('--zip')) {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
    const zipFile = `${ARTIFACT_PREFIX}-v${manifest.version}.zip`;

    for (const f of fs.readdirSync('.')) {
      if (f.startsWith(`${ARTIFACT_PREFIX}-v`) && f.endsWith('.zip')) fs.unlinkSync(f);
    }

    let r = spawnSync('7z', ['a', '-tzip', path.resolve(zipFile), '.'], { cwd: dist, stdio: 'pipe' });
    if (r.status !== 0) {
      r = spawnSync('python3', ['-c',
        `import zipfile,os;os.chdir('${dist}');z=zipfile.ZipFile('${path.resolve(zipFile)}','w');[z.write(os.path.join(r,f)) for r,_,fs in os.walk('.') for f in fs];z.close()`],
        { stdio: 'pipe' });
    }
    if (r.status !== 0) {
      console.error('Failed to create', zipFile);
      process.exit(1);
    }

    const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intercom-artifact-'));
    const extract = spawnSync('python3', ['-m', 'zipfile', '-e', path.resolve(zipFile), verifyDir], { stdio: 'pipe' });
    if (extract.status !== 0) {
      console.error(`Failed to extract ${zipFile} for verification`);
      process.exit(1);
    }

    const zipResults = verifyExtractedArtifact(verifyDir);
    console.log(formatVerificationResults(zipResults));
    fs.rmSync(verifyDir, { recursive: true, force: true });

    if (hasErrors(zipResults)) {
      fs.rmSync(zipFile, { force: true });
      process.exit(1);
    }

    console.log('Created', zipFile);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ARTIFACT_PREFIX
};
