# DOM capture

A capture is a full serialized copy of a live Intercom tab. It is the default
evidence for a selector, language-detection, or layout defect.

## Why it exists

Every fixture in `test/` is hand-written HTML. When the fixture and the live
page disagree, the tests pass and the extension breaks. Two real defects were
exactly that: a sidebar anchor that matched nothing in the live page, and a
renamed note-body class that silently disabled the close guard.

A capture settles that class of question in one read.

## Capture

1. Open the workspace **Tools** section and expand **Captures**.
2. Click **Check and list tabs**. Every open Intercom tab is listed.
3. Click **Download** on the row you want.

The file is named `<surface>-<stamp>-<id>.html`, so captures sort by time. Keep
it in `scratchpad/`, which is git-ignored, because it holds customer data.

A row that reports `not loaded: reload this tab` was opened before the current
build. Reload the tab and capture again.

## Format

One `.html` file. The first element in `<head>` is a metadata header:

```html
<script type="application/json" id="isa-capture-meta">
{ "surface": "intercom", "url": "...", "conversationId": "...", "view": "conversation",
  "extensionVersion": "...", "capturedAt": "...", "anchorHealth": { ... },
  "teamDirectory": { "observedAt": "...", "teams": [ { "id": "...", "name": "..." } ] },
  "ownElements": [ ... ] }
</script>
```

Every `<` inside the block is escaped as `<`, so page text cannot close the
script tag.

**Open shadow roots are inlined** as `<template shadowrootmode="open">`. Parts of
the Inbox render inside the shadow root of `#teammate-app-react`, and
`outerHTML` does not serialize shadow content. `test/capture/dom-capture.test.js`
asserts that plain `outerHTML` lacks content the capture contains, so the test
fails if the serializer regresses to a plain dump.

Nodes the extension added (`data-isa-own`) are dropped from the tree, and
`data-isa-*` attributes and `isa-*` classes are stripped, so the tree is
Intercom's markup only. `meta.ownElements` lists what was dropped, with tag,
rounded position, computed display, and the first 160 characters of text, so a
misplaced overlay of ours is still visible.

`meta.anchorHealth` is the report from `buildAnchorHealthReport()`. Its
`truncatedPanels` entry records, per sidebar panel, whether **See all** is
present and whether each field the extension reads was rendered. A field marked
`hiddenBehindSeeAll` is set but not in the DOM; never read a missing row as an
unset attribute.

`meta.teamDirectory` holds every team id and name from the assignees response
Intercom sends on page load. It is `null` when the tab was opened before the
extension loaded.

The workspace adds a second block, `#isa-capture-context`, with the build, a
health check, your settings and what the install ships. See
[support-tools.md](support-tools.md).

## Read a capture

```bash
node tools/read-capture.js <file>
node tools/read-capture.js <file> --selector '[data-testid="conversation-stream-scroll-container"]'
node tools/read-capture.js <file> --teams
node tools/read-capture.js <file> --context [--json]
```

With no option it prints the header, the shadow-root inventory, and the anchor
health report re-run against the capture, then compares it with the report in
the header. A capture taken mid-render disagrees with its own header, which is
how you know not to trust it. `--selector` prints matching subtrees as
fixture-ready HTML, searching the document and every shadow root.

## Replay

`loadCapture(path)` in `test/support/helpers.js` reads a capture, rehydrates its
shadow roots with `attachShadow` (jsdom does not parse declarative shadow DOM),
and runs the real `src/` scripts against it.

## A capture is not done until a fixture is committed

Distil what the capture proved into the builders in `test/support/fixtures.js`,
with invented data, and commit that. Then delete the capture. Otherwise the same
DOM fact is rediscovered on the next bug.

## What a capture cannot tell you

A capture is the settled DOM. It cannot reproduce a race: a defect that signs
in French on a warm navigation and in English on a cold load replays as French
from both captures.

For a timing question, turn on verbose logging:

```js
chrome.storage.local.set({ isaDebug: true });
```

It applies to every open tab at once, with no reload, and logs each observer
pass. Send the console output with the capture.
