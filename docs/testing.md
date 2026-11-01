# Testing

```bash
npm ci
npm test          # 2,200+ tests, about 15 s on one laptop
npm run verify    # the full release gate, see RELEASE.md
```

The suite uses the Node test runner and jsdom, and nothing else. There is no
test framework, no bundler, and no browser in the default run.

## The harness loads the real scripts

`test/support/helpers.js` reads `src/manifest.json`, takes the isolated
content-script list in its declared order, and runs each real file from `src/`
inside a jsdom window with `vm`. A test therefore exercises the shipped code,
including the load-order coupling between classic scripts. A file moved to the
wrong position in the manifest fails the suite.

| Helper | Loads |
| --- | --- |
| `loadExtension(html, options)` | every isolated Intercom script, in manifest order, against the given page |
| `loadIntercomPageHook(options)` | the MAIN-world hook, with a scripted `fetch` and a recorded `postMessage` |
| `loadBackground(options)` in `test/support/background-harness.js` | the service worker against a recording `chrome` stub |
| `loadPreview(html)` | the workspace page scripts |
| `loadCapture(path)` | a saved DOM capture, with its shadow roots rehydrated |

Page markup comes from builders in `test/support/fixtures.js` that mirror the
attributes Intercom renders. The builders were distilled from DOM captures of
the live Inbox (see [dom-capture.md](dom-capture.md)); the captures themselves
held customer data and were never committed.

All fixture data is invented: brands on `*.example`, ids in the `900…` range,
addresses on `example.com`.

## What the tests are written against

Tests are derived from failure modes rather than from the code: a boundary, the
second item, a value arriving out of order, a dependency that fails half way.
Some patterns that recur:

- **Fail-closed cases.** Conflicting brand signals insert no signature; an
  unreadable badge is not zero; a malformed note marker is never deleted.
- **Order and freshness.** Stream parts out of array order, a newer invalid
  value next to an older valid one, a sidebar that still shows the previous
  conversation.
- **Idempotence.** A second observer pass over a decorated page changes
  nothing, because each write is a mutation that would loop.
- **Bounds.** Bridge caches are filled one past their cap and checked for the
  evicted entry; payload limits are tested at the limit and one over it.
- **Parity across the world boundary.** The MAIN-world hook cannot import the
  shared note module, so a table-driven test runs the same lifetime vectors
  through both copies.

Files named `*.characterization.test.js` pin current behaviour before a
refactor; they describe what the code does, not what it should do.

### Every new test is seen failing once

A test that has never failed proves little. The working rule: run a new or
rewritten test against a one-line mutation of the rule it covers (a flipped
comparison, a removed allowance, a raised cap), and keep it only once it fails
there.

## Repository rules enforced as tests

| Rule | Test |
| --- | --- |
| No code comments in `src/`, `tools/`, `test/` | `test/tools/code-style.test.js` |
| Every runtime and test file is mapped in [domain.md](domain.md), and its links resolve | `test/tools/domain-map.test.js` |
| The build ships only Intercom, with no host outside the allowlist | `test/tools/packaging.test.js` |
| The leak scanner catches each planted secret, id, address and listed term | `test/tools/leak-scan.test.js` |
| Version and product name agree across manifest, popup, README and changelog | `test/tools/release-check.test.js` |

## Runtime test

`test/ui/hover-chromium.test.js` loads the unpacked extension in Chromium and
checks that hovering decorated rows never rebuilds a decoration. It is skipped
unless `ISA_PLAYWRIGHT_MODULE` points at a `playwright-core` entry file:

```bash
ISA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js npm run test:runtime
```

The README demo GIF is recorded the same way, with Chromium and `ffmpeg`:

```bash
ISA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js node tools/record-demo.js
```

## What is not covered

- The live Inbox. Fixtures follow captured markup, but Intercom can change it
  at any deploy; the anchor health report exists to make that visible.
- The internal note delete route against a real workspace in CI. It is covered
  by request-level tests only.
- Visual layout beyond the hover test. Row geometry is asserted as numbers, not
  as pixels.
