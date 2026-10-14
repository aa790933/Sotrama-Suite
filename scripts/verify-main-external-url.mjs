import assert from 'node:assert/strict';
import { normalizeExternalUrl } from '../main/externalUrlPolicy.ts';

assert.equal(normalizeExternalUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1');
assert.equal(normalizeExternalUrl('http://localhost:3000/'), 'http://localhost:3000/');
for (const input of [
  null,
  undefined,
  123,
  '',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,hello',
  'https://user:secret@example.com/',
  'https://example.com/' + 'a'.repeat(8193),
  'not a URL',
]) {
  assert.equal(normalizeExternalUrl(input), null, `expected rejection for ${String(input).slice(0, 80)}`);
}

console.log('External URL policy checks passed.');
