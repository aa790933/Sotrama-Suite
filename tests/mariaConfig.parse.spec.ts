import test from 'tape';
import { parseMariaDBConfigString } from '../utils/mariadb-types';

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
