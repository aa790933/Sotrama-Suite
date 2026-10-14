import test from 'tape';
import { getSafeConfigDisplay, getSafeConfigDetail, parseMariaDBConfigString } from '../utils/mariadb-types';
import fs from 'fs';

const valid = {
  host: '192.168.1.10',
  port: 3306,
  user: 'sotrama_app',
  password: 'SuperSecret123!',
  database: 'sotrama',
};
const json = JSON.stringify(valid);

test('getSafeConfigDisplay never includes password', (t) => {
  const display = getSafeConfigDisplay(json);
  t.notOk(display.includes(valid.password), 'display must not contain password');
  t.ok(display.includes(valid.host), 'display contains host');
  t.ok(display.includes(valid.database), 'display contains database');
  t.ok(display.includes(valid.user), 'display contains user');
  t.notOk(display.includes('SuperSecret'), 'no secret substring');
  t.end();
});

test('getSafeConfigDetail never includes password', (t) => {
  const detail = getSafeConfigDetail(json);
  t.notOk(detail.includes(valid.password), 'detail must not contain password');
  t.ok(detail.includes(valid.host));
  t.ok(detail.includes(valid.database));
  t.end();
});

test('parse helper still works for valid config', (t) => {
  const parsed = parseMariaDBConfigString(json);
  t.equal(parsed.password, valid.password, 'parser retains password internally');
  t.end();
});

test('WindowsTitleBar does not render dbPath', (t) => {
  const vue = fs.readFileSync('src/components/WindowsTitleBar.vue', 'utf-8');
  t.notOk(vue.includes('{{ dbPath }}'), 'template must not interpolate dbPath');
  t.notOk(vue.includes('dbPath') && vue.includes('{{'), 'no dbPath binding in template');
  // Ensure it still shows companyName
  t.ok(vue.includes('companyName'), 'companyName still displayed');
  // Ensure safe display not accidentally showing password via title
  const hasPasswordBinding = /password/i.test(vue);
  t.notOk(hasPasswordBinding, 'no password in template');
  t.end();
});

test('DatabaseSelector uses safe display', (t) => {
  const vue = fs.readFileSync('src/pages/DatabaseSelector.vue', 'utf-8');
  t.ok(vue.includes('getSafeConfigDisplay'), 'uses safe display');
  t.ok(vue.includes('getSafeConfigDetail'), 'uses safe detail for dialog');
  t.notOk(vue.includes('{{ truncate(file.dbPath) }}'), 'old truncate(dbPath) removed');
  t.notOk(vue.includes('`Database location: ${file.dbPath}`'), 'old detail with raw dbPath removed');
  t.notOk(vue.includes('${file.dbPath}') && vue.includes('Database location'), 'no raw dbPath in dialog');
  t.end();
});

test('App fileSelected does not leak password in dialog', (t) => {
  const app = fs.readFileSync('src/App.vue', 'utf-8');
  // fileSelected should use getSafeConfigDetail, not raw filePath
  t.ok(app.includes('getSafeConfigDetail'), 'App uses safe detail');
  t.notOk(app.includes('Sotrama Suite does not have access to the selected file: ${filePath}'), 'old raw filePath message removed');
  t.end();
});
