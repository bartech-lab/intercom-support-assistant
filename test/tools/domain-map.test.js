'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');

function isGitIgnored(repoPath) {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', repoPath], { cwd: ROOT }).status === 0;
}
const FENCED_BLOCK = /^\s*(```+|~~~+)/;
const INLINE_PATH = /`([^`]+)`/g;
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]+)\)/g;
const ROOT_DOCUMENT = /^(?:AGENTS|README|CHANGELOG|RELEASE)\.md$/;
const LOCAL_PATH = /^(?:(?:src|test|tools|docs)\/|(?:AGENTS|README|CHANGELOG|RELEASE)\.md$)/;

function javascriptFiles(directory, root = ROOT) {
  const found = [];
  const absoluteDirectory = path.join(root, directory);

  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      found.push(...javascriptFiles(relative, root));
    } else if (entry.name.endsWith('.js')) {
      found.push(relative);
    }
  }

  return found;
}

function withoutFencedBlocks(markdown) {
  let fence = null;
  return markdown.split('\n').map((line) => {
    const marker = line.match(FENCED_BLOCK);
    if (!fence && marker) {
      fence = marker[1].slice(0, 3);
      return '';
    }
    if (fence && marker && marker[1].startsWith(fence)) {
      fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

function headingSlugs(markdown) {
  const slugs = new Set();
  const counts = new Map();
  const source = withoutFencedBlocks(markdown);
  const lines = source.split('\n');

  function addSlug(rawTitle) {
    const title = rawTitle
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .toLowerCase();
    const base = title
      .replace(/&amp;/g, '&')
      .replace(/[^\p{L}\p{N}_ -]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!base) return;

    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) addSlug(heading[1]);
    else if (index > 0 && /^\s*(?:=+|-+)\s*$/.test(line)) addSlug(lines[index - 1].trim());
  }

  for (const match of source.matchAll(/\bid=["']([^"']+)["']/g)) {
    slugs.add(match[1]);
  }

  return slugs;
}

function lineAt(markdown, index) {
  return markdown.slice(0, index).split('\n').length;
}

function parseLinkDestination(rawDestination) {
  const trimmed = rawDestination.trim();
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/, 1)[0];
}

function isExternalLink(destination) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination);
}

function repoRelativePath(documentPath, destination) {
  if (destination.startsWith('/')) return destination.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(documentPath), destination));
}

function collectLinkedDocuments(domainPath, documents) {
  const linked = new Set([domainPath]);

  const markdown = documents.get(domainPath);
  if (!markdown) return linked;
  const source = withoutFencedBlocks(markdown);

  for (const match of source.matchAll(MARKDOWN_LINK)) {
    const destination = parseLinkDestination(match[1]);
    if (!destination || isExternalLink(destination)) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(destination);
    } catch {
      continue;
    }
    const pathname = decoded.split('#', 1)[0];
    const target = pathname ? repoRelativePath(domainPath, pathname) : domainPath;
    if (target.endsWith('.md') && documents.has(target)) linked.add(target);
  }

  for (const match of source.matchAll(INLINE_PATH)) {
    const literal = match[1].trim();
    if (!LOCAL_PATH.test(literal) || /[*?{}$<>]/.test(literal)) continue;
    if (!/\.md(?:#[-\w]+)?$/i.test(literal)) continue;
    const target = literal.split('#', 1)[0];
    if (documents.has(target)) linked.add(target);
  }

  return linked;
}

function normalizedLiteralPath(literal, fileExists) {
  const target = literal.split('#', 1)[0];
  if (fileExists(target)) return target;
  const lineReference = target.match(/^(.*\.(?:js|md|json|html|css|gs|svg|txt)):\d+(?::\d+)?$/i);
  return lineReference ? lineReference[1] : target;
}

function validateDomainMap({ domainPath, sourceFiles, testFiles, documents, fileExists }) {
  const issues = [];
  const domain = documents.get(domainPath);
  if (typeof domain !== 'string') return [`${domainPath}: document is unavailable`];

  const searchableDomain = withoutFencedBlocks(domain);
  for (const file of [...sourceFiles, ...testFiles]) {
    if (!searchableDomain.includes(`\`${file}\``)) issues.push(`${domainPath}: missing mapped file ${file}`);
  }

  const checkedDocuments = collectLinkedDocuments(domainPath, documents);
  for (const documentPath of checkedDocuments) {
    const markdown = documents.get(documentPath);
    if (typeof markdown !== 'string') continue;
    const scan = withoutFencedBlocks(markdown);

    for (const match of scan.matchAll(MARKDOWN_LINK)) {
      const destination = parseLinkDestination(match[1]);
      if (!destination || isExternalLink(destination)) continue;

      let decoded;
      try {
        decoded = decodeURIComponent(destination);
      } catch {
        issues.push(`${documentPath}:${lineAt(scan, match.index)}: invalid link encoding ${destination}`);
        continue;
      }

      const [pathname, anchor] = decoded.split('#', 2);
      const target = pathname ? repoRelativePath(documentPath, pathname) : documentPath;
      if (!fileExists(target)) {
        issues.push(`${documentPath}:${lineAt(scan, match.index)}: missing local link target ${target}`);
        continue;
      }

      if (anchor && target.endsWith('.md')) {
        const targetMarkdown = documents.get(target);
        if (!targetMarkdown) continue;
        const targetSlugs = headingSlugs(targetMarkdown);
        if (!targetSlugs.has(anchor.toLowerCase())) {
          issues.push(`${documentPath}:${lineAt(scan, match.index)}: missing heading anchor ${target}#${anchor}`);
        }
      }
    }

    for (const match of scan.matchAll(INLINE_PATH)) {
      const literal = match[1].trim();
      if (!LOCAL_PATH.test(literal) || /[*?{}$<>]/.test(literal)) continue;
      if (ROOT_DOCUMENT.test(literal) && !fileExists(literal)) {
        issues.push(`${documentPath}:${lineAt(scan, match.index)}: missing local path ${literal}`);
        continue;
      }
      if (!/^(?:src|test|tools|docs)\//.test(literal)) continue;
      const localPath = normalizedLiteralPath(literal, fileExists);
      if (!fileExists(localPath)) {
        issues.push(`${documentPath}:${lineAt(scan, match.index)}: missing local path ${localPath}`);
      }
    }
  }

  return issues;
}

function readDocumentation(root) {
  const documents = new Map();
  const rootDocuments = ['AGENTS.md', 'README.md', 'CHANGELOG.md', 'RELEASE.md'];
  const pending = ['docs'];

  for (const documentPath of rootDocuments) {
    const absolutePath = path.join(root, documentPath);
    if (fs.existsSync(absolutePath)) {
      documents.set(documentPath, fs.readFileSync(absolutePath, 'utf8'));
    }
  }

  while (pending.length) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) pending.push(relativePath);
      else if (entry.name.endsWith('.md')) {
        documents.set(relativePath, fs.readFileSync(path.join(root, relativePath), 'utf8'));
      }
    }
  }

  return documents;
}

test('domain map lists every runtime and test JavaScript file and checks local references in the map and directly referenced docs', () => {
  const domainPath = 'docs/domain.md';
  const documents = readDocumentation(ROOT);
  const issues = validateDomainMap({
    domainPath,
    sourceFiles: javascriptFiles('src'),
    testFiles: javascriptFiles('test'),
    documents,
    fileExists: (repoPath) => fs.existsSync(path.join(ROOT, repoPath)) || isGitIgnored(repoPath)
  });

  assert.deepEqual(issues, [], issues.join('\n'));
});

test('domain map checker reports a missing mapped file and dangling local reference', () => {
  const domainPath = 'docs/domain.md';
  const documents = new Map([
    [domainPath, '# Map\n\n`src/kept.js` and `test/kept.test.js`.\n\n[Guide](guide.md#present) [Missing](other.md) [Invalid](bad%zz.md)'],
    ['docs/guide.md', '# Present\n\n[Broken section](target.md#absent)'],
    ['docs/target.md', '# Existing section\n\n```html\n<div id="absent"></div>\n```']
  ]);
  const existing = new Set(['docs/domain.md', 'docs/guide.md', 'docs/target.md']);
  const issues = validateDomainMap({
    domainPath,
    sourceFiles: ['src/kept.js', 'src/missing.js'],
    testFiles: ['test/kept.test.js'],
    documents,
    fileExists: (repoPath) => existing.has(repoPath)
  });

  assert(issues.some((issue) => issue.includes('missing mapped file src/missing.js')));
  assert(issues.some((issue) => issue.includes('missing heading anchor docs/target.md#absent')));
  assert(issues.some((issue) => issue.includes('missing local link target docs/other.md')));
  assert(issues.some((issue) => issue.includes('invalid link encoding bad%zz.md')));
});

test('domain map checker ignores fenced path examples as mappings and ignores wildcards', () => {
  const domainPath = 'docs/domain.md';
  const documents = new Map([
    [domainPath, '# Map\n\n`src/real.js`\n\n```sh\ncat docs/old-example.md\n`src/fenced.js`\n```\n\n`src/**/*.js`']
  ]);
  const issues = validateDomainMap({
    domainPath,
    sourceFiles: ['src/real.js', 'src/fenced.js'],
    testFiles: [],
    documents,
    fileExists: (repoPath) => repoPath === domainPath || repoPath === 'src/real.js'
  });

  assert.deepEqual(issues, ['docs/domain.md: missing mapped file src/fenced.js']);
});
