import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [contract, adapter, router, sharedTypes, schemaIndex, rendererDb, rendererHandler, client, testRunner, pool, backup, rustMain, translations, translationBridge, buildScript, templates, templateBridge, utilityBridge, workflow, utilityTests] = await Promise.all([
  read('main/ipc/databaseContract.ts'),
  read('main/ipc/rustDatabaseAdapter.ts'),
  read('main/ipc/router.ts'),
  read('utils/db/types.ts'),
  read('schemas/index.ts'),
  read('fyo/database/Database.ts'),
  read('fyo/core/dbHandler.ts'),
  read('main/ipc/rustBackendClient.ts'),
  read('scripts/test.sh'),
  read('rust-backend/src/database/pool.rs'),
  read('rust-backend/src/database/backup.rs'),
  read('rust-backend/src/main.rs'),
  read('rust-backend/src/translations.rs'),
  read('main/getLanguageMap.mjs'),
  read('build/scripts/build.mjs'),
  read('rust-backend/src/templates.rs'),
  read('main/getPrintTemplates.mjs'),
  read('main/rustUtility.mjs'),
  read('.github/workflows/rust-backend.yml'),
  read('scripts/verify-rust-utility-bridge.mjs'),
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
assert.match(pool, /\.ssl_mode\(ssl_mode_from_env\(\)\?\)/,
  'normal database connections must use the validated TLS policy');
assert.match(pool, /SOTRAMA_DB_SSL_MODE/,
  'the TLS policy must be explicitly configurable');
assert.equal((backup.match(/ssl_mode\(super::pool::ssl_mode_from_env\(\)\?\)/g) ?? []).length, 2,
  'backup administration and restored-database verification connections must use the same TLS policy');
assert.equal((backup.match(/configure_client_ssl\(&mut command\)\?/g) ?? []).length, 2,
  'dump and restore subprocesses must use the same TLS policy');
assert.match(rustMain, /tokio::signal::ctrl_c\(\)/,
  'the serving process must handle Ctrl-C for graceful pool shutdown');
assert.match(rustMain, /if let Some\(code\) = args\.language_map\.as_deref\(\)/,
  'the translation utility must execute before any database connection is opened');
assert.match(rustMain, /password: Option<String>/,
  'standalone Rust utilities must not require database credentials');
assert.match(rustMain, /SOTRAMA_DB_PASSWORD is required for database operations/,
  'database commands must still validate required credentials after utility dispatch');
assert.match(translations, /MAX_TRANSLATION_BYTES/,
  'Rust translation loading must bound translation-file size');
assert.match(translations, /unterminated quoted field/,
  'malformed CSV quoting must fail closed');
assert.doesNotMatch(translationBridge, /from ['"]utils\/csvParser/,
  'translation CSV parsing must not remain duplicated in the JavaScript bridge');
assert.match(utilityBridge, /safeUtilityEnvironment/,
  'Rust utility processes must not inherit database credentials or unrelated secrets');
assert.match(utilityBridge, /MAX_OUTPUT_BYTES/,
  'Rust utility output must be bounded before JSON parsing');
assert.match(utilityBridge, /dependencies\.spawnProcess/,
  'the Rust utility process seam must permit deterministic failure-path tests');
for (const behavior of ['safeUtilityEnvironment', 'timed-out child', 'nonzero exit', 'exceeding the hard cap', 'malformed JSON']) {
  assert.ok(utilityTests.includes(behavior), `Rust utility bridge regression coverage must include ${behavior}`);
}
assert.match(testRunner, /verify-rust-utility-bridge\.mjs/,
  'the default test command must execute Rust utility bridge regressions');
assert.match(templates, /MAX_TOTAL_TEMPLATE_BYTES/,
  'Rust template loading must bound aggregate resource size');
assert.match(templateBridge, /--print-templates/,
  'Electron template requests must be delegated to the Rust utility');
assert.match(router, /from '\.\.\/getLanguageMap\.mjs'/,
  'language-map IPC must use the JavaScript bridge to Rust');
assert.match(router, /from '\.\.\/getPrintTemplates\.mjs'/,
  'print-template IPC must use the JavaScript bridge to Rust');
assert.match(buildScript, /Rust backend binary is required for packaging/,
  'packaged apps must contain the Rust translation utility instead of shipping a broken language-map path');
for (const file of ['main/getLanguageMap.mjs', 'main/getPrintTemplates.mjs', 'main/rustUtility.mjs', 'scripts/verify-rust-utility-bridge.mjs', 'build/scripts/build.mjs']) {
  assert.ok(workflow.includes(`- '${file}'`), `Rust workflow path filters must include ${file}`);
}

console.log('Rust backend boundary checks passed.');
