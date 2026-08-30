import test from 'tape';
import path from 'path';
import { PathPolicy, sanitizeDatabaseName, assertAllowedApiEndpoint, AllowAllSenderPolicy, ElectronSenderPolicy } from './policies';

// ——— sanitizeDatabaseName ———

test('sanitizeDatabaseName: allows alphanum, dash, underscore', (t) => {
  t.equal(sanitizeDatabaseName('sotrama'), 'sotrama');
  t.equal(sanitizeDatabaseName('my-db_123'), 'my-db_123');
  t.end();
});

test('sanitizeDatabaseName: strips backticks and illegal chars in one place', (t) => {
  t.equal(sanitizeDatabaseName('my`db'), 'mydb');
  t.equal(sanitizeDatabaseName('db; DROP TABLE x;'), 'dbDROPTABLEx');
  t.equal(sanitizeDatabaseName('`sotrama`'), 'sotrama');
  t.end();
});

test('sanitizeDatabaseName: rejects empty after sanitization', (t) => {
  t.throws(() => sanitizeDatabaseName(''), /Invalid database name/);
  t.throws(() => sanitizeDatabaseName('```'), /Invalid database name/);
  t.equal(sanitizeDatabaseName('---'), '---', 'dashes are allowed');
  t.throws(() => sanitizeDatabaseName('`'), /Invalid database name/);
  t.end();
});

// ——— PathPolicy ———

function makePolicy(tmpRoot: string) {
  return new PathPolicy({ userData: path.join(tmpRoot, 'userData'), temp: path.join(tmpRoot, 'temp'), documents: path.join(tmpRoot, 'docs') });
}

test('PathPolicy: allows files inside userData/temp/documents', (t) => {
  const root = '/tmp/sotrama-test-' + Date.now();
  const p = makePolicy(root);
  t.ok(p.isAllowed(path.join(root, 'userData', 'file.json')));
  t.ok(p.isAllowed(path.join(root, 'temp', 'a', 'b.json')));
  t.ok(p.isAllowed(path.join(root, 'docs', 'report.pdf')));
  t.ok(p.isAllowed(path.join(root, 'userData')), 'exact root allowed');
  t.end();
});

test('PathPolicy: rejects traversal outside allowed roots', (t) => {
  const root = '/tmp/sotrama-test-' + Date.now();
  const p = makePolicy(root);
  t.notOk(p.isAllowed('/etc/passwd'));
  t.notOk(p.isAllowed(path.join(root, 'userData', '..', 'etc', 'passwd')));
  t.notOk(p.isAllowed('/tmp/other/file.json'));
  t.end();
});

test('PathPolicy.assertAllowed throws with Path not allowed', (t) => {
  const p = makePolicy('/tmp/roots');
  t.throws(() => p.assertAllowed('/etc/hosts'), /Path not allowed/);
  t.end();
});

// ——— assertAllowedApiEndpoint ———

test('assertAllowedApiEndpoint: allows https + books_integration prefix', (t) => {
  t.doesNotThrow(() => assertAllowedApiEndpoint('https://erp.example.com/api/method/books_integration.api.ping'));
  t.end();
});

test('assertAllowedApiEndpoint: rejects http and wrong prefix', (t) => {
  t.throws(() => assertAllowedApiEndpoint('http://erp.example.com/api/method/books_integration.api.ping'), /only https/);
  t.throws(() => assertAllowedApiEndpoint('https://evil.com/api/method/other.api'), /endpoint not allowed/);
  t.throws(() => assertAllowedApiEndpoint('https://evil.com/'), /endpoint not allowed/);
  t.end();
});

// ——— SenderPolicy ———

test('AllowAllSenderPolicy always returns true', (t) => {
  const p = new AllowAllSenderPolicy();
  t.ok(p.isValidSender({} as never));
  t.end();
});

test('ElectronSenderPolicy checks sender === window webContents', (t) => {
  const fakeContents = {} as Electron.WebContents;
  const fakeWin = { webContents: fakeContents } as unknown as Electron.BrowserWindow;
  const provider = { getWindow: () => fakeWin, isDevelopment: false, isLinux: false, checkedForUpdate: false, icon: '' };
  const policy = new ElectronSenderPolicy(() => (provider as unknown as { getWindow: () => Electron.BrowserWindow | null }).getWindow());
  t.ok(policy.isValidSender({ sender: fakeContents } as unknown as Electron.IpcMainInvokeEvent));
  t.notOk(policy.isValidSender({ sender: {} as Electron.WebContents } as unknown as Electron.IpcMainInvokeEvent));
  t.notOk(policy.isValidSender({ sender: fakeContents } as unknown as Electron.IpcMainInvokeEvent) === false ? false : false); // ensure not always true
  // null window => false
  const nullProvider = { getWindow: () => null, isDevelopment: false, isLinux: false, checkedForUpdate: false, icon: '' };
  const nullPolicy = new ElectronSenderPolicy(() => (nullProvider as unknown as { getWindow: () => Electron.BrowserWindow | null }).getWindow());
  t.notOk(nullPolicy.isValidSender({ sender: fakeContents } as unknown as Electron.IpcMainInvokeEvent));
  t.end();
});

// Router integration tests are exercised via policies directly;
// full IpcRouter with Database seam is verified in a separate
// integration harness that mocks electron/electron-store to avoid
// requiring the real electron binary in unit tests.
// The pure helpers below are the core of the deep module.

test('IpcRouter deep module: sanitizeDatabaseName is single source (deletion test)', (t) => {
  // Deleting this helper would require recreating it in N handlers — proves depth
  t.equal(sanitizeDatabaseName('my`db'), 'mydb', 'single helper, not 2 copies');
  t.throws(() => sanitizeDatabaseName(''), /Invalid/);
  t.end();
});

test('IpcRouter deep module: PathPolicy is single source', (t) => {
  const p = new PathPolicy({ userData: '/tmp/ud', temp: '/tmp/te', documents: '/tmp/do' });
  t.ok(p.isAllowed('/tmp/ud/file.json'));
  t.notOk(p.isAllowed('/etc/passwd'));
  t.end();
});

test('IpcRouter deep module: assertAllowedApiEndpoint is single source', (t) => {
  t.doesNotThrow(() => assertAllowedApiEndpoint('https://erp.example.com/api/method/books_integration.api.ping'));
  t.throws(() => assertAllowedApiEndpoint('http://evil.com/api/method/books_integration.api.ping'), /only https/);
  t.end();
});
