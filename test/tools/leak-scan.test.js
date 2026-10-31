'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'leak-scan.mjs');
const scanner = import(pathToFileURL(SCRIPT).href);
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const join = (...parts) => parts.join('');
const PLANTS = {
  email: join('jane.doe', '@', 'acme-corp', '.io'),
  'url-host': join('https://', 'internal.acme-corp', '.io/admin'),
  'numeric-id': join('48', '1516', '23'),
  'hex-id': join('5d1e7b3a', 'c9042f6e', 'b18d0c4f'),
  'workspace-id': join('/a/inbox/', 'q7', 'zk', 'lm2', '/inbox'),
  'intercom-id': join('?custom_folder_id=', '58', '213'),
  'secret-github': join('gh', 'p_', 'A'.repeat(36)),
  'secret-assignment': join('api', 'Key = "', 'Zq8', 'Lm3', 'Vp9', 'Rt2', 'Wx4"')
};
const ALLOWED = [
  join('jane.doe', '@', 'example.com'),
  join('https://', 'app.intercom.com/a/inbox'),
  join('900', '1516', '23'),
  join('21474', '83647'),
  join('/a/inbox/', 'demo1234', '/inbox'),
  join('/inbox/team/', '9002', '02?custom_folder_id=', '900', '613'),
  join('?custom_folder_id=', '1234'),
  join('token: "', 'submission-token-1', '"')
];
const DENYLIST = 'term:zorblax\nword:qux';

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isa-leak-scan-'));
  tempDirs.push(dir);
  return dir;
}

function run(args, env = {}) {
  const home = tempDir();
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...env }
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function pngWithText(text) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

test('every generic rule reports its own planted value', async () => {
  const { scanText } = await scanner;
  for (const [rule, value] of Object.entries(PLANTS)) {
    const rules = scanText(value, 'plant.js', []).map(finding => finding.rule);
    assert.ok(rules.includes(rule), `${rule} missed ${value}: ${JSON.stringify(rules)}`);
  }
  const roundedId = join('3154', '7542', '0000000');
  assert.deepEqual(scanText(roundedId, 'plant.js', []).map(finding => finding.rule), ['numeric-id'], roundedId);
});

test('the allowlisted look-alikes produce no finding', async () => {
  const { scanText } = await scanner;
  for (const value of ALLOWED) {
    assert.deepEqual(scanText(`const value = '${value}';`, 'allowed.js', []), [], value);
  }
});

test('a denylist term matches inside a word, a denylist word only on its own', async () => {
  const { scanText, parseDenylist } = await scanner;
  const rules = parseDenylist(DENYLIST);
  const hits = text => scanText(text, 'file.txt', rules).map(finding => finding.match.toLowerCase());
  assert.deepEqual(hits('the MegaZorblaxCo brand'), ['zorblax']);
  assert.deepEqual(hits('a qux inbox'), ['qux']);
  assert.deepEqual(hits('QUX and quxes'), ['qux']);
  assert.deepEqual(hits('quxly and aquxa'), []);
});

test('a denylist entry hidden behind a JavaScript, HTML or URL escape is still found', async () => {
  const { scanText, parseDenylist } = await scanner;
  const rules = parseDenylist(DENYLIST);
  const hits = text => scanText(text, 'file.js', rules).map(finding => finding.match.toLowerCase());
  for (const escaped of [join('zorbl', '\\u0061', 'x'), join('zorbl', '\\x61', 'x'), join('zorbl', '&#97;', 'x'), join('zorbl', '&#x61;', 'x'), join('zorbl', '%61', 'x'), join('Q', '\\u{75}', 'X')]) {
    assert.equal(hits(`const name = '${escaped}';`).length, 1, escaped);
  }
});

test('a malformed denylist line is a configuration error', async () => {
  const { parseDenylist } = await scanner;
  assert.throws(() => parseDenylist('zorblax'), /line 1/);
  assert.throws(() => parseDenylist('term:ok\nphrase:bad'), /line 2/);
});

test('the CLI exits 0 on a clean tree, 1 on a plant, and never prints the value without --reveal', () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'clean.js'), `const ok = '${ALLOWED[0]}';\n`);
  assert.equal(run([root], { LEAK_DENYLIST: DENYLIST }).status, 0);

  fs.writeFileSync(path.join(root, 'leak.js'), `\nconst contact = '${PLANTS.email}';\n`);
  const hidden = run([root], { LEAK_DENYLIST: DENYLIST });
  assert.equal(hidden.status, 1);
  assert.match(hidden.stdout, /^leak\.js:2 email$/m);
  assert.equal(hidden.stdout.includes(PLANTS.email), false);

  const shown = run(['--reveal', root], { LEAK_DENYLIST: DENYLIST });
  assert.ok(shown.stdout.includes(PLANTS.email));
});

test('the CLI fails closed with exit 2 when no denylist is configured', () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'clean.js'), 'const ok = 1;\n');
  const missing = run([root], { LEAK_DENYLIST_FILE: path.join(root, 'absent.txt') });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /denylist not found/);

  const generic = run(['--generic-only', root]);
  assert.equal(generic.status, 0);
  assert.match(generic.stderr, /generic rules only/);
});

test('a denylist hit in a file name or a PNG text chunk is reported', () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'zorblax-notes.md'), 'clean\n');
  fs.writeFileSync(path.join(root, 'shot.png'), pngWithText(`by ${PLANTS.email}`));
  const result = run([root], { LEAK_DENYLIST: DENYLIST });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^zorblax-notes\.md#path:1 deny#1$/m);
  assert.match(result.stdout, /^shot\.png#png-text:\d+ email$/m);
});

function gifWithComment(text) {
  const comment = Buffer.from(text, 'latin1');
  return Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([1, 0, 1, 0, 0x80, 0, 0]),
    Buffer.from([0, 0, 0, 255, 255, 255]),
    Buffer.from([0x21, 0xfe, comment.length]), comment, Buffer.from([0]),
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0]),
    Buffer.from([2, 2, 0x44, 0x01, 0]),
    Buffer.from([0x3b])
  ]);
}

test('a GIF is scanned through its text blocks, not its pixel bytes', () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'clean.gif'), gifWithComment('made with care'));
  assert.equal(run([root], { LEAK_DENYLIST: DENYLIST }).status, 0);

  fs.writeFileSync(path.join(root, 'leak.gif'), gifWithComment(`by ${PLANTS.email}`));
  const result = run([root], { LEAK_DENYLIST: DENYLIST });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^leak\.gif#gif-text:1 email$/m);
  assert.doesNotMatch(result.stdout, /unexpected-binary/);
});

test('--history finds a plant that a later commit deleted, and a non-noreply identity', () => {
  const root = tempDir();
  const identity = {
    GIT_AUTHOR_NAME: 'Dev',
    GIT_AUTHOR_EMAIL: 'dev@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'Dev',
    GIT_COMMITTER_EMAIL: 'dev@users.noreply.github.com'
  };
  const git = (args, env = identity) => execFileSync('git', ['-C', root, ...args], {
    env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', ...env }
  });
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, 'notes.md'), `contact ${PLANTS.email}\n`);
  git(['add', '.']);
  git(['commit', '-qm', 'add notes']);
  fs.writeFileSync(path.join(root, 'notes.md'), 'nothing here\n');
  git(['commit', '-qam', 'scrub notes']);

  assert.equal(run([root], { LEAK_DENYLIST: DENYLIST }).status, 0, 'the tree alone is clean');
  const history = run(['--history', root], { LEAK_DENYLIST: DENYLIST });
  assert.equal(history.status, 1);
  assert.match(history.stdout, /:notes\.md:1 email$/m);
  assert.doesNotMatch(history.stdout, /commit-identity/);

  git(['commit', '-q', '--allow-empty', '-m', 'empty'], { ...identity, GIT_AUTHOR_EMAIL: 'dev@example.com' });
  assert.match(run(['--history', root], { LEAK_DENYLIST: DENYLIST }).stdout, /commit-identity/);
});
