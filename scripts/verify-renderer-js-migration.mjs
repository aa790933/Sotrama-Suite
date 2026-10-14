import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [errorHandling, rendererMisc, sharedMisc, uiUtilities, interactive, colors, refs, docUtilities, vueUtilities, shortcuts, rendererEntry, workflow, testRunner] = await Promise.all([
  read('src/errorHandling.js'),
  read('src/utils/misc.js'),
  read('utils/misc.js'),
  read('src/utils/ui.js'),
  read('src/utils/interactive.js'),
  read('src/utils/colors.js'),
  read('src/utils/refs.js'),
  read('src/utils/doc.js'),
  read('src/utils/vueUtils.js'),
  read('src/utils/shortcuts.js'),
  read('src/renderer.js'),
  read('.github/workflows/rust-backend.yml'),
  read('scripts/test.sh'),
]);
const { evaluateHidden, evaluateInvisible, evaluateReadOnly, evaluateRequired } = await import(
  `data:text/javascript;base64,${Buffer.from(docUtilities).toString('base64')}`
);

for (const name of ['sendError', 'getErrorLogObject', 'handleError', 'handleErrorWithDialog',
  'showErrorDialog', 'getErrorHandled', 'getErrorHandledSync', 'reportIssue']) {
  assert.match(errorHandling, new RegExp(`export (?:async )?function ${name}\\b`),
    `renderer error handling retains ${name}`);
}

for (const name of ['getDatesAndPeriodList', 'getSetupWizardDoc', 'updateConfigFiles', 'docsPathMap',
  'getDataURL', 'convertFileToDataURL', 'getCreateFiltersFromListViewFilters', 'getIsMac', 'getReport']) {
  assert.match(rendererMisc, new RegExp(`export (?:async )?(?:function|const) ${name}\\b`),
    `Vue shared utilities retain ${name}`);
}

for (const name of ['getCountryInfo', 'getCountryCodeFromCountry', 'getFiscalYear', 'logUnexpected']) {
  assert.match(sharedMisc, new RegExp(`export function ${name}\\b`),
    `shared country/date/event utilities retain ${name}`);
}

for (const name of ['openQuickEdit', 'openSettings', 'routeTo', 'deleteDocWithPrompt',
  'getFieldsGroupedByTabAndSection', 'getFormRoute', 'focusOrSelectFormControl',
  'commonDocSubmit', 'commonDocSync', 'getShortcutKeyMap', 'commongDocDelete',
  'printSizes', 'paperSizeMap', 'deleteDb', 'getSavePath']) {
  assert.match(uiUtilities, new RegExp(`export (?:async )?(?:function|const) ${name}\\b`),
    `Vue UI utility behavior retains ${name}`);
}
assert.match(uiUtilities, /export var ShortcutKey;/,
  'the ShortcutKey enum remains a runtime export for Vue shortcut components');
assert.match(uiUtilities, /handleErrorWithDialog/,
  'UI actions keep the migrated renderer error-reporting path');
for (const name of ['showDialog', 'showToast', 'getIconConfig']) {
  assert.match(interactive, new RegExp(`export (?:async )?function ${name}\\b`),
    `Vue interaction helpers retain ${name}`);
}
for (const name of ['uicolors', 'indicators', 'getBgColorClass', 'getColorClass', 'getTextColorClass', 'getBgTextColorClass']) {
  assert.match(colors, new RegExp(`export (?:function|const) ${name}\\b`),
    `shared UI colors retain ${name}`);
}
for (const name of ['showSidebar', 'docsPathRef', 'systemLanguageRef', 'historyState']) {
  assert.match(refs, new RegExp(`export const ${name}\\b`),
    `shared Vue refs retain ${name}`);
}
for (const name of ['evaluateReadOnly', 'evaluateHidden', 'evaluateInvisible', 'evaluateRequired', 'getLinkedEntries']) {
  assert.match(docUtilities, new RegExp(`export (?:async )?function ${name}\\b`),
    `document field/relationship helpers retain ${name}`);
}
for (const name of ['useKeys', 'useMouseLocation', 'useDocShortcuts']) {
  assert.match(vueUtilities, new RegExp(`export function ${name}\\b`),
    `Vue lifecycle composables retain ${name}`);
}
assert.match(shortcuts, /export class Shortcuts/,
  'the context-scoped keyboard shortcut registry remains a runtime class');

assert.match(errorHandling, /shouldStore \?\? true/,
  'errors explicitly marked non-persistent remain excluded from telemetry');
assert.match(errorHandling, /await ipc\.sendError\(JSON\.stringify\(body\)\)/,
  'renderer telemetry still crosses the curated IPC bridge');
assert.match(errorHandling, /await showDialog\(options\)/,
  'error dialogs retain their existing Vue interaction path');
assert.match(rendererMisc, /ipc\.upsertConnection\(/,
  'configuration migration still persists credentials through main-process ownership');
assert.match(rendererMisc, /fyo\.db\.dbPath = connId/,
  'the renderer continues to replace raw database credentials with a connection ID');
assert.match(rendererMisc, /translationHelpers\.cjs/,
  'the renderer keeps its CommonJS-compatible translation metadata dependency');
assert.match(sharedMisc, /CUSTOM_EVENTS\.LOG_UNEXPECTED/,
  'unexpected errors still use the shared renderer event contract');

assert.equal(evaluateReadOnly({ fieldname: 'numberSeries' }, { inserted: true }), true,
  'inserted documents keep number-series fields read-only');
assert.equal(evaluateReadOnly({ fieldname: 'name' }, { inserted: false, schema: { naming: 'series' } }), true,
  'non-manually named documents keep their name field read-only');
assert.equal(evaluateReadOnly({ fieldname: 'amount' }, { isSubmitted: true }), true,
  'submitted documents remain read-only');
assert.equal(evaluateHidden({ fieldname: 'secret', hidden: true }), true,
  'schema-hidden fields remain hidden');
assert.equal(evaluateInvisible({ fieldname: 'amount', invisible: false }), false,
  'explicit visibility metadata takes precedence');
assert.equal(evaluateRequired({ fieldname: 'amount', required: true }), true,
  'schema-required fields remain required');
assert.equal(evaluateHidden({ fieldname: 'custom' }, { hidden: { custom: () => true } }), true,
  'document-specific field metadata callbacks remain supported');
assert.match(rendererEntry, /from '\.\/errorHandling'/,
  'the JavaScript renderer entry uses the migrated error handler');
assert.match(testRunner, /verify-renderer-js-migration\.mjs/,
  'the default test command runs renderer migration regressions');

for (const file of ['src/errorHandling.ts', 'src/utils/misc.ts', 'utils/misc.ts', 'src/utils/ui.ts',
  'src/utils/interactive.ts', 'src/utils/colors.ts', 'src/utils/refs.ts', 'src/utils/doc.ts',
  'src/utils/vueUtils.ts', 'src/utils/shortcuts.ts']) {
  await assert.rejects(access(new URL(`../${file}`, import.meta.url)),
    { code: 'ENOENT' }, `${file} no longer exists as a duplicate TypeScript implementation`);
}

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert.equal(config.error, undefined, 'TypeScript config parses for module-resolution regressions');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const consumers = [
  ['src/renderer.js', './errorHandling', 'src/errorHandling.js'],
  ['src/renderer/registerIpcRendererListeners.js', 'src/errorHandling', 'src/errorHandling.js'],
  ['src/utils/ui.js', 'src/errorHandling', 'src/errorHandling.js'],
  ['src/App.vue', 'src/utils/misc', 'src/utils/misc.js'],
  ['src/pages/Report.vue', 'src/utils/misc', 'src/utils/misc.js'],
  ['src/pages/DatabaseSelector.vue', 'src/utils/misc', 'src/utils/misc.js'],
  ['src/utils/vueUtils.ts', './ui', 'src/utils/ui.js'],
  ['src/utils/search.ts', './ui', 'src/utils/ui.js'],
  ['src/utils/ui.js', './interactive', 'src/utils/interactive.js'],
  ['src/utils/ui.js', './colors', 'src/utils/colors.js'],
  ['src/utils/ui.js', './doc', 'src/utils/doc.js'],
  ['src/utils/ui.js', './refs', 'src/utils/refs.js'],
  ['src/utils/interactive.js', './colors', 'src/utils/colors.js'],
  ['src/utils/vueUtils.ts', './shortcuts', 'src/utils/shortcuts.js'],
  ['src/utils/shortcuts.js', './misc', 'src/utils/misc.js'],
  ['src/components/Toast.vue', 'src/utils/ui', 'src/utils/ui.js'],
  ['src/components/ShortcutsHelper.vue', 'src/utils/ui', 'src/utils/ui.js'],
  ['tests/helpers.ts', 'utils/misc', 'utils/misc.js'],
  ['models/baseModels/SetupWizard/SetupWizard.ts', 'utils/misc', 'utils/misc.js'],
];

for (const [consumer, specifier, expected] of consumers) {
  const result = ts.resolveModuleName(specifier, path.resolve(consumer), parsed.options, ts.sys).resolvedModule;
  assert.ok(result, `${consumer} resolves ${specifier}`);
  assert.equal(path.relative(process.cwd(), result.resolvedFileName).replaceAll('\\', '/'), expected,
    `${consumer} resolves to the JavaScript implementation`);
}

for (const trigger of ["'src/errorHandling.js'", "'src/utils/**'", "'utils/misc.js'"]) {
  const escapedTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.equal((workflow.match(new RegExp(escapedTrigger, 'g')) ?? []).length, 2,
    `${trigger} triggers both Rust-backend workflow path filters`);
}

console.log('Renderer/shared JavaScript migration checks passed.');
