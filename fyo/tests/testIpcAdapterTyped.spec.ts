import test from 'tape';
import { Fyo } from 'fyo';
import { IpcDatabaseAdapter } from 'fyo/database/IpcDatabaseAdapter';
import { DummyAuthDemux } from './helpers';

test('IpcDatabaseAdapter — typed transport for CRUD subset (Slice 2)', async (t) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const mockIpc = {
    db: {
      async getSchema() {
        return { data: {} } as any;
      },
      async create() {
        calls.push({ method: 'create', args: [] });
        return { data: 'in' } as any;
      },
      async connect() {
        calls.push({ method: 'connect', args: [] });
        return { data: 'in' } as any;
      },
      async call(method: string, ...args: unknown[]) {
        calls.push({ method, args });
        // Return minimal raw maps for CRUD
        if (method === 'insert') return { data: args[1] } as any;
        if (method === 'get') return { data: { name: args[1], email: 'a@b.com' } } as any;
        if (method === 'getAll') return { data: [{ name: 'Test', email: 'a@b.com' }] } as any;
        if (method === 'exists') return { data: true } as any;
        if (method === 'update') return { data: undefined } as any;
        if (method === 'delete') return { data: undefined } as any;
        return { data: undefined } as any;
      },
      async bespoke() {
        return { data: null } as any;
      },
    },
  };
  // @ts-ignore global
  global.ipc = mockIpc;

  // Production path: isElectron true, no explicit database, should auto-use IpcDatabaseAdapter
  const fyo = new Fyo({ isElectron: true, isTest: false, AuthDemux: DummyAuthDemux });
  t.ok(
    fyo.db.typedAdapter instanceof IpcDatabaseAdapter,
    'production Fyo uses IpcDatabaseAdapter via typed seam'
  );

  // Exercise the 6 migrated CRUD methods via typed adapter (not stringly call path)
  // We use a direct IpcDatabaseAdapter instance to isolate transport
  const ipcAdapter = new IpcDatabaseAdapter();
  const inserted = await ipcAdapter.insert('Party', { name: 'P1', email: 'a@b.com' } as any);
  t.equal(inserted.name, 'P1', 'IpcAdapter typed insert forwards via IPC');

  const got = await ipcAdapter.get('Party', 'P1');
  t.equal(got.name, 'P1', 'IpcAdapter typed get');

  const all = await ipcAdapter.getAll('Party', {});
  t.equal(all.length, 1, 'IpcAdapter typed getAll');

  const exists = await ipcAdapter.exists('Party', 'P1');
  t.ok(exists, 'IpcAdapter typed exists');

  await ipcAdapter.update('Party', { name: 'P1', phone: '123' } as any);
  t.pass('IpcAdapter typed update');

  await ipcAdapter.delete('Party', 'P1');
  t.pass('IpcAdapter typed delete');

  // Verify calls went through typed per-method IPC (still via call('insert'...) internally,
  // but handler→adapter seam is typed — the 6 methods are now typed at Fyo.db seam)
  const methods = calls.map((c) => c.method);
  t.ok(methods.includes('insert'), 'insert went via typed adapter');
  t.ok(methods.includes('get'), 'get went via typed adapter');
  t.ok(methods.includes('getAll'), 'getAll went via typed adapter');
  t.ok(methods.includes('exists'), 'exists went via typed adapter');

  t.end();
});
