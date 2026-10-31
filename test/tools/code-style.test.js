'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const SCANNED_DIRECTORIES = ['src', 'tools', 'test'];

function javascriptFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      found.push(...javascriptFiles(relative));
    } else if (/\.(js|mjs|gs)$/.test(entry.name)) {
      found.push(relative);
    }
  }
  return found;
}

const REGEX_AFTER_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'
]);

function findComments(source) {
  const found = [];
  const stack = [];
  let line = 1;
  let index = 0;
  let previousSignificant = '';

  const regexCanStartHere = () => previousSignificant === ''
    || REGEX_AFTER_WORDS.has(previousSignificant)
    || (previousSignificant.length === 1 && '(,=:[!&|?{};+-*%~^<>'.includes(previousSignificant));

  const skipEscape = () => {
    if (source[index + 1] === '\n') line += 1;
    index += 2;
  };

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    const mode = stack[stack.length - 1];

    if (character === '\n') {
      line += 1;
      index += 1;
      if (mode === '"' || mode === "'") stack.pop();
      continue;
    }

    if (mode === '"' || mode === "'") {
      if (character === '\\') { skipEscape(); continue; }
      if (character === mode) { stack.pop(); previousSignificant = mode; }
      index += 1;
      continue;
    }

    if (mode === '`') {
      if (character === '\\') { skipEscape(); continue; }
      if (character === '`') { stack.pop(); previousSignificant = '`'; index += 1; continue; }
      if (character === '$' && next === '{') { stack.push('${'); previousSignificant = '{'; index += 2; continue; }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === '`') { stack.push(character); index += 1; continue; }

    if (character === '{') { stack.push('{'); previousSignificant = '{'; index += 1; continue; }
    if (character === '}') {
      if (mode === '{' || mode === '${') stack.pop();
      previousSignificant = '}';
      index += 1;
      continue;
    }

    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      found.push({ line, text: source.slice(index, end === -1 ? undefined : end).trim() });
      index = end === -1 ? source.length : end;
      continue;
    }

    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const body = source.slice(index, end === -1 ? undefined : end + 2);
      found.push({ line, text: body.split('\n')[0].trim() });
      line += (body.match(/\n/g) || []).length;
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    if (character === '/' && regexCanStartHere()) {
      let cursor = index + 1;
      let inClass = false;
      while (cursor < source.length) {
        const inner = source[cursor];
        if (inner === '\\') { cursor += 2; continue; }
        if (inner === '\n') break;
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) { cursor += 1; break; }
        cursor += 1;
      }
      index = cursor;
      previousSignificant = '/';
      continue;
    }

    const word = /^[A-Za-z_$][\w$]*|^\d[\w.]*/.exec(source.slice(index, index + 64));
    if (word) {
      previousSignificant = /^\d/.test(word[0]) ? '0' : word[0];
      index += word[0].length;
      continue;
    }

    if (!/\s/.test(character)) previousSignificant = character;
    index += 1;
  }

  return found;
}

test('no JavaScript file in src, tools or test carries a comment', () => {
  const offences = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const relative of javascriptFiles(directory)) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      for (const comment of findComments(source)) {
        offences.push(`${relative}:${comment.line}: ${comment.text.slice(0, 80)}`);
      }
    }
  }

  assert.deepEqual(offences, [], [
    `${offences.length} comment(s) found. docs/code-style.md forbids them:`,
    'move the reason into a docs/ page, the commit message, a function name, or a test name.',
    ...offences
  ].join('\n'));
});

test('the comment scanner tells a regex literal and a division from a comment', () => {
  const withRegex = "const p = /^priority\\s*team\\s*/i; const q = a / b; const r = /[/]/;";
  assert.deepEqual(findComments(withRegex), []);

  assert.deepEqual(findComments("const url = 'https://example.com/a//b';"), []);
  assert.deepEqual(findComments('const css = `a { color: red } /* not code */`;'), []);

  assert.deepEqual(findComments('const a = 1; // trailing').map(c => c.text), ['// trailing']);
  assert.deepEqual(findComments('/* block */ const a = 1;').map(c => c.text), ['/* block */']);
  assert.deepEqual(findComments('const a = 1;\n\n// third line').map(c => c.line), [3]);

  assert.deepEqual(findComments("function f(s) { return /'/.test(s); }\n// hidden").map(c => c.line), [2]);
  assert.deepEqual(findComments('const q = typeof x === "string" ? x.split(/["]/) : x;\n// after').map(c => c.line), [2]);
  assert.deepEqual(findComments('const t = `a ${`b ${c}`} d`;\n// after nested').map(c => c.line), [2]);
  assert.deepEqual(findComments('const t = `x ${ b // inside\n}`;').map(c => c.text), ['// inside']);
  assert.deepEqual(findComments('const t = `a ${ { k: 1 }.k } /* text */`;'), []);
});

test('no em dash reaches anything the extension renders', () => {
  const shipped = javascriptFiles('src')
    .concat(['src/popup.html', 'src/preview-page.html', 'src/manifest.json']);

  const offences = [];
  for (const file of shipped) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    source.split('\n').forEach((text, index) => {
      if (text.includes('—')) offences.push(`${file}:${index + 1} ${text.trim().slice(0, 90)}`);
    });
  }

  assert.deepEqual(offences, [], [
    `${offences.length} em dash(es) found in shipped files.`,
    'Use a plain hyphen, a colon, parentheses, a middle dot, or nothing.',
    ...offences
  ].join('\n'));
});
