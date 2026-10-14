import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [runtime, declaration, buildHelpers, hostTests, bootstrap, router, rendererListeners, rendererEntry, htmlEntry] = await Promise.all([
  read('main/preload.js'),
  read('main/preload.d.ts'),
  read('build/scripts/helpers.mjs'),
  read('tests/hostClient.flow.spec.ts'),
  read('main/bootstrap.ts'),
  read('main/ipc/router.ts'),
  read('src/renderer/registerIpcRendererListeners.js'),
  read('src/renderer.js'),
  read('src/index.html'),
]);

for (const method of [
  'getCreds', 'getLanguageMap', 'getTemplates', 'selectFile', 'getSaveFilePath',
  'getOpenFilePath', 'checkDbAccess', 'upsertConnection', 'deleteFile', 'saveData',
  'makePDF', 'printDocument', 'getDbList', 'getLanIp', 'checkDbExists',
  'createDatabase', 'provisionMariaDB', 'pingMariaDB', 'getEnv', 'sendAPIRequest',
  'registerMainProcessErrorListener', 'registerTriggerFrontendActionListener',
  'registerConsoleLogListener',
]) {
  assert.match(runtime, new RegExp(`\\b${method}\\s*\\(`), `runtime preload exposes ${method}`);
  assert.match(declaration, new RegExp(`\\b${method}\\s*:`), `IPC declaration includes ${method}`);
}

assert.match(runtime, /contextBridge\.exposeInMainWorld\('ipc', ipc\)/,
  'the preload exposes only the curated IPC facade through contextBridge');
assert.doesNotMatch(runtime, /exposeInMainWorld\(['"]ipcRenderer['"]|exposeInMainWorld\(['"]require['"]|nodeIntegration\s*:\s*true/,
  'the preload must not expose raw Electron IPC or Node require');
assert.match(runtime, /key === 'connections'[\s\S]*?connections must be set via main process/,
  'renderer writes of credential-bearing connections remain blocked');
assert.match(runtime, /key === 'connections'[\s\S]*?toSafeDisplay\(c\)/,
  'connection reads expose safe metadata rather than persisted passwords');
assert.match(runtime, /if \(key === 'connections'\)[\s\S]*?if \(!Array\.isArray\(value\)\)[\s\S]*?return \[\]/,
  'malformed persisted connection values fail closed instead of reaching the renderer');
assert.match(runtime, /value\.trimStart\(\)\.startsWith\('\{'\)[\s\S]*?return found\?\.id \?\? null[\s\S]*?return null/,
  'serialized or malformed connection credentials never fall through as raw renderer values');
assert.match(declaration, /get: \(key: 'connections'\) => ConnectionMetadata\[\]/,
  'the public IPC type models connection reads as password-free metadata');
assert.match(declaration, /set: <K extends Exclude<keyof ConfigMap, 'connections'>>/,
  'the public IPC type prevents direct writes of credential-bearing connections');
assert.match(buildHelpers, /path\.join\(root, 'main', 'preload\.js'\)/,
  'esbuild uses the JavaScript preload runtime as its entrypoint');
assert.doesNotMatch(buildHelpers, /path\.join\(root, 'main', 'preload\.ts'\)/,
  'the deleted TypeScript preload is not a build input');
assert.match(hostTests, /readFileSync\('main\/preload\.js'/,
  'host onboarding regression tests inspect the runtime preload file');
assert.match(bootstrap, /registerAppLifecycleListeners\.js/,
  'Electron bootstrap imports the JavaScript lifecycle implementation');
assert.match(router, /contactMothership/,
  'IPC telemetry callers remain connected to the migrated telemetry implementation');
for (const listener of ['registerMainProcessErrorListener', 'registerTriggerFrontendActionListener', 'registerConsoleLogListener']) {
  assert.match(rendererListeners, new RegExp(`ipc\\.${listener}\\s*\\(`),
    `renderer JavaScript listener registers ${listener}`);
}
assert.match(rendererListeners, /syncDocumentsToERPNext\(fyo\)/,
  'the renderer keeps ERPNext synchronization on the intended IPC-triggered path');
assert.match(rendererListeners, /fyo\.telemetry\.stop\(\)/,
  'the renderer stops telemetry when the document becomes hidden');
assert.match(rendererEntry, /registerIpcRendererListeners\(\)/,
  'the Vue renderer entrypoint installs its IPC listeners');
assert.match(rendererEntry, /app\.mount\('body'\)/,
  'the JavaScript renderer entrypoint still mounts the Vue application');
assert.match(htmlEntry, /src="\.\/renderer\.js"/,
  'the renderer HTML entry points to JavaScript, not the deleted TypeScript implementation');
assert.doesNotMatch(htmlEntry, /renderer\.ts/,
  'the HTML entry no longer depends on a TypeScript implementation');

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert.equal(config.error, undefined, 'TypeScript config parses for the preload type regression');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const probePath = path.resolve('__preload_contract_check__.ts');
const probeSource = `
import type { IPC } from './main/preload';
import type { ConnectionMetadata } from './utils/mariadb-types';
declare const ipc: IPC;
const metadata: ConnectionMetadata | undefined = ipc.store.get('connections')?.[0];
void metadata?.display;
// @ts-expect-error renderer writes of credential-bearing connections are forbidden
ipc.store.set('connections', []);
// @ts-expect-error the public connection metadata must never include a password
metadata?.password;
`;
const host = ts.createCompilerHost(parsed.options);
const originalReadFile = host.readFile.bind(host);
const originalGetSourceFile = host.getSourceFile.bind(host);
host.readFile = (fileName) => path.resolve(fileName) === probePath
  ? probeSource
  : originalReadFile(fileName);
host.getSourceFile = (fileName, languageVersion, ...rest) => path.resolve(fileName) === probePath
  ? ts.createSourceFile(fileName, probeSource, languageVersion, true)
  : originalGetSourceFile(fileName, languageVersion, ...rest);
const typeProgram = ts.createProgram({ rootNames: [probePath], options: parsed.options, host });
const probeDiagnostics = ts.getPreEmitDiagnostics(typeProgram)
  .filter((diagnostic) => diagnostic.file && path.resolve(diagnostic.file.fileName) === probePath);
assert.equal(probeDiagnostics.length, 0,
  probeDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));

console.log('Preload bridge contract checks passed.');
