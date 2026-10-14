import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  process.execPath,
  [
    '-r',
    'ts-node/register/transpile-only',
    '-r',
    'tsconfig-paths/register',
    path.join(root, 'scripts/generateTranslations.js'),
    '-h',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs"}',
      TS_NODE_TRANSPILE_ONLY: 'true',
    },
  }
);

assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /Usage:\s+yarn script:translate/);

console.log('Translation generator CLI smoke check passed.');
