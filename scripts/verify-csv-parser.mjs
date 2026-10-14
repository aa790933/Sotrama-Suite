import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateCSV, parseCSV } = require('../utils/csvParser.js');

const source = [
  ['name', 'description'],
  ['item-1', 'a,b'],
  ['item-2', 'say "hello"'],
  ['item-3', 'first line\nsecond line'],
];
const encoded = generateCSV(source);
const decoded = parseCSV(encoded + '\r\n');

assert.deepEqual(decoded, source, 'CSV quoting, escaped quotes, and embedded newlines round-trip');
assert.deepEqual(
  parseCSV('name,description\r\nitem-1,"a,b"\r\n'),
  [['name', 'description'], ['item-1', 'a,b']],
  'quoted commas stay inside one field'
);

console.log('CSV parser regression checks passed.');
