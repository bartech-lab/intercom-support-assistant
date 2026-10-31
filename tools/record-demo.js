'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fx = require('../test/support/fixtures');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'src');
const OUTPUT = path.join(ROOT, 'docs', 'screenshots', 'demo.gif');
const URL = 'https://app.intercom.com/a/inbox/demo1234/inbox/team/900101/conversation/900475100000101';
const SIZE = { width: 1120, height: 440 };

const STYLE = `<style>
  body { margin: 0; font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2430; background: #f4f5f7; }
  .demo-banner { background: #1a1b20; color: #fff; padding: 10px 20px; font-weight: 600; }
  .demo-banner span { color: #9aa4b2; font-weight: 400; margin-left: 8px; }
  #app { display: grid; grid-template-columns: 1fr 280px; gap: 16px; padding: 16px 20px; }
  [data-intercom-target="conversation-space"] { grid-column: 1; background: #fff; border: 1px solid #e2e6ec; border-radius: 10px; padding: 18px 20px; }
  .email-html-content--inbound { background: #eef2f8; border-radius: 10px; padding: 12px 14px; max-width: 560px; }
  [data-testid="composer-orchestrator"] { grid-column: 1; background: #fff; border: 1px solid #e2e6ec; border-radius: 10px; padding: 12px 16px; }
  .inbox2__composer__container > button { border: 0; border-radius: 6px; padding: 6px 12px; margin: 8px 8px 0 0; background: #eef0f3; font: inherit; }
  .inbox2__composer__container > button:last-child { background: #1d4ed8; color: #fff; float: right; }
  [data-testid="composer-editor-area"] { border: 1px solid #d7dce5; border-radius: 8px; min-height: 120px; padding: 10px 12px; margin-top: 8px; }
  [contenteditable] { outline: none; min-height: 100px; }
  aside { grid-column: 2; grid-row: 1 / span 2; background: #fff; border: 1px solid #e2e6ec; border-radius: 10px; padding: 14px 16px; }
  aside h2 { font-size: 13px; margin: 0 0 10px; color: #5b6472; text-transform: uppercase; letter-spacing: .04em; }
  aside [data-testid] { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; }
  img { width: 18px; height: 18px; vertical-align: -3px; }
  aside img, .inbox2__composer__container svg { display: none; }
  aside button { border: 0; background: none; font: inherit; padding: 0; color: #1d4ed8; }
  .inbox2__composer__container > button:first-child { background: #1a1b20; color: #fff; }
</style>`;

function demoPage() {
  const html = fx.inboxHtml({
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Alderpoint',
      conversationAttrs: [fx.conversationAttrRow('9307', 'Brand', 'Alderpoint')]
    }),
    conversation: fx.conversationSpace({
      customerText: 'Hallo, ich habe meine Bestellung noch nicht bekommen. Können Sie bitte nachsehen, wo das Paket gerade ist? Danke!'
    }),
    composer: fx.composer({ mode: 'email' })
  });
  return html
    .replace('<body>', `<head>${STYLE}</head><body><div class="demo-banner">Invented demo inbox<span>the real extension, loaded unpacked in Chromium</span></div>`);
}

async function record(playwrightModule) {
  const { chromium } = require(playwrightModule);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'isa-demo-'));
  const launch = (video) => chromium.launchPersistentContext(path.join(directory, 'profile'), {
    executablePath: process.env.ISA_CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    viewport: SIZE,
    ...(video ? { recordVideo: { dir: path.join(directory, 'video'), size: SIZE } } : {}),
    args: ['--disable-extensions-except=' + EXTENSION, '--load-extension=' + EXTENSION]
  });
  let context = await launch(false);
  if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
  await context.close();
  context = await launch(true);
  await context.route('**/*', route => (route.request().url().startsWith('https://app.intercom.com/a/inbox/')
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: demoPage() })
    : route.continue()));
  const page = context.pages()[0] || await context.newPage();
  await page.goto(URL);
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.evaluate(node => { node.spellcheck = false; });
  await page.waitForTimeout(1500);
  await editor.click();
  await page.waitForSelector('.isa-draft-language-picker', { timeout: 10000 });
  await page.waitForTimeout(2200);
  for (const code of ['FR', 'NL']) {
    await page.locator('.isa-draft-language-picker > *', { hasText: code }).first().click();
    await page.waitForTimeout(1800);
  }
  const video = await page.video().path();
  await context.close();
  return { directory, video };
}

function toGif(video, output) {
  const palette = path.join(path.dirname(video), 'palette.png');
  const filters = 'fps=12,scale=960:-1:flags=lanczos';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', palette, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', output]);
}

async function main() {
  const playwrightModule = process.env.ISA_PLAYWRIGHT_MODULE;
  if (!playwrightModule) {
    console.error('Set ISA_PLAYWRIGHT_MODULE to a playwright-core entry file.');
    process.exit(2);
  }
  const { directory, video } = await record(playwrightModule);
  toGif(video, OUTPUT);
  await fs.rm(directory, { recursive: true, force: true });
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
