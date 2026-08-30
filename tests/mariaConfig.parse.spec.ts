import test from 'tape';
import {
  getSafeConfigDetail,
  getSafeConfigDisplay,
  parseMariaDBConfigString,
} from '../utils/mariadb-types';

const valid = {
  host: '127.0.0.1',
  port: 3306,
  user: 'sotrama_app',
  password: 'secret',
  database: 'sotrama',
};

test('parseMariaDBConfigString accepts valid JSON string', (t) => {
  const json = JSON.stringify(valid);
  const parsed = parseMariaDBConfigString(json);
  t.deepEqual(parsed, valid, 'round-trip via HostSetup JSON.stringify');
  t.end();
});

test('parseMariaDBConfigString rejects non-string input', (t) => {
  t.throws(() => parseMariaDBConfigString(valid as unknown as string), /JSON string/, 'object input rejected');
  t.throws(() => parseMariaDBConfigString(undefined as unknown as string), /JSON string/);
  t.end();
});

test('parseMariaDBConfigString rejects malformed JSON', (t) => {
  t.throws(() => parseMariaDBConfigString('{not json'), SyntaxError);
  t.throws(() => parseMariaDBConfigString('[object Object]'), SyntaxError);
  t.end();
});

test('parseMariaDBConfigString rejects missing required fields', (t) => {
  const missingHost = JSON.stringify({ ...valid, host: '' });
  t.throws(() => parseMariaDBConfigString(missingHost), /Invalid MariaDBConfig/);

  const missingPort = JSON.stringify({ ...valid, port: '3306' });
  t.throws(() => parseMariaDBConfigString(missingPort), /Invalid MariaDBConfig/);

  const missingUser = JSON.stringify({ ...valid, user: '' });
  t.throws(() => parseMariaDBConfigString(missingUser), /Invalid MariaDBConfig/);

  const missingDatabase = JSON.stringify({ ...valid, database: '' });
  t.throws(() => parseMariaDBConfigString(missingDatabase), /Invalid MariaDBConfig/);

  const missingPasswordType = JSON.stringify({ ...valid, password: 123 });
  t.throws(() => parseMariaDBConfigString(missingPasswordType as unknown as string), /Invalid MariaDBConfig/);

  t.end();
});

test('HostSetup producer contract: JSON.stringify output is consumable', (t) => {
  // Simulates HostSetup.vue finish() -> App.vue hostReady -> main parse
  const produced = JSON.stringify(valid); // canonical producer
  t.ok(typeof produced === 'string', 'HostSetup emits string');
  const consumed = parseMariaDBConfigString(produced);
  t.equal(consumed.host, valid.host);
  t.equal(consumed.database, valid.database);
  t.end();
});

test('parse rejects object that would have been emitted by old HostSetup bug', (t) => {
  // Old bug emitted raw object; Electron IPC would serialize as object, not string
  const rawObject = valid;
  t.throws(() => parseMariaDBConfigString(rawObject as unknown as string), /JSON string/, 'old bug object rejected, forcing caller to stringify');
  t.end();
});

test('getSafeConfigDisplay never echoes malformed raw JSON containing a password', (t) => {
  const secret = 'SUPERSECRET42';
  const truncated = `{"host":"127.0.0.1","port":3306,"user":"sotrama_app","password":"${secret}","database":"sotrama"`;
  const display = getSafeConfigDisplay(truncated);
  t.equal(display, 'Invalid configuration', 'fallback is the generic label');
  t.notOk(display.includes(secret), 'password value absent');
  t.notOk(display.includes('{'), 'no raw JSON fragments');
  t.notOk(display.includes('sotrama_app'), 'no raw field values from input');
  t.end();
});

test('getSafeConfigDetail never echoes malformed raw JSON containing a password', (t) => {
  const secret = 'SUPERSECRET42';
  const truncated = `{"host":"db.lan","port":3307,"user":"root","password":"${secret}","database":"books"`;
  const detail = getSafeConfigDetail(truncated);
  t.equal(detail, 'Invalid configuration', 'fallback is the generic label');
  t.notOk(detail.includes(secret), 'password value absent');
  t.notOk(detail.includes('{'), 'no raw JSON fragments');
  t.notOk(detail.includes('db.lan'), 'no raw field values from input');
  t.end();
});

test('safe outputs hide credentials for parseable-but-invalid configs', (t) => {
  const secret = 'ANOTHERSECRET99';
  // Parses as JSON but fails MariaDBConfig validation
  const invalidShape = JSON.stringify({ password: secret, note: 'half config' });
  const display = getSafeConfigDisplay(invalidShape);
  const detail = getSafeConfigDetail(invalidShape);
  t.equal(display, 'Invalid configuration');
  t.equal(detail, 'Invalid configuration');
  t.notOk(display.includes(secret));
  t.notOk(detail.includes(secret));
  t.end();
});

test('legacy non-JSON dbPath values fall back to the generic label', (t) => {
  t.equal(getSafeConfigDisplay('/home/user/books.fdb'), 'Invalid configuration');
  t.equal(getSafeConfigDetail('C:\\data\\books.fdb'), 'Invalid configuration');
  t.end();
});

test('safe outputs expose only non-secret fields for valid configs', (t) => {
  const secret = 'validbutsecret';
  const json = JSON.stringify({ ...valid, password: secret });
  const display = getSafeConfigDisplay(json);
  const detail = getSafeConfigDetail(json);

  t.equal(display, 'sotrama @ 127.0.0.1:3306 (sotrama_app)');
  t.ok(detail.includes('sotrama_app') && detail.includes('127.0.0.1:3306'));
  t.notOk(display.includes(secret), 'display hides password');
  t.notOk(detail.includes(secret), 'detail hides password');
  t.end();
});

test('empty input stays empty for display and uses label for detail', (t) => {
  t.equal(getSafeConfigDisplay(''), '');
  t.equal(getSafeConfigDetail(''), 'Invalid configuration');
  t.end();
});
