'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXTENSION = path.join(__dirname, '..', '..', 'src');
const WORKSPACE = 'demo1234';
const CONTACT = '9007c24da170bbadc8e2598d';
const URL = `https://app.intercom.com/a/inbox/${WORKSPACE}/inbox/team/1/conversation/900401386132981`;
const NOTE_UUID = 'aaaabbbb-cccc-4ddd-8eee-ffff0000aaaa';
const EXPIRES = '2027-09-09T07:55:12.120Z';
const FOOTER = `Auto-delete after: 2027-09-09 07:55 UTC\n[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT};expires=${EXPIRES};token=${NOTE_UUID}]`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font:13px system-ui">
  <main style="height:300px">conversation</main>
  <aside data-test-conversation-details-sidebar="true" style="width:340px;background:#fff">
    <a data-test-user-profile-link="true" href="/a/apps/${WORKSPACE}/users/${CONTACT}">Customer</a>
    <div data-test-sidebar-section-item="notes" data-sidebar-section-id="notes"><div data-testid="notes-section">
      <div><textarea data-testid="note-input" placeholder="Add a note" aria-label="Add a note"></textarea></div>
      <div data-testid="note-501"><div data-testid="note-body"><p>temporary text</p><p>Auto-delete after: 2027-09-09 07:55 UTC<br>
[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT};expires=${EXPIRES};token=${NOTE_UUID}]</p></div></div>
      <div data-testid="note-502"><div data-testid="note-body"><p>plain text</p></div></div>
    </div></div>
  </aside>
  <button data-test-conversation-details-sidebar-collapse-button="true" aria-label="Hide right menu"></button>
  <div data-base-ui-portal><div role="presentation" class="pointer-events-auto" style="position:fixed;left:20px;top:20px;pointer-events:auto">
    <div role="tooltip" data-testid="tooltip-content" style="width:200px;height:30px;background:#333;color:#fff">Edited by Agent</div></div></div>
</body></html>`;

const SKIP = !process.env.ISA_PLAYWRIGHT_MODULE;

test.describe('Intercom notes with the real extension in Chromium', { skip: SKIP }, () => {
  let context = null;
  let profile = null;
  let page = null;
  let server = null;

  test.before(async () => {
    const { chromium } = require(process.env.ISA_PLAYWRIGHT_MODULE);
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'isa-notes-'));
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.ISA_CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true,
      viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
    });
    const warmUp = await context.newPage();
    await warmUp.route('**/*', route => (route.request().url() === URL
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }) : route.abort()));
    await warmUp.goto(URL, { waitUntil: 'load' });
    await warmUp.waitForTimeout(1000);
    await warmUp.close();
  });

  test.after(async () => {
    if (context) await context.close();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    server = { bodies: { 501: `server text\n\n${FOOTER}`, 502: 'plain server text' }, puts: [] };
    page = await context.newPage();
    await page.route('**/*', (route) => {
      const request = route.request();
      const target = request.url();
      if (target.startsWith('chrome-extension://')) return route.continue();
      if (target === URL) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
      if (!target.includes('/ember/inbox/notes')) return route.abort();
      const id = (/notes\/(\d+)/.exec(target) || /ids%5B%5D=(\d+)/.exec(target) || [])[1];
      if (request.method() === 'PUT') {
        server.bodies[id] = JSON.parse(request.postData()).body;
        server.puts.push({ id, body: server.bodies[id] });
      }
      const note = { id: Number(id), body: server.bodies[id], created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(request.method() === 'PUT' ? note : [note]) });
    });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForSelector('.isa-temporary-note-controls');
    await page.waitForSelector('.isa-temporary-note-chip');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-isa-signature-reload-blocked')), false,
      'the page must not carry the reload-required guard that follows an install');
  });

  test.afterEach(async () => {
    if (page) await page.close();
    page = null;
  });

  const countFocusLoss = () => page.evaluate(() => {
    window.__focusLoss = 0;
    document.querySelector('aside').addEventListener('focusout', (event) => {
      if (event.target.matches('textarea[data-testid="note-input"]')) window.__focusLoss += 1;
    });
  });
  const focusLoss = () => page.evaluate(() => window.__focusLoss);

  test('typing a note and then clicking the words Auto-delete never hands the page a focus loss', async () => {
    await page.click('textarea[data-testid="note-input"]');
    await page.keyboard.type('new note');
    await countFocusLoss();
    const label = await page.locator('.isa-temporary-note-controls label').first().boundingBox();
    await page.mouse.click(label.x + 45, label.y + label.height / 2);
    assert.equal(await page.isChecked('.isa-temporary-note-controls input[aria-label="Auto-delete"]'), true);
    assert.equal(await focusLoss(), 0);
    await page.click('.isa-temporary-note-controls [role="combobox"]');
    await page.keyboard.press('Escape');
    assert.equal(await focusLoss(), 0, 'opening the dropdown does not either');
  });

  test('Save note hands the page exactly one focus loss from the note box', async () => {
    await page.click('textarea[data-testid="note-input"]');
    await page.keyboard.type('new note');
    await page.check('.isa-temporary-note-controls input[aria-label="Auto-delete"]');
    await countFocusLoss();
    await page.click('.isa-temporary-note-save');
    assert.equal(await focusLoss(), 1);
  });

  test('the expiry line opens the change panel, and a new date is saved with the server text and the same token', async () => {
    await page.click('[data-testid="note-501"] .isa-temporary-note-chip');
    const layer = page.locator('.isa-temporary-note-expiry-editor');
    await layer.locator('input[aria-label="Auto-delete date as DD/MM/YYYY"]').fill('');
    await layer.locator('input[aria-label="Auto-delete date as DD/MM/YYYY"]').pressSequentially('2512' + '2027');
    await layer.locator('input[aria-label="Auto-delete time, 24-hour clock"]').fill('');
    await layer.locator('input[aria-label="Auto-delete time, 24-hour clock"]').pressSequentially('1830');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.isa-temporary-note-expiry-editor'));
    assert.equal(server.puts.length, 1);
    const expected = new Date(2027, 11, 25, 18, 30).toISOString();
    assert.equal(server.puts[0].body, `server text\n\nAuto-delete after: ${expected.slice(0, 16).replace('T', ' ')} UTC\n[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT};expires=${expected};token=${NOTE_UUID}]`);
    assert.equal(await page.textContent('[data-testid="note-501"] .isa-temporary-note-chip'), `Expires ${expected.slice(0, 16).replace('T', ' ')} UTC`);
  });

  test('an edit box hides the technical lines after the page hook confirms, and a page save gets them back', async () => {
    const result = await page.evaluate(async ({ text, workspace }) => {
      const card = document.querySelector('[data-testid="note-501"]');
      const box = document.createElement('div');
      const textarea = document.createElement('textarea');
      textarea.setAttribute('aria-label', 'Edit note');
      box.append(textarea);
      card.append(box);
      textarea.value = text;
      await new Promise(resolve => setTimeout(resolve, 1000));
      const shown = textarea.value;
      const response = await fetch(`/ember/inbox/notes/501?app_id=${workspace}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: `${shown} edited`, app_id: workspace })
      });
      return { shown, line: box.querySelector('.isa-temporary-note-chip')?.textContent || null, saved: (await response.json()).body };
    }, { text: `server text\n\n${FOOTER}`, workspace: WORKSPACE });
    assert.equal(result.shown, 'server text');
    assert.equal(result.line, 'Expires 2027-09-09 07:55 UTC');
    assert.equal(result.saved, `server text edited\n\n${FOOTER}`);
  });

  test('a note without auto-delete can be given one from its "+ Auto-delete" line', async () => {
    await page.click('[data-testid="note-502"] .isa-temporary-note-add');
    await page.locator('.isa-temporary-note-expiry-editor button', { hasText: 'Save' }).click();
    await page.waitForFunction(() => !document.querySelector('.isa-temporary-note-expiry-editor'));
    assert.equal(server.puts.length, 1);
    assert.match(server.puts[0].body, new RegExp(`^plain server text\\n\\nAuto-delete after: [0-9: -]+ UTC\\n\\[ISA-AUTO-DELETE:v1;workspace=${WORKSPACE};contact=${CONTACT};expires=[0-9T:.-]+Z;token=[0-9a-f-]{36}\\]$`));
    assert.match(await page.textContent('[data-testid="note-502"] .isa-temporary-note-chip'), /^Expires /);
  });

  test('the host tooltip layer does not take clicks', async () => {
    const takesClick = await page.evaluate(() => {
      const tip = document.querySelector('[role="tooltip"][data-testid="tooltip-content"]');
      const rect = tip.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + 10, rect.top + 10);
      return tip.contains(hit) || hit === tip.parentElement;
    });
    assert.equal(takesClick, false);
  });
});
