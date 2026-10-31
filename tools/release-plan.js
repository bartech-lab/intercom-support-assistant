#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ARTIFACT_PREFIX } = require('./build-release');

const ROOT = path.join(__dirname, '..');

function run(cmd, args, cwd = ROOT) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

function gather(root = ROOT) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'src', 'manifest.json'), 'utf8')).version;
  const tag = `v${version}`;
  const asset = `${ARTIFACT_PREFIX}-v${version}.zip`;
  const assetPath = path.join(root, asset);
  run('git', ['fetch', '--quiet', 'origin', 'main', '--tags'], root);
  const notes = run(process.execPath, [path.join(root, 'tools', 'bump-version.js'), `--print-notes=${version}`], root);
  return {
    version,
    tag,
    asset,
    branch: run('git', ['branch', '--show-current'], root).stdout,
    dirty: run('git', ['status', '--porcelain', '--untracked-files=no'], root).stdout,
    head: run('git', ['rev-parse', 'HEAD'], root).stdout,
    remoteHead: run('git', ['rev-parse', 'origin/main'], root).stdout,
    headTime: Number(run('git', ['log', '-1', '--format=%ct'], root).stdout) * 1000,
    localTag: run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], root).status === 0,
    remoteTag: run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], root).stdout !== '',
    releaseExists: run('gh', ['release', 'view', tag, '--json', 'tagName'], root).status === 0,
    assetTime: fs.existsSync(assetPath) ? fs.statSync(assetPath).mtimeMs : null,
    notes: notes.status === 0 ? notes.stdout : ''
  };
}

function blockers(facts) {
  const found = [];
  if (facts.branch !== 'main') found.push(`branch is ${facts.branch || '(detached)'}, not main`);
  if (facts.dirty) found.push(`tracked files have uncommitted changes:\n${facts.dirty}`);
  if (facts.head !== facts.remoteHead) found.push('HEAD is not origin/main: push the release commit first');
  if (facts.localTag || facts.remoteTag) found.push(`tag ${facts.tag} already exists${facts.remoteTag ? ' on origin' : ' locally'}`);
  if (facts.releaseExists) found.push(`GitHub release ${facts.tag} already exists`);
  if (facts.assetTime === null) found.push(`${facts.asset} is missing: run npm run verify`);
  else if (facts.assetTime < facts.headTime) found.push(`${facts.asset} is older than HEAD: run npm run verify again`);
  if (!facts.notes) found.push(`CHANGELOG.md has no entry for ${facts.version}`);
  return found;
}

function plan(facts) {
  const title = `${facts.tag} — Intercom Support Assistant`;
  return [
    `Version  ${facts.version}`,
    `Tag      ${facts.tag} at ${facts.head.slice(0, 12)}`,
    `Title    ${title}`,
    `Asset    ${facts.asset}`,
    '',
    'Notes:',
    facts.notes,
    '',
    'After a yes, run:',
    `git tag -a "${facts.tag}" -m "${title}" HEAD`,
    `git push --no-verify origin "refs/tags/${facts.tag}"`,
    `node tools/bump-version.js --print-notes="${facts.version}" > scratchpad/release-body.md`,
    `gh release create "${facts.tag}" "${facts.asset}" --title "${title}" --notes-file scratchpad/release-body.md`,
    `gh release view "${facts.tag}" --json tagName,assets --jq '.tagName, .assets[].name'`
  ].join('\n');
}

function main() {
  const facts = gather();
  const found = blockers(facts);
  if (found.length) {
    console.error(`Not ready to release ${facts.tag}:`);
    for (const item of found) console.error(`- ${item}`);
    process.exit(1);
  }
  console.log(plan(facts));
}

module.exports = { blockers, plan };

if (require.main === module) main();
