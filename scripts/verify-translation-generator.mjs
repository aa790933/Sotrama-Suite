import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getIndexFormat,
  getIndexList,
  getSnippets,
  getWhitespaceSanitized,
  schemaTranslateables,
} from '../utils/translationHelpers.mjs';

assert.equal(getIndexFormat('Hello ${name}, ${place}!'), 'Hello ${0}, ${1}!');
assert.deepEqual(getSnippets('Hello ${name}, ${place}!'), ['Hello ', ', ', '!']);
assert.deepEqual(getIndexList('Hello ${0}, ${1}!'), [0, 1]);
assert.equal(getWhitespaceSanitized(' hello\n  world  '), 'hello world');
assert.deepEqual(schemaTranslateables, ['label', 'description', 'placeholder', 'section', 'tab']);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/generateTranslations.js'), '-h'],
  {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  }
);

assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /Usage:\s+yarn script:translate/);

console.log('Translation helper behavior and native Node CLI smoke checks passed.');
