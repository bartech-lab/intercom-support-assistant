'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fx = require('../support/fixtures');
const { inboxUrl, TAMSIN, MERROW, row } = require('../support/duplicate-conversations-harness');

const EXTENSION = process.env.ISA_HOVER_EXTENSION || path.join(__dirname, '..', '..', 'src');

const HOVER_SCRIPT = `<script>
document.addEventListener('mouseover', (event) => {
  const link = event.target.closest && event.target.closest('a[data-conversation-id]');
  if (link && !link.querySelector('.fixture-hover-actions')) {
    const actions = document.createElement('span');
    actions.className = 'fixture-hover-actions';
    actions.textContent = 'Snooze Close';
    link.appendChild(actions);
  }
});
document.addEventListener('mouseout', (event) => {
  const link = event.target.closest && event.target.closest('a[data-conversation-id]');
  if (link && !link.contains(event.relatedTarget)) link.querySelectorAll('.fixture-hover-actions').forEach(node => node.remove());
});
</script>`;

function inboxPage() {
  const html = fx.inboxHtml({
    list: fx.conversationList([row('1', TAMSIN), row('2', TAMSIN), row('3', MERROW), row('4', MERROW)], { state: 'Open', count: '27' }),
    composer: fx.composer({ mode: 'email' })
  });
  return html.replace('</body>', HOVER_SCRIPT + '</body>');
}

function dismissReloadNotice() {
  document.getElementById('isa-signature-reload-notice')?.remove();
}

function recordDecorationChurn() {
  const ours = value => /(^|\s)isa-/.test(value || '');
  const classesOf = value => (value || '').split(/\s+/).filter(name => name.startsWith('isa-')).sort().join(' ');
  const isOwnNode = node => node.nodeType === 1 && node.id !== 'isa-signature-reload-notice' && (ours(node.className) || ours(node.id) || [...node.attributes].some(attr => attr.name.startsWith('data-isa')));
  window.__isaChurn = [];
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'childList') {
        [...record.addedNodes, ...record.removedNodes].filter(isOwnNode)
          .forEach(node => window.__isaChurn.push(`${record.type} ${node.className}`));
      } else if (record.type === 'attributes' && record.attributeName.startsWith('data-isa')) {
        window.__isaChurn.push(`attr ${record.attributeName}`);
      } else if (record.type === 'attributes' && record.attributeName === 'class'
        && classesOf(record.oldValue) !== classesOf(record.target.getAttribute('class'))) {
        window.__isaChurn.push(`class ${record.oldValue} -> ${record.target.getAttribute('class')}`);
      } else if (record.type === 'attributes' && record.attributeName === 'class'
        && ours(record.oldValue)) {
        window.__isaChurn.push(`class rewrite ${record.oldValue}`);
      }
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true });
}

test('hovering decorated Intercom rows in Chromium never rebuilds or flashes a decoration', { skip: !process.env.ISA_PLAYWRIGHT_MODULE, timeout: 60000 }, async () => {
  const { chromium } = require(process.env.ISA_PLAYWRIGHT_MODULE);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'isa-hover-chromium-'));
  let context;
  try {
    const launch = () => chromium.launchPersistentContext(path.join(directory, 'profile'), {
      executablePath: process.env.ISA_CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true,
      args: ['--disable-extensions-except=' + EXTENSION, '--load-extension=' + EXTENSION]
    });
    context = await launch();
    if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
    await context.close();
    context = await launch();
    await context.route('**/*', route => (route.request().url().startsWith('https://app.intercom.com/a/inbox/')
      ? route.fulfill({ status: 200, contentType: 'text/html', body: inboxPage() })
      : route.fulfill({ status: 204, body: '' })));
    if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const decorated = () => page.waitForFunction(() => document.querySelectorAll('.isa-duplicate-customer-chip').length === 4, null, { timeout: 15000 });
    await page.goto(inboxUrl);
    await decorated();
    await page.evaluate(dismissReloadNotice);
    await page.hover('a[data-conversation-id="4"]');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1500);

    await page.evaluate(recordDecorationChurn);
    for (const id of ['1', '2', '3', '4', '1']) {
      await page.evaluate(dismissReloadNotice);
      await page.hover(`a[data-conversation-id="${id}"]`);
      await page.waitForTimeout(150);
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(2000);

    const hovered = await page.evaluate(() => document.querySelectorAll('.fixture-hover-actions').length);
    const churn = await page.evaluate(() => window.__isaChurn);
    assert.equal(hovered, 0, 'the fixture saw the hover end');
    assert.deepEqual(churn, []);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.isa-duplicate-customer-chip').length), 4);
  } finally {
    if (context) await context.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
