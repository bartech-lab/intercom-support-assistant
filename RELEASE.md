# Verification

There are no versions, tags or releases. Changes land on `main`, mostly as
ports from the private repository. Run these before pushing a change that
affects what ships.

## 1. Verify

```bash
npm run verify
```

| Stage | What it checks |
| --- | --- |
| 1. `npm test` | the whole suite |
| 2. syntax | `node --check` on every JavaScript file in `src/`, `tools/`, `test/` |
| 3. `git diff --check` | whitespace errors |
| 4. `tools/release-check.js` | product name and description match the manifest; signature config validates; the preview data is regenerated; no `DEBUG = true` constant is left in `src/` |
| 5. `tools/build-release.js --zip` | builds `dist/` from `src/`, runs the artifact verifier, writes the ZIP |
| 6. ZIP check | the ZIP exists and is not empty |

`tools/artifact-verifier.js` compares the built tree with the manifest: every
referenced file exists, nothing unreferenced ships, the content scripts keep
their order, and the only host permission is `https://app.intercom.com/*`.

Run verification serially in one checkout: the build deletes and recreates
`dist/`.

## 2. Manual smoke check

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
