# Release process

A release is one GitHub release carrying exactly one asset,
`Intercom-Support-Assistant-vX.Y.Z.W.zip`. Versions have four parts:
`major.minor.patch.build`.

No step below tags or publishes on its own. The last step prints the commands
and a person runs them.

## 1. Bump the version

```bash
node tools/bump-version.js patch --notes=scratchpad/notes.md          # dry run
node tools/bump-version.js patch --notes=scratchpad/notes.md --apply
```

`patch`, `minor`, or an explicit `X.Y.Z.W`. The tool updates the version in
`src/manifest.json`, `src/popup.html`, and `README.md`, and adds a dated
`CHANGELOG.md` entry from the notes file. A dry run prints the plan and any
error without writing.

## 2. Verify

```bash
npm run verify
```

| Stage | What it checks |
| --- | --- |
| 1. `npm test` | the whole suite |
| 2. syntax | `node --check` on every JavaScript file in `src/`, `tools/`, `test/` |
| 3. `git diff --check` | whitespace errors |
| 4. `tools/release-check.js` | product name, description, and version agree across manifest, popup, README and changelog; signature config validates; the preview data is regenerated; no `DEBUG = true` constant is left in `src/` |
| 5. `tools/build-release.js --zip` | builds `dist/` from `src/`, runs the artifact verifier, writes the ZIP |
| 6. ZIP check | the ZIP exists and is not empty |

`tools/artifact-verifier.js` compares the built tree with the manifest: every
referenced file exists, nothing unreferenced ships, the content scripts keep
their order, and the only host permission is `https://app.intercom.com/*`.

Run verification serially in one checkout: the build deletes and recreates
`dist/`.

## 3. Manual smoke check

Load `dist/` unpacked against an Intercom workspace with test data:

- An empty email composer gets one signature in the detected language; a
  non-empty one gets none; note and chat composers get none.
- A language chip rewrites an untouched signature.
- An `Escalation Status` of `In Progress` blocks Close; so does a last internal
  note linking to Slack, Jira, or Linear. Snooze still works.
- A new conversation in a watched inbox chimes once and raises one desktop
  notification; reloading the tab does not repeat it.
- An auto-delete note shows its deadline chip and is removed after expiry on the
  next visit to that contact.
- The popup and workspace work in light and dark themes at 390 px wide.

## 4. Commit and push

Commit the version bump and push to `main`. `dist/` and ZIPs are git-ignored.

## 5. Release

```bash
node tools/release-plan.js
```

It checks that `HEAD` is a clean, pushed `main`, that the tag and the release do
not exist yet, that the ZIP is newer than the last commit, and that the changelog
has an entry. It exits 1 listing every blocker, or prints the tag, `gh release
create`, and verification commands to run by hand.

After publishing, extract the asset and run:

```bash
node tools/verify-artifact.js /path/to/extracted-extension
```
