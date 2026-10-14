import assert from 'node:assert/strict';
import { validatePrintDocumentInput } from '../main/printDocumentPolicy.mjs';

assert.doesNotThrow(() => validatePrintDocumentInput('<html>ok</html>', 8, 12));
for (const [html, width, height] of [
  [null, 8, 12],
  ['ok', 0, 12],
  ['ok', -1, 12],
  ['ok', Number.NaN, 12],
  ['ok', Number.POSITIVE_INFINITY, 12],
  ['ok', 201, 12],
  ['ok', 8, 501],
]) {
  assert.throws(() => validatePrintDocumentInput(html, width, height));
}

assert.throws(() => validatePrintDocumentInput('x'.repeat(16 * 1024 * 1024 + 1), 8, 12), /16 MiB/);
console.log('Print document input policy checks passed.');
