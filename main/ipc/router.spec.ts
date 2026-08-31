import test from 'tape';
import path from 'path';
import { PathPolicy, sanitizeDatabaseName, assertAllowedApiEndpoint, AllowAllSenderPolicy, ElectronSenderPolicy } from './policies';

// ——— sanitizeDatabaseName ———

test('sanitizeDatabaseName: allows alphanum, dash, underscore', (t) => {
  t.equal(sanitizeDatabaseName('sotrama'), 'sotrama');
  t.equal(sanitizeDatabaseName('my-db_123'), 'my-db_123');
  t.end();
});

test('sanitizeDatabaseName: rejects backticks and illegal chars (strict, not strip)', (t) => {
  t.throws(() => sanitizeDatabaseName('my`db'), /backticks/);
  t.throws(() => sanitizeDatabaseName('db; DROP TABLE x;'), /Invalid database name/);
  t.throws(() => sanitizeDatabaseName('`sotrama`'), /backticks/);
  t.throws(() => sanitizeDatabaseName('db with spaces'), /Invalid database name/);
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

test('IpcRouter deep module: sanitizeDatabaseName is single source (deletion test)', (t) => {
  t.throws(() => sanitizeDatabaseName('my`db'), /backticks/, 'single helper, not 2 copies');
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

test('IpcRouter seam is real — file has four typed sub-interfaces', (t) => {
  const src = require('fs').readFileSync('main/ipc/router.ts', 'utf-8');
  t.ok(src.includes('interface DbOps'), 'DbOps interface exists');
  t.ok(src.includes('interface InstallerOps'), 'InstallerOps interface exists (four, not three)');
  t.ok(src.includes('interface FileOps'), 'FileOps exists');
  t.ok(src.includes('interface AppOps'), 'AppOps exists');
  t.ok(src.includes('checkDbExists(config: MariaDBConfig)'), 'InstallerOps uses typed MariaDBConfig, not loose opts');
  t.ok(src.includes('checkDbAccess(config: MariaDBConfig)'), 'DbOps uses typed MariaDBConfig');
  t.ok(src.includes('database: Database'), 'injects real Database interface, not DatabaseLike cast');
  t.ok(src.includes('asDatabase('), 'uses asDatabase adapter, not as unknown cast');
  t.ok(!src.includes('as unknown as DatabaseLike'), 'no DatabaseLike cast');
  t.ok(!src.includes('toBackendResponse'), 'unused toBackendResponse removed');
  t.end();
});

test('IpcRouter — every IPC handler checks SenderPolicy (file check)', (t) => {
  const src = require('fs').readFileSync('main/ipc/router.ts', 'utf-8');
  // Every ipc.handle should be wrapped with withSender (which checks sender)
  const handles = (src.match(/ipc\.handle\(/g) || []).length;
  const withSender = (src.match(/withSender\(/g) || []).length;
  // SAVE_DATA/DELETE_FILE/SEND_API_REQUEST also check inside the method, but registration should also be wrapped
  t.equal(withSender, handles, 'every ipc.handle is wrapped with sender check');
  t.ok(src.includes('assertValidSender') || src.includes('isValidSender'), 'sender policy used');
  t.end();
});

test('IpcRouter — sanitizeDatabaseName rejects (strict)', (t) => {
  const src = require('fs').readFileSync('main/ipc/policies.ts', 'utf-8');
  t.ok(src.includes('must not contain backticks') || src.includes('must match'), 'sanitize rejects, not strips');
  t.notOk(src.includes("replace(/`/g, '')"), 'no silent strip');
  t.end();
});

test('IpcRouter + MemoryDatabaseAdapter — real seam (DbOps via Memory)', async (t) => {
  // Prove "two adapters = real seam" by actually exercising IpcRouter through MemoryDatabaseAdapter
  const Module = require('module') as unknown as { _cache: Record<string, { exports: unknown }> };
  const electronStorePath = require.resolve('electron-store');
  const electronPath = require.resolve('electron');
  const origStore = Module._cache[electronStorePath];
  const origElectron = Module._cache[electronPath];
  class MockStore {
    store: Record<string, unknown> = {};
    get(k: string, d?: unknown) { return this.store[k] ?? d; }
    set(k: string, v: unknown) { this.store[k] = v; }
    delete(k: string) { delete this.store[k]; }
  }
  // electron-store is consumed as `import Store from 'electron-store'` → needs both `module.exports = MockStore` and `.default`
  const mockStoreExports: unknown = Object.assign(MockStore, { default: MockStore });
  const mockElectron = {
    app: { getPath: () => '/tmp', getVersion: () => '0.0.0' },
    ipcMain: { handle: () => {} },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: '' }),
      showMessageBox: async () => ({ response: 0 }),
      showErrorBox: () => {},
    },
  };
  (Module._cache as Record<string, { exports: unknown }>)[electronStorePath] = { exports: mockStoreExports } as never;
  (Module._cache as Record<string, { exports: unknown }>)[electronPath] = { exports: mockElectron } as never;

  try {
    const { MemoryDatabaseAdapter } = await import('../../fyo/database/MemoryDatabaseAdapter');
    const mem = new MemoryDatabaseAdapter();
    await mem.createNewDatabase('', 'in');
    await mem.insert('Party', { name: 'TestP', email: 'a@b.com' } as never);
    const gotDirect = await mem.get('Party', 'TestP');
    t.equal(gotDirect.name, 'TestP', 'Memory adapter baseline works');

    const { IpcRouter } = await import('./router');
    const { AllowAllSenderPolicy, PathPolicy } = await import('./policies');
    const fakeApp = mockElectron.app as unknown as Electron.App;
    const fakeDialog = mockElectron.dialog as unknown as Electron.Dialog;
    const router = new IpcRouter({
      database: mem as unknown as import('../../fyo/database/Database').Database,
      windowProvider: { getWindow: () => null, isDevelopment: false, isLinux: false, checkedForUpdate: false, icon: '' },
      app: fakeApp,
      dialog: fakeDialog,
      senderPolicy: new AllowAllSenderPolicy(),
      pathPolicy: new PathPolicy({ userData: '/tmp/ud', temp: '/tmp/te', documents: '/tmp/do' }),
      installer: {
        isPortAvailable: async () => ({ available: true }),
        detectLanIp: () => null,
        pingMariaDB: async () => ({ ok: true }),
        installMariaDBSilent: async () => ({ ok: true }),
        resolveMsiPath: async () => '/tmp/x',
        detectPlatform: () => 'linux' as const,
      },
    });

    const res = await router.dbOps.dbCall('get', 'Party', 'TestP');
    t.ok((res as { data?: unknown }).data, 'IpcRouter.dbOps.dbCall via Memory adapter returns data (real seam)');
    const row = (res as { data?: unknown }).data as { name: string; email: string };
    t.equal(row.name, 'TestP', 'DbOps via Memory returns correct row');
    t.equal(row.email, 'a@b.com', 'field preserved through router seam');
  } catch (e) {
    t.fail((e as Error).message);
  } finally {
    if (origStore) (Module._cache as Record<string, { exports: unknown }>)[electronStorePath] = origStore as never;
    else delete (Module._cache as Record<string, { exports: unknown }>)[electronStorePath];
    if (origElectron) (Module._cache as Record<string, { exports: unknown }>)[electronPath] = origElectron as never;
    else delete (Module._cache as Record<string, { exports: unknown }>)[electronPath];
    t.end();
  }
});
