'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fx = require('../test/support/fixtures');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'src');
const OUTPUT = path.join(ROOT, 'docs', 'screenshots', 'demo.gif');
const TEAM = '900101';
const ITALIAN = '900475100000101';
const GERMAN = '900475100038417';
const CONVERSATIONS = {
  [ITALIAN]: {
    name: 'Marco Bellini',
    subject: 'Taglia sbagliata',
    time: '10:39',
    location: 'Bologna, Italy',
    text: 'Buongiorno, ho ricevuto la giacca nella taglia sbagliata. Posso cambiarla con una M? Grazie mille.'
  },
  [GERMAN]: {
    name: 'Lena Hofmann',
    subject: 'Where is my parcel?',
    time: '10:42',
    location: 'Freiburg, Germany',
    text: 'Hallo, ich habe meine Bestellung noch nicht bekommen. Können Sie bitte nachsehen, wo das Paket gerade ist? Danke!'
  }
};
const conversationUrl = (id) => `https://app.intercom.com/a/inbox/demo1234/inbox/team/${TEAM}/conversation/${id}`;
const SIZE = { width: 1600, height: 900 };
const GIF_WIDTH = 1280;

const style = (id) => `<style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: grid; grid-template-columns: 230px 330px 1fr; grid-template-rows: 44px 1fr;
    font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2430; background: #fff; overflow: hidden; }
  .demo-bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 0 18px; background: #1a1b20; color: #fff; font-weight: 600; }
  .demo-bar span { color: #9aa4b2; font-weight: 400; font-size: 13px; }
  .demo-bar strong { margin-left: auto; color: #fff; font-size: 15px; font-weight: 600; }
  nav { grid-row: 2; background: #f6f6f8; border-right: 1px solid #e6e8ec; padding: 14px 10px; }
  nav::before { content: "Inbox"; display: block; font-size: 18px; font-weight: 700; padding: 0 8px 12px; }
  nav a { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 8px; color: #1f2430; text-decoration: none; }
  nav a[href*="${TEAM}"] { background: #e7ebf3; font-weight: 600; }
  nav .count { font-size: 12px; color: #5b6472; }
  nav [data-intercom-target="your-inbox"] .inbox2__avatar { display: none; }
  .list { grid-row: 2; border-right: 1px solid #e6e8ec; overflow: hidden; }
  [data-intercom-target="filter-button"] { padding: 14px 16px 10px; border-bottom: 1px solid #eef0f3; }
  [data-intercom-target="filter-button"] button { border: 0; background: none; font: inherit; font-weight: 600; padding: 0; }
  [data-intercom-target-conversation-list] > a { display: flex; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #f0f1f4; color: inherit; text-decoration: none; }
  [data-intercom-target-conversation-list] > a[data-conversation-id="${id}"] { background: #eef3ff; box-shadow: inset 3px 0 0 #1d4ed8; }
  .inbox2__avatar { width: 30px; height: 30px; border-radius: 50%; background: #dfe5f1; color: #33415c; display: grid; place-items: center; font-weight: 600; font-size: 13px; }
  [data-intercom-target-conversation-list] .flex-col { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  [data-intercom-target-conversation-list] .flex-row { display: flex; align-items: center; }
  [data-intercom-target-conversation-list] .line-clamp-1, [data-intercom-target-conversation-list] .line-clamp-2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #5b6472; font-size: 13px; }
  [data-intercom-target-conversation-list] .text-right { font-size: 12px; color: #8a93a3; text-align: right; }
  #app { grid-row: 2; display: grid; grid-template-columns: 1fr 300px; grid-template-rows: auto 1fr auto; min-height: 0; }
  #app::before { content: "${CONVERSATIONS[id].subject}"; grid-column: 1; padding: 14px 24px; border-bottom: 1px solid #eef0f3; font-size: 16px; font-weight: 700; }
  [data-intercom-target="conversation-space"] { grid-column: 1; padding: 22px 24px; background: #fafbfc; overflow: hidden; }
  .email-html-content--inbound { background: #fff; border: 1px solid #e6e8ec; border-radius: 12px; padding: 14px 16px; max-width: 620px; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
  .email-html-content--inbound::before { content: "${CONVERSATIONS[id].name} · Email · ${CONVERSATIONS[id].time}"; display: block; font-size: 12px; color: #8a93a3; margin-bottom: 6px; }
  .demo-sent { margin: 16px 0 0 auto; max-width: 620px; background: #eef3ff; border: 1px solid #d6e0fb; border-radius: 12px; padding: 14px 16px; }
  .demo-sent::before { content: "Maya Lindqvist · Email · 10:47 · Sent"; display: block; font-size: 12px; color: #5b6472; margin-bottom: 6px; }
  .demo-sent p { margin: 0; min-height: 1.45em; }
  [data-testid="composer-orchestrator"] { grid-column: 1; border-top: 1px solid #e6e8ec; padding: 12px 24px 16px; background: #fff; }
  .inbox2__composer__container { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .inbox2__composer__container > button { border: 0; border-radius: 6px; padding: 6px 14px; background: #eef0f3; font: inherit; }
  .inbox2__composer__container > button:first-child { background: #1a1b20; color: #fff; }
  .inbox2__composer__container > button:last-child { margin-left: auto; background: #1d4ed8; color: #fff; font-weight: 600; }
  .inbox2__composer__container svg { display: none; }
  [data-conversation-reply-composer] { flex-basis: 100%; order: 2; }
  .inbox2__composer__container > button:last-child { order: 4; }
  .isa-draft-language-picker { order: 1; }
  body .isa-draft-language-picker > * { font-size: 13px; line-height: 18px; padding: 4px 9px; }
  [data-testid="composer-editor-area"] { border: 1px solid #d7dce5; border-radius: 10px; min-height: 150px; padding: 12px 14px; }
  [contenteditable] { outline: none; min-height: 126px; }
  [contenteditable] p { margin: 0; min-height: 1.45em; }
  aside { grid-column: 2; grid-row: 1 / span 3; border-left: 1px solid #e6e8ec; padding: 16px 18px; overflow: hidden; }
  aside h2 { font-size: 12px; margin: 0 0 8px; color: #5b6472; text-transform: uppercase; letter-spacing: .04em; }
  aside .flex-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 30px; margin: 0; }
  aside p { margin: 0; }
  aside .inbox2__attribute__label { color: #5b6472; }
  aside img { display: none; }
  aside button { border: 0; background: none; font: inherit; padding: 0; color: #1f2430; }
  [data-intercom-target="user-details"] { margin-top: 18px; padding-top: 14px; border-top: 1px solid #eef0f3; }
  [data-intercom-target="user-details"]::before { content: "Contact"; display: block; font-size: 12px; color: #5b6472; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
</style>`;

function listRows() {
  const row = (id, name, subject, preview, age) => fx.conversationListRow({ conversationId: id, name, subject, preview, age, teamId: TEAM });
  return [
    row(ITALIAN, 'Marco Bellini', 'Taglia sbagliata', 'Buongiorno, ho ricevuto la giacca nella taglia sbagliata…', '3m'),
    row(GERMAN, 'Lena Hofmann', 'Where is my parcel?', 'Hallo, ich habe meine Bestellung noch nicht bekommen…', '6m'),
    row('900475100052963', 'Sophie Bernier', 'Modifier l’adresse', 'Bonjour, est-ce que je peux encore modifier l’adresse…', '14m'),
    row('900475100067148', 'Jonas Weber', 'Rücksendung', 'Wie schicke ich die Schuhe zurück?', '41m'),
    row('900475100071395', 'Anke de Vries', 'Bestelling geannuleerd?', 'Hallo, waarom is mijn bestelling geannuleerd?', '1h'),
    row('900475100084726', 'Ruth Okoro', 'Invoice copy', 'Could you send me a copy of the invoice for…', '2h')
  ];
}

function demoPage(id) {
  const current = CONVERSATIONS[id];
  const nav = fx.inboxNav([
    fx.yourInboxNavLink({ count: 2 }),
    fx.inboxNavLink({ teamId: '900102', label: 'Urgent Alderpoint', count: 1 }),
    fx.inboxNavLink({ teamId: TEAM, label: 'Support Alderpoint', count: 6 }),
    fx.inboxNavLink({ teamId: '900103', label: 'Support Brightwell', count: 3 }),
    fx.inboxNavLink({ teamId: '900104', label: 'Support Kestrel Kids', count: 2 }),
    fx.inboxNavLink({ teamId: '900105', label: 'Returns', count: 4 }),
    fx.inboxNavLink({ teamId: '900106', label: 'Billing', count: 1 })
  ]);
  const html = fx.inboxHtml({
    nav,
    list: `<section class="list">${fx.conversationList(listRows(), { state: 'Open', count: '6' })}</section>`,
    sidebar: fx.sidebarSection({
      teamInbox: 'Support Alderpoint',
      conversationAttrs: [
        fx.conversationAttrRow('9307', 'Brand', 'Alderpoint'),
        fx.conversationAttrRow('9308', 'Escalation Status', 'Not started')
      ]
    }),
    userDetails: fx.userDetailsSection([
      fx.userDetailRow('Name', `<span>${current.name}</span>`),
      fx.userDetailRow('Location', `<span>${current.location}</span>`)
    ]),
    conversation: fx.conversationSpace({
      customerText: current.text
    }),
    composer: fx.composer({ mode: 'email' })
  });
  return html
    .replace('<html>', '<html lang="en">')
    .replace('<body>', `<head><meta charset="utf-8">${style(id)}</head><body><div class="demo-bar">Invented demo inbox<span>the real extension, loaded unpacked in Chromium</span><strong></strong></div>`);
}

async function placeCaretAtTop(page) {
  await page.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    const first = editor.firstElementChild || editor;
    const range = document.createRange();
    range.setStart(first, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
  });
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
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (!url.startsWith('https://app.intercom.com/a/inbox/')) return route.continue();
    const id = Object.keys(CONVERSATIONS).find(key => url.includes(`/conversation/${key}`)) || ITALIAN;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: demoPage(id) });
  });
  const page = context.pages()[0] || await context.newPage();
  const caption = (text) => page.evaluate((value) => { document.querySelector('.demo-bar strong').textContent = value; }, text);
  const openReply = async () => {
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.evaluate(node => { node.spellcheck = false; });
    await editor.click();
    await page.waitForSelector('.isa-draft-language-picker', { timeout: 10000 });
  };
  await page.goto(conversationUrl(ITALIAN));
  await caption('An Italian message: click Reply');
  await page.waitForTimeout(1600);
  await openReply();
  await caption('Italian signature, picked automatically');
  await page.waitForTimeout(2600);
  await caption('Open a German message');
  await page.waitForTimeout(900);
  await page.locator(`a[data-conversation-id="${GERMAN}"]`).click();
  await page.waitForURL(`**/conversation/${GERMAN}*`);
  await caption('Open a German message');
  await page.waitForTimeout(1400);
  await openReply();
  await caption('German signature, picked automatically');
  await page.waitForTimeout(2600);
  await caption('One click switches the language');
  for (const code of ['FR', 'NL', 'DE']) {
    await page.locator('.isa-draft-language-picker > *', { hasText: code }).first().click();
    await page.waitForTimeout(1500);
  }
  await caption('The reply goes above the signature');
  await placeCaretAtTop(page);
  await page.keyboard.type('Hallo Lena, Ihr Paket ist unterwegs und kommt morgen an.', { delay: 45 });
  await page.waitForTimeout(1200);
  await caption('Send');
  await page.locator('.inbox2__composer__container > button').last().click();
  await page.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    const part = document.createElement('div');
    part.className = 'demo-sent';
    part.dataset.testid = 'teammate-email-reply-part';
    part.innerHTML = `<div class="intercom-interblocks-html">${editor.innerHTML}</div>`;
    document.querySelector('[data-intercom-target="conversation-space"]').appendChild(part);
    editor.innerHTML = '<p><br></p>';
    editor.blur();
  });
  await caption('Sent: signed for Alderpoint, in German');
  await page.waitForTimeout(3500);
  const video = await page.video().path();
  await context.close();
  return { directory, video };
}

function toGif(video, output) {
  const palette = path.join(path.dirname(video), 'palette.png');
  const filters = `fps=10,scale=${GIF_WIDTH}:-1:flags=lanczos`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `${filters},palettegen=stats_mode=diff`, palette]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', palette, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', output]);
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
