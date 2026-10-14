import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const typedModules = [
  'src/errorHandling',
  'src/renderer',
  'src/renderer/registerIpcRendererListeners',
  'src/utils/colors',
  'src/utils/doc',
  'src/utils/interactive',
  'src/utils/misc',
  'src/utils/refs',
  'src/utils/shortcuts',
  'src/utils/ui',
  'src/utils/vueUtils',
  'utils/misc',
];

const [errorHandling, rendererMisc, sharedMisc, uiUtilities, interactive, colors, refs,
  docUtilities, vueUtilities, shortcuts, rendererEntry, workflow, testRunner] = await Promise.all([
  read('src/errorHandling.ts'),
  read('src/utils/misc.ts'),
  read('utils/misc.ts'),
  read('src/utils/ui.ts'),
  read('src/utils/interactive.ts'),
  read('src/utils/colors.ts'),
  read('src/utils/refs.ts'),
  read('src/utils/doc.ts'),
  read('src/utils/vueUtils.ts'),
  read('src/utils/shortcuts.ts'),
  read('src/renderer.ts'),
  read('.github/workflows/rust-backend.yml'),
  read('scripts/test.sh'),
]);

for (const modulePath of typedModules) {
  await access(new URL(`../${modulePath}.ts`, import.meta.url));
  await assert.rejects(access(new URL(`../${modulePath}.js`, import.meta.url)),
    { code: 'ENOENT' }, `${modulePath}.js must not duplicate its TypeScript source`);
}

for (const name of ['sendError', 'getErrorLogObject', 'handleError', 'handleErrorWithDialog',
  'showErrorDialog', 'getErrorHandled', 'getErrorHandledSync', 'reportIssue']) {
  assert.match(errorHandling, new RegExp(`export (?:async )?function ${name}\\b`),
    `typed renderer error handling retains ${name}`);
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
    `typed Vue UI utilities retain ${name}`);
}
assert.match(uiUtilities, /export enum ShortcutKey|export var ShortcutKey/,
  'ShortcutKey remains a typed runtime export for Vue shortcut components');
for (const name of ['showDialog', 'showToast', 'getIconConfig']) {
  assert.match(interactive, new RegExp(`export (?:async )?function ${name}\\b`),
    `Vue interaction helpers retain ${name}`);
}
for (const name of ['uicolors', 'indicators', 'getBgColorClass', 'getColorClass', 'getTextColorClass', 'getBgTextColorClass']) {
  assert.match(colors, new RegExp(`export (?:function|const) ${name}\\b`),
    `shared UI colors retain ${name}`);
}
for (const name of ['showSidebar', 'docsPathRef', 'systemLanguageRef', 'historyState']) {
  assert.match(refs, new RegExp(`export const ${name}\\b`), `shared Vue refs retain ${name}`);
}
for (const name of ['evaluateReadOnly', 'evaluateHidden', 'evaluateInvisible', 'evaluateRequired', 'getLinkedEntries']) {
  assert.match(docUtilities, new RegExp(`export (?:async )?function ${name}\\b`),
    `document field/relationship helpers retain ${name}`);
}
for (const name of ['useKeys', 'useMouseLocation', 'useDocShortcuts']) {
  assert.match(vueUtilities, new RegExp(`export function ${name}\\b`),
    `Vue lifecycle composables retain ${name}`);
}
assert.match(shortcuts, /export class Shortcuts/, 'the keyboard shortcut registry remains typed');
assert.match(errorHandling, /shouldStore \?\? true/, 'non-persistent errors remain excluded from telemetry');
assert.match(errorHandling, /await ipc\.sendError\(JSON\.stringify\(body\)\)/,
  'renderer telemetry still crosses the curated IPC bridge');
assert.match(rendererMisc, /ipc\.upsertConnection\(/,
  'connection credentials still persist through main-process ownership');
assert.match(sharedMisc, /CUSTOM_EVENTS\.LOG_UNEXPECTED/,
  'unexpected errors still use the shared renderer event contract');
assert.match(rendererEntry, /registerIpcRendererListeners\(\)/,
  'the typed renderer entry installs IPC listeners');

// The document helper imports its dependencies only for types. Transpile that
// one module in memory so the field-rule regression remains a runtime check.
const transpiledDoc = ts.transpileModule(docUtilities, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'src/utils/doc.ts',
}).outputText;
assert.doesNotMatch(transpiledDoc, /^import\s/m,
  'document utility type imports erase cleanly from the runtime module');
const { evaluateHidden, evaluateInvisible, evaluateReadOnly, evaluateRequired } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiledDoc).toString('base64')}`
);
assert.equal(evaluateReadOnly({ fieldname: 'numberSeries' }, { inserted: true }), true);
assert.equal(evaluateReadOnly({ fieldname: 'name' }, { inserted: false, schema: { naming: 'series' } }), true);
assert.equal(evaluateReadOnly({ fieldname: 'amount' }, { isSubmitted: true }), true);
assert.equal(evaluateHidden({ fieldname: 'secret', hidden: true }), true);
assert.equal(evaluateInvisible({ fieldname: 'amount', invisible: false }), false);
assert.equal(evaluateRequired({ fieldname: 'amount', required: true }), true);
assert.equal(evaluateHidden({ fieldname: 'custom' }, { hidden: { custom: () => true } }), true);

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert.equal(config.error, undefined, 'TypeScript config parses for module-resolution regressions');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
for (const [consumer, specifier, expected] of [
  ['src/renderer.ts', './errorHandling', 'src/errorHandling.ts'],
  ['src/renderer/registerIpcRendererListeners.ts', 'src/errorHandling', 'src/errorHandling.ts'],
  ['src/utils/ui.ts', 'src/errorHandling', 'src/errorHandling.ts'],
  ['src/App.vue', 'src/utils/misc', 'src/utils/misc.ts'],
  ['src/pages/Report.vue', 'src/utils/misc', 'src/utils/misc.ts'],
  ['src/pages/DatabaseSelector.vue', 'src/utils/misc', 'src/utils/misc.ts'],
  ['src/utils/vueUtils.ts', './ui', 'src/utils/ui.ts'],
  ['src/utils/search.ts', './ui', 'src/utils/ui.ts'],
  ['src/utils/ui.ts', './interactive', 'src/utils/interactive.ts'],
  ['src/utils/ui.ts', './colors', 'src/utils/colors.ts'],
  ['src/utils/ui.ts', './doc', 'src/utils/doc.ts'],
  ['src/utils/ui.ts', './refs', 'src/utils/refs.ts'],
  ['src/utils/interactive.ts', './colors', 'src/utils/colors.ts'],
  ['src/utils/vueUtils.ts', './shortcuts', 'src/utils/shortcuts.ts'],
  ['src/utils/shortcuts.ts', './misc', 'src/utils/misc.ts'],
  ['src/components/Toast.vue', 'src/utils/ui', 'src/utils/ui.ts'],
  ['src/components/ShortcutsHelper.vue', 'src/utils/ui', 'src/utils/ui.ts'],
  ['tests/helpers.ts', 'utils/misc', 'utils/misc.ts'],
  ['models/baseModels/SetupWizard/SetupWizard.ts', 'utils/misc', 'utils/misc.ts'],
]) {
  const result = ts.resolveModuleName(specifier, path.resolve(consumer), parsed.options, ts.sys).resolvedModule;
  assert.ok(result, `${consumer} resolves ${specifier}`);
  assert.equal(path.relative(process.cwd(), result.resolvedFileName).replaceAll('\\', '/'), expected,
    `${consumer} resolves to the typed implementation`);
}

assert.match(testRunner, /verify-typed-renderer\.mjs/,
  'the default test command runs the typed renderer regression verifier');
assert.equal((workflow.match(/'scripts\/verify-typed-renderer\.mjs'/g) ?? []).length, 2,
  'the typed renderer verifier is present in both CI path filters');
console.log('Typed renderer boundary checks passed.');
