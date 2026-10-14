import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [contract, adapter, router, sharedTypes, schemaIndex, rendererDb, rendererHandler, client, testRunner] = await Promise.all([
  read('main/ipc/databaseContract.ts'),
  read('main/ipc/rustDatabaseAdapter.ts'),
  read('main/ipc/router.ts'),
  read('utils/db/types.ts'),
  read('schemas/index.ts'),
  read('fyo/database/Database.ts'),
  read('fyo/core/dbHandler.ts'),
  read('main/ipc/rustBackendClient.ts'),
  read('scripts/test.sh'),
]);

assert.match(contract, /export interface RouterDatabase/,
  'the Electron database contract must have a backend-independent owner');
assert.match(sharedTypes, /export type FieldValueMap/,
  'database value maps must be shared outside backend implementation modules');
assert.match(adapter, /from '\.\/databaseContract'/,
  'the Rust adapter must implement the shared database contract');
assert.match(router, /from '\.\/databaseContract'/,
  'the production router must depend on the shared contract');
assert.doesNotMatch(adapter, /from ['"][^'"]*backend\/database\/(?:core|types)['"]/, 
  'the Rust adapter must not depend on legacy database implementation modules');
assert.doesNotMatch(router, /import\s+type\s+\{?\s*FieldValueMap\s*\}?\s+from ['"][^'"]*backend\/database\/types['"]/, 
  'the production router must not source contracts from legacy database types');
assert.doesNotMatch(schemaIndex, /from ['"]backend\/database\/types['"]/,
  'schema registry must not depend on legacy backend type modules');
assert.doesNotMatch(rendererDb, /from ['"]backend\/database\/types['"]/, 
  'renderer database contracts must not depend on legacy backend type modules');
assert.doesNotMatch(rendererHandler, /from ['"]backend\/database\/types['"]/, 
  'renderer database handlers must not depend on legacy backend type modules');
assert.match(client, /maxPendingRequests/,
  'the sidecar client must bound concurrent pending RPC requests');
assert.match(client, /split\(config\.password\)\.join\('\[REDACTED\]'\)/,
  'sidecar diagnostics must redact database credentials');
assert.match(testRunner, /main\/ipc\/\*\.spec\.ts/,
  'the default test command must execute IPC boundary regression specs');
assert.match(testRunner, /verify-csv-parser\.mjs/,
  'the default test command must execute the CSV parser regression');
assert.match(testRunner, /verify-translation-generator\.mjs/,
  'the default test command must execute translation helper and CLI regressions');

console.log('Rust backend boundary checks passed.');
