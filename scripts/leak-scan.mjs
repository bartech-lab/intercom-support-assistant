#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { inflateSync } from 'node:zlib';

const USAGE = `Usage: leak-scan.mjs [--history] [--generic-only] [--reveal] [path]

Scans every file under <path> (default: .) for real data and secrets.
--history       also scan every blob, commit message and identity in the git history
--generic-only  run without the private denylist (CI, and any clone without it)
--reveal        print the matched text (local use only, never in CI logs)

The private denylist comes from $LEAK_DENYLIST (file content), $LEAK_DENYLIST_FILE,
or ~/.config/leak-scan/intercom-support-assistant.txt. Missing denylist: exit 2.
Exit codes: 0 clean, 1 findings, 2 configuration error.`;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);

const ALLOWED_HOSTS = [
  /^app\.intercom\.com$/,
  /^js\.intercomcdn\.com$/,
  /^(?:[a-z0-9-]+\.)*example(?:\.(?:com|org|net))?$/,
  /^(?:[a-z0-9-]+\.)*(?:test|invalid|localhost)$/,
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^github\.com$/,
  /^img\.shields\.io$/,
  /^developer\.chrome\.com$/,
  /^nodejs\.org$/,
  /^registry\.npmjs\.org$/,
  /^www\.npmjs\.com$/,
  /^www\.w3\.org$/,
  /^keepachangelog\.com$/,
  /^semver\.org$/,
  /^opensource\.org$/,
  /^playwright\.dev$/,
  /^chromewebstore\.google\.com$/,
  /^example\.(?:slack\.com|atlassian\.net)$/,
  /^linear\.app$/,
  /^(?:[a-z0-9-]+\.)*intercom\.io$/,
  /^(?:[a-z0-9-]+\.)*intercom-attachments(?:-\d+)?\.com$/,
];

const ALLOWED_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|users\.noreply\.github\.com)$/i;
const ALLOWED_GITHUB_PATH = /^\/(bartech-lab(\/|$)|actions\/|gitleaks\/|$)/;
const ALLOWED_APP_ID = /^(?:conversation|(?:demo|test|ws|x|app|example|fixture|team|abc|other)[a-z0-9_-]*|\d{1,5}|900\d*)$/i;

const PLACEHOLDER = /example|placeholder|dummy|fake|redacted|xxxx|test|sample|token-value|<|\$\{/i;

const SECRET_SHAPES = [
  ['secret-github', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['secret-openai', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['secret-aws', /\bAKIA[0-9A-Z]{16}\b/],
  ['secret-slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['secret-google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['secret-private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['secret-apps-script', /script\.google(?:usercontent)?\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/],
];
const SECRET_ASSIGNMENT = /\b[\w-]*(?:token|secret|password|passwd|api[_-]?key|bearer|auth[_-]?key)[\w-]*["']?\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i;

const isPackageLock = (path) => /(^|[/:])package-lock\.json$/.test(path);

function parseArgs(argv) {
  const opts = { history: false, genericOnly: false, reveal: false, root: '.' };
  for (const arg of argv) {
    if (arg === '--history') opts.history = true;
    else if (arg === '--generic-only') opts.genericOnly = true;
    else if (arg === '--reveal') opts.reveal = true;
    else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error(`unknown option ${arg}\n${USAGE}`);
      process.exit(2);
    } else opts.root = arg;
  }
  return opts;
}

export function parseDenylist(text) {
  const rules = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const sep = line.indexOf(':');
    const kind = line.slice(0, sep);
    const value = line.slice(sep + 1).toLowerCase();
    if (sep < 1 || !value || !['term', 'word'].includes(kind)) {
      throw new Error(`denylist line ${index + 1}: expected "term:<text>" or "word:<text>"`);
    }
    rules.push({ id: `deny#${index + 1}`, kind, value });
  });
  return rules;
}

function loadDenylist(opts) {
  if (opts.genericOnly) return [];
  if (process.env.LEAK_DENYLIST) return parseDenylist(process.env.LEAK_DENYLIST);
  const file = process.env.LEAK_DENYLIST_FILE || join(homedir(), '.config/leak-scan/intercom-support-assistant.txt');
  if (!existsSync(file)) {
    console.error(`leak-scan: denylist not found (${file}). Set LEAK_DENYLIST or pass --generic-only.`);
    process.exit(2);
  }
  return parseDenylist(readFileSync(file, 'utf8'));
}

const isAlnum = (c) => c !== undefined && /[A-Za-z0-9]/.test(c);
const isLowerOrDigit = (c) => c !== undefined && /[a-z0-9]/.test(c);
const isUpper = (c) => c !== undefined && /[A-Z]/.test(c);

function wordMatches(line, lower, value) {
  const hits = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(value, from);
    if (at < 0) return hits;
    from = at + 1;
    const before = line[at - 1];
    const first = line[at];
    const after = line[at + value.length];
    const startOk = !isAlnum(before) || (isLowerOrDigit(before) && isUpper(first));
    const endOk = !isLowerOrDigit(after);
    if (startOk && endOk) hits.push(line.slice(at, at + value.length));
  }
}

function hostAllowed(host, path) {
  if (host === 'github.com') return ALLOWED_GITHUB_PATH.test(path || '/');
  return ALLOWED_HOSTS.some((re) => re.test(host));
}

function epochLike(n) {
  const v = Number(n);
  return (v >= 1_500_000_000 && v <= 2_100_000_000) || (v >= 1_500_000_000_000 && v <= 2_100_000_000_000);
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', aacute: 'á', acirc: 'â', ccedil: 'ç', iacute: 'í', oacute: 'ó', ocirc: 'ô', uacute: 'ú', ntilde: 'ñ', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß' };

export function decodeEscapes(line) {
  return line
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (all, name) => NAMED_ENTITIES[name.toLowerCase()] ?? all)
    .replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .normalize('NFC');
}

export function scanText(text, path, denyRules) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = i + 1;
    const push = (rule, match) => findings.push({ path, line: at, rule, match });
    const lower = line.toLowerCase();

    const seen = new Set();
    for (const variant of new Set([line, decodeEscapes(line)])) {
      const variantLower = variant.toLowerCase();
      for (const rule of denyRules) {
        const matches = rule.kind === 'term'
          ? (variantLower.includes(rule.value) ? [rule.value] : [])
          : wordMatches(variant, variantLower, rule.value);
        for (const m of matches) {
          const key = `${rule.id}\0${m}`;
          if (seen.has(key)) continue;
          seen.add(key);
          push(rule.id, m);
        }
      }
    }

    for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) {
      const domain = m[1].replace(/\.$/, '');
      if (/^\d/.test(m[0]) && /^\d+(\.\d+)*$/.test(domain)) continue;
      if (isPackageLock(path) && /^[\w.-]+\.(?:js|json)$/.test(domain)) continue;
      if (!/\.[A-Za-z]{2,}$/.test(domain) || /\.(js|json|css|svg|png|mjs|md|html)$/i.test(domain)) continue;
      if (!ALLOWED_EMAIL_DOMAIN.test(domain)) push('email', m[0]);
    }

    const lockfileUrl = isPackageLock(path) && /^\s*"(?:url|resolved)":/.test(line);
    for (const m of lockfileUrl ? [] : line.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([A-Za-z0-9.-]+)(?::\d+)?(\/[^\s'"<>)\]`]*)?/gi)) {
      const host = m[1].toLowerCase().replace(/\.$/, '');
      if (!host.includes('.') && host !== 'localhost') continue;
      if (!hostAllowed(host, m[2])) push('url-host', m[0]);
    }

    if (!isPackageLock(path)) {
      for (const m of line.matchAll(/(?<![\w.#])\d{6,}(?![\w.])/g)) {
        if (m[0].startsWith('900') || /^\d{1,2}0+$/.test(m[0]) || Number(m[0]) % 60000 === 0 || m[0] === '2147483647' || m[0] === '2147483000' || epochLike(m[0])) continue;
        push('numeric-id', m[0]);
      }
      for (const m of line.matchAll(/(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])/g)) {
        if (/^(900|0{6}|a{6}|f{6})/.test(m[0]) || !/[a-f]/.test(m[0]) || !/\d/.test(m[0])) continue;
        push('hex-id', m[0]);
      }
      for (const m of line.matchAll(/(?:[?&;]|\b)(?:custom_folder_id|folder_id|inbox_id|team_id|admin_id|assignee_id|view_id)=(\d{4,})|\/(?:inbox\/team|inbox\/admin|views?|folders?)\/(\d{4,})(?!\d)/g)) {
        const id = m[1] || m[2];
        if (!id.startsWith('900') && !/^(\d)\1+$/.test(id) && ![...id].every((d, i) => i === 0 || Number(d) === Number(id[i - 1]) + 1)) push('intercom-id', id);
      }
      for (const m of line.matchAll(/\/a\/(?:apps|inbox)\/([A-Za-z0-9_-]+)|\bapp_?id["']?\s*[:=]\s*["']([A-Za-z0-9_-]+)["']/gi)) {
        const id = m[1] || m[2];
        if (!ALLOWED_APP_ID.test(id) && !/^[<$:{]/.test(id)) push('workspace-id', id);
      }
    }

    for (const [rule, re] of SECRET_SHAPES) {
      const m = line.match(re);
      if (m) push(rule, m[0]);
    }
    const a = line.match(SECRET_ASSIGNMENT);
    if (a && !PLACEHOLDER.test(a[1]) && !/^[a-z]+(?:-[a-z]+)*-\d{1,4}$/.test(a[1]) && /[0-9]/.test(a[1]) && /[A-Za-z]/.test(a[1]) && !/^[\w.]+\(/.test(a[1])) {
      push('secret-assignment', a[1]);
    }
  });
  return findings;
}

function pngText(buf) {
  const out = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'tEXt') out.push(data.toString('latin1').replace('\0', ' '));
    else if (type === 'iTXt' || type === 'zTXt') {
      try {
        const parts = data.toString('latin1').split('\0');
        out.push(parts[0]);
        const compressed = type === 'zTXt' || data[parts[0].length + 1] === 1;
        const tail = data.subarray(data.indexOf(0, parts[0].length + (type === 'iTXt' ? 3 : 2)) + 1);
        out.push(compressed ? inflateSync(type === 'zTXt' ? data.subarray(parts[0].length + 2) : tail).toString('utf8') : tail.toString('utf8'));
      } catch {
        out.push(data.toString('latin1'));
      }
    } else if (type === 'eXIf') out.push(data.toString('latin1').replace(/[^\x20-\x7e]+/g, '\n'));
    off += 12 + len;
  }
  return out.join('\n');
}

export function gifText(buf) {
  if (buf.toString('latin1', 0, 6) !== 'GIF87a' && buf.toString('latin1', 0, 6) !== 'GIF89a') return null;
  const out = [];
  const colorTable = flags => (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  const subBlocks = (start) => {
    const parts = [];
    let off = start;
    while (off < buf.length && buf[off] !== 0) {
      parts.push(buf.subarray(off + 1, off + 1 + buf[off]));
      off += 1 + buf[off];
    }
    if (off >= buf.length) throw new Error('truncated');
    return { data: Buffer.concat(parts), next: off + 1 };
  };
  let off = 13 + colorTable(buf[10]);
  while (off < buf.length) {
    const marker = buf[off];
    if (marker === 0x3b) return out.join('\n');
    if (marker === 0x21) {
      const label = buf[off + 1];
      const { data, next } = subBlocks(off + 2);
      if (label === 0xfe || label === 0xff || label === 0x01) out.push(data.toString('latin1'));
      off = next;
    } else if (marker === 0x2c) {
      off = subBlocks(off + 10 + colorTable(buf[off + 9]) + 1).next;
    } else {
      return null;
    }
  }
  return null;
}

export function scanBuffer(buf, path, denyRules) {
  if (buf.includes(0)) {
    if (extname(path).toLowerCase() === '.png') return scanText(pngText(buf), `${path}#png-text`, denyRules);
    if (extname(path).toLowerCase() === '.gif') {
      let text = null;
      try { text = gifText(buf); } catch { text = null; }
      if (text !== null) return scanText(text, `${path}#gif-text`, denyRules);
    }
    const strings = buf.toString('latin1').match(/[\x20-\x7e]{6,}/g) || [];
    return [
      { path, line: 0, rule: 'unexpected-binary', match: extname(path) || 'binary' },
      ...scanText(strings.join('\n'), `${path}#strings`, denyRules),
    ];
  }
  return scanText(buf.toString('utf8'), path, denyRules);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function scanTree(root, denyRules) {
  const findings = [];
  let files = 0;
  for (const file of walk(root)) {
    files += 1;
    const rel = relative(root, file);
    findings.push(...scanText(rel, `${rel}#path`, denyRules));
    findings.push(...scanBuffer(readFileSync(file), rel, denyRules));
  }
  return { findings, files };
}

function scanHistory(root, denyRules) {
  const git = (args, encoding = 'utf8') => execFileSync('git', ['-C', root, ...args], { encoding, maxBuffer: 1 << 30 });
  const findings = [];
  let blobs = 0;
  const seen = new Set();
  for (const row of git(['rev-list', '--all', '--objects']).split('\n')) {
    const [sha, ...rest] = row.split(' ');
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);
    if (git(['cat-file', '-t', sha]).trim() !== 'blob') continue;
    blobs += 1;
    const name = rest.join(' ') || sha;
    findings.push(...scanText(name, `${sha.slice(0, 10)}:${name}#path`, denyRules));
    findings.push(...scanBuffer(git(['cat-file', 'blob', sha], 'buffer'), `${sha.slice(0, 10)}:${name}`, denyRules));
  }
  const log = git(['log', '--all', '--format=%x00%H%n%an <%ae>%n%cn <%ce>%n%B']);
  let commits = 0;
  for (const entry of log.split('\0').filter(Boolean)) {
    commits += 1;
    const [sha, author, committer] = entry.split('\n');
    for (const who of [author, committer]) {
      const email = (who.match(/<([^>]*)>/) || [])[1] || '';
      if (!/@users\.noreply\.github\.com$/.test(email)) findings.push({ path: `commit ${sha.slice(0, 10)}`, line: 0, rule: 'commit-identity', match: email });
    }
    findings.push(...scanText(entry.replace(/<\d+\+([\w-]+@users\.noreply\.github\.com)>/g, '<$1>'), `commit ${sha.slice(0, 10)}`, denyRules));
  }
  return { findings, blobs, commits };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.root) || !statSync(opts.root).isDirectory()) {
    console.error(`leak-scan: ${opts.root} is not a directory`);
    process.exit(2);
  }
  let denyRules;
  try {
    denyRules = loadDenylist(opts);
  } catch (error) {
    console.error(`leak-scan: ${error.message}`);
    process.exit(2);
  }
  const tree = scanTree(opts.root, denyRules);
  const findings = [...tree.findings];
  let summary = `${tree.files} files`;
  if (opts.history) {
    const hist = scanHistory(opts.root, denyRules);
    findings.push(...hist.findings);
    summary += `, ${hist.blobs} history blobs, ${hist.commits} commits`;
  }
  for (const f of findings) {
    console.log(`${f.path}:${f.line} ${f.rule}${opts.reveal ? ` ${JSON.stringify(f.match)}` : ''}`);
  }
  const mode = opts.genericOnly ? 'generic rules only (no private denylist)' : `generic rules + ${denyRules.length} private denylist entries`;
  console.error(`leak-scan: ${summary}; ${mode}; ${findings.length} finding(s)`);
  process.exit(findings.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
