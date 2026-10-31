'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCompanySignature } = require('../../src/signature-normalizer');

const LINKS = { Brightwell: 'https://www.brightwell.example/' };
const ROLE = "Customer Support at <a href='https://www.brightwell.example/' target='_blank'>Brightwell</a>";

test('a plain brand line under the role is dropped whatever its case', () => {
  for (const brandLine of ['BRIGHTWELL', 'brightwell', '@Brightwell']) {
    const out = normalizeCompanySignature(`Anna<br>Customer Support Specialist<br>${brandLine}<br>+48 123`, 'english', 'Brightwell', LINKS);
    assert.equal(out, `Anna<br>${ROLE}<br>+48 123`, brandLine);
  }
});

test('a brand-host link to a deeper path is left as written', () => {
  const line = "Help: <a href='https://www.brightwell.example/help' target='_blank'>Help centre</a>";
  const out = normalizeCompanySignature(`Anna<br>Customer Support Specialist<br>${line}`, 'english', 'Brightwell', LINKS);
  assert.equal(out, `Anna<br>${ROLE}<br>${line}`);
});

test('a brand-host link to the site root is dropped after the role line', () => {
  const line = "<a href='https://brightwell.example/' target='_blank'>brightwell.example</a>";
  const out = normalizeCompanySignature(`Anna<br>Customer Support Specialist<br>${line}`, 'english', 'Brightwell', LINKS);
  assert.equal(out, `Anna<br>${ROLE}`);
});
