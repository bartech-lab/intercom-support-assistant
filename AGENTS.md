# AGENTS.md

Contributor and agent rules for Intercom Support Assistant: a Manifest V3 Chrome
extension for the Intercom inbox. Plain JavaScript, no build step, no
production dependencies.

## Layout

```
src/      the extension; manifest.json sits at its root. Load unpacked from here.
tools/    build, verify, release, signature preview, capture reader. Never shipped.
test/     node --test suites, jsdom + vm.
scripts/  leak-scan.mjs, the publication gate.
docs/     reference docs, listed below.
```

`src/` is exactly the set of files that ship.

## Commands

| Task | Command |
| --- | --- |
| Fast regression suite | `npm test` |
| Full release gate | `npm run verify` |
| Leak scan of the tree | `npm run leak-scan` |
| Regenerate signature preview data | `node tools/update-preview.js` |
| Read a DOM capture | `node tools/read-capture.js <file>` |

## Rules

1. Ask before adding a production dependency, a permission, or a host scope.
2. Never commit credentials, cookies, customer data, DOM captures, or ZIPs.
   Fixtures use invented data only: brands on `*.example`, ids starting `900`,
   addresses on `example.com`. `scripts/leak-scan.mjs` must exit 0 before any
   push.
3. Live Intercom inspection is read-only: read the DOM, console and network;
   never click, type, submit, or run a page script in a live tab. Ask a human to
   reveal a transient menu.
4. For a selector, layout, or language defect, work from a DOM capture before
   changing a selector. For a timing defect, ask for `isaDebug` console output
   too. See [docs/dom-capture.md](docs/dom-capture.md).
5. Anchor selectors on stable attributes (`data-testid`, `data-intercom-target`,
   `aria-label`), never on styled utility classes. Treat a selector change as
   high risk.
6. `src/signatures-data.js` is generated. Regenerate it with
   `node tools/update-preview.js` and commit the result.
7. Every runtime behaviour change gets a focused test, and the test is seen
   failing once against a mutation of the rule it covers.
8. No code comments. See [docs/code-style.md](docs/code-style.md).

## Reference docs

| Doc | Content |
| --- | --- |
| [README.md](README.md) | Overview and case study |
| [docs/architecture.md](docs/architecture.md) | Execution worlds, routing, guards, alerts, notes, resilience |
| [docs/testing.md](docs/testing.md) | Harness, conventions, enforced rules |
| [docs/domain.md](docs/domain.md) | Every source and test file by concern |
| [docs/dom-capture.md](docs/dom-capture.md) | Capturing a live page, format, replay |
| [docs/support-tools.md](docs/support-tools.md) | Workspace, captures, settings backup, debug flags |
| [docs/code-style.md](docs/code-style.md) | No code comments; where rationale goes instead |
| [RELEASE.md](RELEASE.md) | Release procedure |

## What already enforces itself

| Concern | Enforcer |
| --- | --- |
| Which files ship, and the content-script order | `tools/artifact-verifier.js` |
| Version and product name alignment | `tools/release-check.js` |
| Domain map coverage and links | `test/tools/domain-map.test.js` |
| No code comments | `test/tools/code-style.test.js` |
| No real data, secrets, or foreign hosts | `scripts/leak-scan.mjs`, `test/tools/leak-scan.test.js`, CI |
