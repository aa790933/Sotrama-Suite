import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [externalUrlPolicy, printDocumentPolicy] = await Promise.all([
  read('main/externalUrlPolicy.ts'),
  read('main/printDocumentPolicy.ts'),
]);

const [contract, adapter, router, sharedTypes, schemaIndex, rendererDb, rendererHandler, client, testRunner, pool, backup, rustMain, translations, translationBridge, buildScript, templates, templateBridge, utilityBridge, workflow, utilityTests, bootstrap, appPathResolver, appProtocolTests, apiService, apiClient, apiBridge, apiClientTests, policies, packageVerifier, architectureDocs, contactMothership, packageManifest, yarnLock, translationRuntime, translationHelpers, rendererMisc, lifecycle, electronBuilderConfig] = await Promise.all([
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
  read('main/getLanguageMap.ts'),
  read('build/scripts/build.mjs'),
  read('rust-backend/src/templates.rs'),
  read('main/getPrintTemplates.ts'),
  read('main/rustUtility.ts'),
  read('.github/workflows/rust-backend.yml'),
  read('scripts/verify-rust-utility-bridge.mjs'),
  read('main/bootstrap.ts'),
  read('main/resolveAppFilePath.ts'),
  read('tests/appProtocol.spec.ts'),
  read('rust-backend/src/api.rs'),
  read('main/rustApiClient.ts'),
  read('main/api.ts'),
  read('scripts/verify-rust-api-client.mjs'),
  read('main/ipc/policies.ts'),
  read('scripts/verify-rust-backend-package.mjs'),
  read('docs/architecture/rust-backend.md'),
  read('main/contactMothership.ts'),
  read('package.json'),
  read('yarn.lock'),
  read('fyo/utils/translation.ts'),
  read('utils/translationHelpers.ts'),
  read('src/utils/misc.ts'),
  read('main/registerAppLifecycleListeners.ts'),
  read('electron-builder-config.mjs'),
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
  'translation CSV parsing must remain in the Rust utility rather than the typed host adapter');
assert.match(utilityBridge, /safeUtilityEnvironment/,
  'Rust utility processes must not inherit database credentials or unrelated secrets');
assert.doesNotMatch(utilityBridge + translationBridge + templateBridge, /import\.meta\.url/,
  'Rust utility bridges must remain safe when esbuild bundles their ESM sources into the CommonJS Electron host');
assert.match(translationRuntime, /translationHelpers/,
  'the synchronous TypeScript translation runtime must use the shared typed helper');
assert.match(rendererHandler, /translationHelpers/,
  'the Fyo database handler must use the shared typed translation helper');
assert.match(rendererMisc, /translationHelpers/,
  'renderer translation metadata must use the shared typed helper');
assert.equal((translationHelpers.match(/export function getIndexFormat/g) ?? []).length, 1,
  'translation behavior must have one TypeScript implementation');
assert.equal((workflow.match(/- 'utils\/translationHelpers\.ts'/g) ?? []).length, 2,
  'translation helper changes must trigger both Rust workflow path filters');
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
assert.match(router, /from '\.\.\/getLanguageMap'/,
  'language-map IPC must use the typed Rust utility adapter');
assert.match(router, /from '\.\.\/getPrintTemplates'/,
  'print-template IPC must use the typed Rust utility adapter');
assert.match(buildScript, /Rust backend binary is required for packaging/,
  'packaged apps must contain the Rust translation utility instead of shipping a broken language-map path');
assert.match(bootstrap, /import \{ resolveAppFilePath \} from '\.\/resolveAppFilePath'/,
  'both Electron protocol handlers must use the single tested path resolver');
assert.equal((bootstrap.match(/function resolveAppFilePath\s*\(/g) ?? []).length, 0,
  'the Electron bootstrap must not retain a divergent inline path resolver');
assert.match(appPathResolver, /normalized\.startsWith\(baseDir \+ path\.sep\)/,
  'app protocol resolution must enforce normalized path containment');
assert.ok(appPathResolver.includes("replace(/\\\\/g, '/')"),
  'app protocol resolution must normalize Windows separators on every host');
assert.match(appProtocolTests, /encoded traversal/,
  'the app protocol regression suite must cover encoded traversal attempts');
assert.ok(workflow.includes("- 'main/**'") && workflow.includes("- 'tests/appProtocol.spec.ts'"),
  'host path-resolver changes and regression coverage must trigger Rust-boundary CI');
assert.match(rustMain, /if args\.serve_api[\s\S]*?return api::serve\(\)\.await/,
  'the ERPNext API server must dispatch before database credential validation');
assert.match(apiService, /MAX_REQUEST_BYTES/,
  'the Rust API server must bound incoming protocol frames');
assert.match(apiService, /MAX_BODY_BYTES/,
  'the Rust API server must bound request bodies');
assert.match(apiService, /MAX_RESPONSE_BYTES/,
  'the Rust API server must bound response bodies');
assert.match(apiService, /Policy::none\(\)/,
  'ERPNext API requests must not follow redirects to unvalidated targets');
assert.match(apiService, /MAX_CONCURRENT_REQUESTS/,
  'the Rust API server must bound concurrent network work');
assert.match(apiService, /acquire_owned\(\)\.await[\s\S]*?tokio::spawn/,
  'the Rust API server must apply backpressure before spawning work so queued tasks are bounded');
assert.match(apiService, /books_integration\.api\./,
  'the Rust API server must enforce the ERPNext integration path');
assert.match(apiService, /ApiPurpose::Telemetry[\s\S]*?Telemetry requests must use POST/,
  'telemetry requests must use a separate POST-only purpose');
assert.match(apiService, /Telemetry requests require an authorization header/,
  'the Rust telemetry transport must require its credential header');
assert.match(apiClient, /safeUtilityEnvironment\(baseEnv\)/,
  'the persistent API process must not inherit database credentials or unrelated secrets');
assert.match(apiClient, /maxPendingRequests/,
  'the persistent API client must bound outstanding requests');
assert.match(apiClient, /requestTimeoutMs/,
  'the persistent API client must time out requests');
assert.match(apiClient, /Rust service was restarted/,
  'the API bridge must terminate timed-out work instead of leaving network requests running');
assert.match(apiClient, /child\.once\('close', finish\)/,
  'Rust API shutdown must wait for child termination rather than only send a kill signal');
assert.match(apiClient, /Buffer\.concat\(\[this\.stdoutBuffer, fragment\]\)/,
  'the API bridge must bound individual frames without rejecting a chunk containing multiple responses');
assert.doesNotMatch(apiBridge, /node-fetch/,
  'the API adapter must not retain the legacy Node HTTP implementation');
assert.match(router, /from '\.\.\/api'/,
  'the IPC router must call the typed Rust HTTPS adapter directly');
assert.match(contactMothership, /sendTelemetryRequest\(errorLogUrl/,
  'main-process error telemetry must use the Rust HTTPS transport');
assert.match(lifecycle, /event\.preventDefault\(\)/,
  'Electron must wait for the Rust HTTPS child to shut down before completing application quit');
assert.match(lifecycle, /apiClientShutdownComplete[\s\S]*?app\.quit\(\)/,
  'Rust HTTPS shutdown must re-enter the quit flow only after the child cleanup settles');
assert.doesNotMatch(contactMothership, /node-fetch/,
  'the legacy Node fetch implementation must be removed from the telemetry sender');
const manifest = JSON.parse(packageManifest);
assert.equal(manifest.dependencies?.['node-fetch'], undefined,
  'the obsolete Node fetch runtime dependency must be removed after all callers migrate');
assert.equal(manifest.devDependencies?.['@types/node-fetch'], undefined,
  'the obsolete Node fetch type dependency must be removed after all callers migrate');
assert.doesNotMatch(yarnLock, /(?:^|\n)(?:"node-fetch@npm:2"|"@types\/node-fetch@npm:\^2\.6\.1"):/,
  'the lockfile must not retain obsolete direct Node fetch resolutions');
assert.match(router, /from '\.\.\/getLanguageMap'/,
  'the IPC router must call the typed Rust language-map adapter');
assert.match(router, /from '\.\.\/getPrintTemplates'/,
  'the IPC router must call the typed Rust print-template adapter');
assert.match(policies, /url\.pathname\.startsWith\('\/api\/method\/books_integration\.api\.'\)/,
  'the Electron IPC endpoint policy must validate the exact URL path, not a substring');
for (const behavior of ['correlates responses', 'before spawning', 'pending request cap', 'times out', 'malformed service frames', 'unknown response IDs', 'process exits and recovers', 'telemetry HTTPS POSTs']) {
  assert.ok(apiClientTests.includes(behavior), `Rust API client regression coverage must include ${behavior}`);
}
assert.match(testRunner, /verify-rust-api-client\.mjs/,
  'the default test command must execute Rust API client regressions');
assert.match(testRunner, /verify-preload-bridge\.mjs/,
  'the default test command must verify the typed preload bridge contract');
assert.match(workflow, /Verify Rust ERPNext API client contract/,
  'Rust CI must execute the ERPNext API client contract tests');
assert.match(packageVerifier, /output\.includes\('--serve-api'\)/,
  'packaged executable smoke checks must verify the API server mode is present');

for (const migratedModule of [
  'helpers',
  'printHtmlDocument',
  'registerAutoUpdaterListeners',
  'registerIpcMainMessageListeners',
  'registerProcessListeners',
  'resolveAppFilePath',
  'saveHtmlAsPdf',
]) {
  assert.ok(!existsSync(new URL(`../main/${migratedModule}.js`, import.meta.url)),
    `${migratedModule} must not retain a duplicate JavaScript application module`);
}
assert.doesNotMatch(externalUrlPolicy, /@param \{unknown\}/,
  'external URL policy must expose a typed TypeScript input contract');
assert.match(printDocumentPolicy, /html: unknown,[\s\S]*?width: unknown,[\s\S]*?height: unknown/,
  'print document policy must validate all runtime inputs independently of TypeScript callers');
assert.ok(!existsSync(new URL('../main/externalUrlPolicy.mjs', import.meta.url)),
  'external URL policy must not retain its JavaScript module');
assert.ok(!existsSync(new URL('../main/printDocumentPolicy.mjs', import.meta.url)),
  'print document policy must not retain its JavaScript module');
const mainJavaScriptFiles = readdirSync(new URL('../main/', import.meta.url), {
  recursive: true,
}).filter((file) => /\.(?:js|mjs|cjs)$/i.test(file));
assert.deepEqual(mainJavaScriptFiles, [],
  'Electron main application code must be TypeScript; JavaScript belongs only in tooling');
assert.match(buildScript, /!argv\.nopackage && !fs\.existsSync\(rustBackendPath\)/,
  'the real application packaging path must refuse to package without the native backend binary');
assert.match(electronBuilderConfig, /fs\.existsSync\(rustBackendPath\)[\s\S]*?from: rustBackendPath, to: rustBackendName/,
  'electron-builder copies the built native executable into the package Resources payload');
assert.match(electronBuilderConfig, /output: packageDirPath/,
  'the configured package output matches the native artifact verifier root');
assert.match(packageVerifier, /path\.resolve\('dist_electron', 'bundled'\)/,
  'the artifact verifier inspects the configured package output directory');
assert.match(workflow, /name: Build release binary[\s\S]*?name: Package Electron app directory with the Rust backend[\s\S]*?name: Verify packaged Rust backend resource and startup[\s\S]*?node scripts\/verify-rust-backend-package\.mjs/,
  'Rust CI builds the native executable, packages an Electron directory, and executes the packaged-resource smoke test in that order');
assert.match(architectureDocs, /long-lived HTTPS request service/,
  'the Rust backend architecture documentation must describe the database-independent API service');
for (const file of ['scripts/verify-rust-utility-bridge.mjs', 'scripts/verify-rust-api-client.mjs', 'scripts/verify-typed-renderer.mjs', 'build/scripts/build.mjs', 'electron-builder-config.mjs', 'scripts/verify-rust-backend-package.mjs']) {
  assert.ok(workflow.includes(`- '${file}'`), `Rust workflow path filters must include ${file}`);
}

for (const migratedBridge of [
  'api',
  'rustApiClient',
  'rustUtility',
  'getLanguageMap',
  'getPrintTemplates',
  'translationHelpers',
]) {
  for (const extension of ['mjs', 'cjs']) {
    assert.ok(!existsSync(new URL(`../main/${migratedBridge}.${extension}`, import.meta.url)),
      `${migratedBridge} must not retain a JavaScript ${extension.toUpperCase()} bridge`);
  }
}
for (const extension of ['mjs', 'cjs']) {
  assert.ok(!existsSync(new URL(`../utils/translationHelpers.${extension}`, import.meta.url)),
    `translationHelpers must not retain a JavaScript ${extension.toUpperCase()} implementation`);
}

console.log('Rust backend boundary checks passed.');
