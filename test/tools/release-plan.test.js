'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { blockers, plan } = require('../../tools/release-plan');

function ready(overrides = {}) {
  return {
    version: '2.0.19.5',
    tag: 'v2.0.19.5',
    asset: 'Intercom-Support-Assistant-v2.0.19.5.zip',
    branch: 'main',
    dirty: '',
    head: 'abc123abc123abc1',
    remoteHead: 'abc123abc123abc1',
    headTime: 1000,
    localTag: false,
    remoteTag: false,
    releaseExists: false,
    assetTime: 2000,
    notes: '### Fixed\n\n- Something.',
    ...overrides
  };
}

test('a clean, pushed, built and noted version has no blockers', () => {
  assert.deepEqual(blockers(ready()), []);
});

test('each unmet precondition is its own blocker', () => {
  const cases = [
    [{ branch: 'feature' }, /not main/],
    [{ dirty: ' M src/content.js' }, /uncommitted/],
    [{ remoteHead: 'def456' }, /push the release commit/],
    [{ remoteTag: true }, /already exists on origin/],
    [{ localTag: true }, /already exists locally/],
    [{ releaseExists: true }, /GitHub release v2\.0\.19\.5 already exists/],
    [{ assetTime: null }, /missing: run npm run verify/],
    [{ notes: '' }, /no entry for 2\.0\.19\.5/]
  ];
  for (const [override, pattern] of cases) {
    const found = blockers(ready(override));
    assert.equal(found.length, 1, JSON.stringify(override));
    assert.match(found[0], pattern);
  }
});

test('a ZIP built before the last commit is stale, one built in the same second is not', () => {
  assert.match(blockers(ready({ assetTime: 999 }))[0], /older than HEAD/);
  assert.deepEqual(blockers(ready({ assetTime: 1000 })), []);
});

test('the plan attaches only the public ZIP and names the tag at HEAD', () => {
  const text = plan(ready());
  assert.match(text, /gh release create "v2\.0\.19\.5" "Intercom-Support-Assistant-v2\.0\.19\.5\.zip" --title/);
  assert.match(text, /Tag {6}v2\.0\.19\.5 at abc123abc123/);
  assert.doesNotMatch(text, /CR-v/);
});
