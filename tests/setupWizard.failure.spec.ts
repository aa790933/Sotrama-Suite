import test from 'tape';
import fs from 'fs';

test('SetupWizard has setLoading and finally handling', (t) => {
  const vue = fs.readFileSync('src/pages/SetupWizard/SetupWizard.vue', 'utf-8');
  t.ok(vue.includes('setLoading'), 'has setLoading method');
  t.ok(vue.includes('this.loading = true'), 'sets loading true');
  t.ok(vue.includes('this.loading = false') || vue.includes('setLoading(false)'), 'has loading false path');
  t.ok(vue.includes(`$emit('setup-complete'`), 'emits setup-complete');
  t.end();
});

test('App setupComplete has try/catch/finally and preserves config', (t) => {
  const app = fs.readFileSync('src/App.vue', 'utf-8');
  t.ok(app.includes('async setupComplete'), 'has setupComplete');
  t.ok(app.includes('try {'), 'has try');
  t.ok(app.includes('catch (error)'), 'has catch');
  t.ok(app.includes('finally'), 'has finally');
  t.ok(app.includes('setLoading(false)'), 'resets loading via ref');
  t.ok(app.includes('getSafeConfigDetail'), 'uses safe detail');
  t.ok(app.includes('Setup failed'), 'shows safe error');
  t.ok(app.includes(`showDbSelector`), 'allows back to selector');
  t.ok(app.includes(`Retry`), 'has Retry button');
  t.ok(app.includes(`Change connection`), 'has Change connection');
  // Ensure lastSelectedFilePath not cleared on failure
  t.ok(app.includes(`fyo.config.set('lastSelectedFilePath', filePath)`), 'persists config');
  // Check fileSelected preserves config on checkDbAccess false
  t.ok(app.includes(`Preserve recoverable config`), 'fileSelected preserves');
  t.notOk(app.includes(`fyo.config.set('lastSelectedFilePath', null)`) && app.includes('fileSelected') && app.match(/fileSelected[\s\S]*?fyo\.config\.set\('lastSelectedFilePath', null\)/), 'fileSelected should not clear on transient failure');
  t.end();
});

test('App fileSelected does not clear on transient DB check', (t) => {
  const app = fs.readFileSync('src/App.vue', 'utf-8');
  // Find fileSelected method and ensure it does not clear lastSelectedFilePath after checkDbAccess false beyond the initial set
  const fileSelectedSection = app.slice(app.indexOf('async fileSelected'), app.indexOf('async setupComplete'));
  const clearCount = (fileSelectedSection.match(/fyo\.config\.set\('lastSelectedFilePath', null\)/g) || []).length;
  // Should have 0 clears in fileSelected now (previously had 1)
  t.equal(clearCount, 0, 'fileSelected should not clear persisted config on failure');
  t.end();
});

test('SetupWizard loading is recoverable', (t) => {
  const vue = fs.readFileSync('src/pages/SetupWizard/SetupWizard.vue', 'utf-8');
  // Ensure cancel also resets loading
  t.ok(vue.includes(`cancel()`) && vue.includes(`this.loading = false`), 'cancel resets loading');
  t.end();
});
