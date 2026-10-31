# Workspace and support tools

## Popup and workspace

The popup has three buttons, **Open signatures**, **Settings**, and **Tools**,
plus a **Quick alerts** switch with a summary of the watched inboxes. Each button
opens one shared workspace tab at the chosen section; a second click reuses that
tab. Direct links work too: `#signatures`, `#settings`, `#tools`.

- **Signatures** previews every brand signature and the team signature in all
  seven languages, with search and a copy button that writes rich text and plain
  text.
- **Settings** holds the new-message alerts: the master switch, which inboxes to
  watch, **Your inbox**, the sound, and a test button.
- **Tools** holds the three cards below.

Switching sections keeps search text, language tabs, and scroll positions.
Browser Back and Forward move between sections, and hidden sections never take
keyboard focus.

After editing `src/intercom-config.js`, run `node tools/update-preview.js` to
regenerate `src/signatures-data.js`, then reload the extension.

The tools load only in `src/preview-page.html`. None is a content script and none
adds a permission; `test/tools/packaging.test.js` guards both.

## Captures

1. Expand **Captures** and click **Check and list tabs**. The card prints the
   build, the Chrome version, the notification permission, and one row per open
   Intercom tab.
2. Click **Download** on a row.

Every download runs the health check first, so the file always carries a fresh
one. The context block, `#isa-capture-context`, is inserted after `<head>`:

```html
<script type="application/json" id="isa-capture-context">
{ "schema": 1, "generatedAt": "...", "extensionVersion": "...",
  "health": { "extension": {...}, "browser": {...}, "notificationLevel": "...", "tabs": [...] },
  "storage": { "local": {...}, "session": {...} },
  "settings": {...}, "coverage": {...}, "capture": {...} }
</script>
```

`coverage` comes from the signature data the installed build ships, which
answers "works for me, not for them" when a teammate runs an older build. Read
the block with `node tools/read-capture.js <file> --context`. The DOM part is
described in [dom-capture.md](dom-capture.md).

## Settings backup

**Export settings** writes `isa-settings-<version>-<YYYYMMDD-HHMM>.json`:

```json
{ "schema": 1, "extensionVersion": "...", "exportedAt": "...",
  "skippedKeys": [], "settings": { "isaAlertEnabled": true } }
```

Only the keys in `BACKUP_KEYS` (`src/support-tools-ui.js`) are exported. The
alert roster and the per-inbox last-seen counts are deliberately left out: the
roster is rediscovered from the live Inbox, and restoring a stale baseline would
change which alerts fire.

**Import settings** merges the file over current storage and never clears it
first, because an interrupted clear would leave no settings at all. A higher
`schema`, an unknown key, and a value of the wrong type are each refused and
named in the card. Reload open Intercom tabs after an import.

## Debug flags

| Flag | Key | Effect |
| --- | --- | --- |
| Verbose logging | `isaDebug` | Logs selector, language, and routing decisions to the page console. |
| Alert logging | `isaAlertDebug` | Logs every alert decision; turn it on before reproducing an unexpected chime. |
| Pause note cleanup | `isaPauseAutomaticNoteCleanup` | Stops expired-note deletion in this browser only. |

Each checkbox writes one key and rolls back if the write fails. Open Intercom
tabs apply a change without a reload.
