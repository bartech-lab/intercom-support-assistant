'use strict';

const fs = require('fs');
const path = require('path');
const { readCapture, hydrateShadowRoots, loadCapture } = require('../test/support/helpers');

const CONTEXT_META_ID = 'isa-capture-context';

const USAGE = `Usage:
  node tools/read-capture.js <capture.html>
  node tools/read-capture.js <capture.html> --selector "<css>" [--limit N] [--index N]
  node tools/read-capture.js <capture.html> --context [--json]
  node tools/read-capture.js <capture.html> --teams

Reads a capture produced by the Download button in the workspace Captures card.
Prints the metadata header, the shadow root inventory, and the anchor health
report resolved against the capture. With --selector, prints matching subtrees as
fixture-ready HTML. With --context, prints the build, the health check, your
settings, the storage keys, and what the install carries. With --teams, prints
every Intercom team id and name the page loaded at boot, one per line.`;

function parseArgs(argv) {
  const args = { file: null, selector: null, limit: 4000, index: null, context: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--selector') args.selector = argv[++i];
    else if (value === '--limit') args.limit = Number(argv[++i]);
    else if (value === '--index') args.index = Number(argv[++i]);
    else if (value === '--context') args.context = true;
    else if (value === '--json') args.json = true;
    else if (value === '--teams') args.teams = true;
    else if (!args.file) args.file = value;
  }
  return args;
}

function readContextBlock(file) {
  const html = fs.readFileSync(file, 'utf8');
  const pattern = new RegExp(`<script[^>]*id="${CONTEXT_META_ID}"[^>]*>([\\s\\S]*?)</script>`, 'i');
  const match = pattern.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1].replace(/\\u003c/g, '<'));
  } catch (error) {
    return null;
  }
}

function printContextHeader(context) {
  const health = context.health || {};
  const browser = health.browser || {};
  console.log(`  schema: ${context.schema}`);
  console.log(`  generatedAt: ${context.generatedAt}`);
  console.log(`  extension: ${context.extensionVersion || 'unknown'}`);
  console.log(`  chrome: ${browser.chromeVersion || 'unknown'}`);
  console.log(`  notifications: ${health.notificationLevel || 'unknown'}`);
  if (context.healthError) console.log(`  healthError: ${context.healthError}`);
}

function printContextTabs(context) {
  const health = context.health || {};
  const tabs = Array.isArray(health.tabs) ? health.tabs : [];
  if (health.tabsError) console.log(`Tabs error: ${health.tabsError}`);
  console.log(`Tabs (${tabs.length}):`);
  tabs.forEach((tab) => {
    const state = tab.injected ? 'loaded' : `not-loaded (${tab.notInjected ? 'needs reload' : tab.error || 'no reply'})`;
    console.log(`  ${state} ${tab.active ? '[active] ' : ''}${tab.url || '(no url)'}`);
  });
}

function printContextSettings(context) {
  const settings = context.settings || {};
  const keys = Object.keys(settings).sort();
  console.log(`Settings (${keys.length}):`);
  keys.forEach((key) => {
    const value = settings[key];
    console.log(`  ${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : String(value)}`);
  });
}

function printContextStorage(context) {
  const storage = context.storage || {};
  const local = storage.local || {};
  const session = storage.session || {};
  if (storage.localError) console.log(`Local storage error: ${storage.localError}`);
  if (storage.sessionError) console.log(`Session storage error: ${storage.sessionError}`);
  console.log(`Local storage keys (${Object.keys(local).length}): ${Object.keys(local).sort().join(', ') || 'none'}`);
  console.log(`Session storage keys (${Object.keys(session).length}): ${Object.keys(session).sort().join(', ') || 'none'}`);
}

function printContextCoverage(context) {
  const coverage = context.coverage || {};
  if (!coverage.available) {
    console.log('Coverage: signature data was not loaded in that workspace tab.');
    return;
  }
  console.log('Coverage:');
  console.log(`  brands: ${coverage.companyCount}`);
  console.log(`  team signature inboxes: ${(coverage.teamSignatureInboxes || []).join(', ') || 'none'}`);
  console.log(`  alert roster: ${coverage.alertRoster.length}`);
  console.log(`  promotional banners: ${coverage.promotionalBanners.join(', ') || 'none'}`);
  console.log(`  ${coverage.companies.join(', ')}`);
}

function printContext(context) {
  printContextHeader(context);
  printContextTabs(context);
  printContextSettings(context);
  printContextStorage(context);
  printContextCoverage(context);
}

function collectRoots(document) {
  const roots = [document];
  const walk = (root) => {
    root.querySelectorAll('*').forEach((element) => {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
        walk(element.shadowRoot);
      }
    });
  };
  walk(document);
  return roots;
}

function describeRoot(root) {
  if (root.nodeType === 9) return 'document';
  const host = root.host;
  const id = host.id ? `#${host.id}` : '';
  return `shadowRoot of <${host.tagName.toLowerCase()}${id}>`;
}

function queryAllRoots(roots, selector) {
  const matches = [];
  roots.forEach((root) => {
    root.querySelectorAll(selector).forEach(element => matches.push({ root, element }));
  });
  return matches;
}

function printOverview(file, meta, document, roots) {
  console.log(`Capture: ${path.basename(file)}`);
  if (meta) {
    console.log(`  surface:        ${meta.surface}`);
    console.log(`  url:            ${meta.url}`);
    console.log(`  conversationId: ${meta.conversationId || '(none)'}`);
    console.log(`  view:           ${meta.view || '(none)'}`);
    console.log(`  extension:      ${meta.extensionVersion || 'unknown'}`);
    console.log(`  capturedAt:     ${meta.capturedAt}`);
    const teamCount = meta.teamDirectory && Array.isArray(meta.teamDirectory.teams) ? meta.teamDirectory.teams.length : 0;
    if (meta.surface === 'intercom') console.log(`  teams:          ${teamCount ? `${teamCount}, list them with --teams` : 'none (reload the tab before capturing)'}`);
  } else {
    console.log('  no metadata header found');
  }

  console.log('');
  console.log(`Roots (${roots.length}):`);
  roots.forEach((root) => {
    console.log(`  ${describeRoot(root)} - ${root.querySelectorAll('*').length} elements`);
  });
}

function printAnchorReport(report, meta) {
  if (!report || !report.ok) {
    console.log('');
    console.log('Anchor report could not be built from this capture.');
    return;
  }

  console.log('');
  console.log(`Anchors resolved against the capture (view: ${report.view}, shadow root: ${report.shadowRootPresent ? 'yes' : 'no'}):`);
  report.anchors.forEach((anchor) => {
    const total = anchor.selectors.reduce((sum, entry) => sum + entry.count, 0);
    console.log(`  ${anchor.status.padEnd(8)} ${anchor.id} (${total})`);
    if (anchor.status === 'missing') {
      anchor.selectors.forEach((entry) => {
        console.log(`      ${entry.count === 0 ? 'x' : entry.count} ${entry.key}: ${entry.selector}`);
      });
    }
  });

  const captured = meta && meta.anchorHealth && meta.anchorHealth.summary;
  if (!captured) return;

  const now = report.summary;
  const agrees = captured.missing === now.missing && captured.ok === now.ok;
  console.log('');
  console.log(`Header said ok ${captured.ok}, missing ${captured.missing}. Replay says ok ${now.ok}, missing ${now.missing}.`);
  console.log(agrees ? 'Replay agrees with the capture header.' : 'Replay DISAGREES with the capture header.');
}

function printSelector(roots, selector, limit, index) {
  const matches = queryAllRoots(roots, selector);
  console.log('');
  console.log(`Selector ${selector}: ${matches.length} match${matches.length === 1 ? '' : 'es'}`);

  matches.forEach((match, position) => {
    if (index !== null && position !== index) return;
    const html = match.element.outerHTML;
    console.log('');
    console.log(`[${position}] in ${describeRoot(match.root)} (${html.length} chars)`);
    console.log(html.length > limit ? `${html.slice(0, limit)}\n... truncated, raise --limit` : html);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.log(USAGE);
    process.exit(1);
  }

  if (args.context) {
    const context = readContextBlock(args.file);
    if (!context) {
      console.log(`No ${CONTEXT_META_ID} block found in ${args.file}.`);
      process.exit(1);
    }
    if (args.json) console.log(JSON.stringify(context, null, 2));
    else printContext(context);
    return;
  }

  const { meta } = readCapture(args.file);
  if (args.teams) {
    const directory = meta && meta.teamDirectory;
    if (!directory || !Array.isArray(directory.teams) || !directory.teams.length) {
      console.log('No team list in this capture. Reload the Intercom tab, then capture again: Intercom sends the list only when the page loads.');
      process.exit(1);
    }
    console.log(`# ${directory.teams.length} teams, loaded ${directory.observedAt}`);
    [...directory.teams].sort((a, b) => a.name.localeCompare(b.name)).forEach(team => console.log(`${team.id}\t${team.name}`));
    return;
  }
  const { window } = loadCapture(args.file);
  try {
    hydrateShadowRoots(window.document);
    const roots = collectRoots(window.document);

    printOverview(args.file, meta, window.document, roots);

    if (args.selector) {
      printSelector(roots, args.selector, args.limit, args.index);
      return;
    }

    printAnchorReport(window.buildAnchorHealthReport(), meta);

    if (readContextBlock(args.file)) {
      console.log('\nThis capture carries a context block. Read it with --context.');
    }
  } finally {
    window.close();
  }
}

main();
