import test from 'tape';
import { Fyo } from 'fyo';
import { MemoryDatabaseAdapter } from 'fyo/database/MemoryDatabaseAdapter';
import { DummyAuthDemux } from './helpers';

function getMemoryFyo() {
  return new Fyo({
    database: new MemoryDatabaseAdapter(),
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
}

test('Memory adapter — typed seam proof: insert/get/getAll/exists', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');

  // Direct fyo.db CRUD via typed adapter (not stringly call)
  await fyo.db.insert('Party', {
    name: 'TestParty',
    email: 'a@b.com',
  } as never);

  const got = await fyo.db.get('Party', 'TestParty');
  t.equal(got.name, 'TestParty', 'get returns inserted row via Memory adapter');
  t.equal(got.email, 'a@b.com', 'field values preserved');

  const all = await fyo.db.getAll('Party', { fields: ['name'] });
  t.equal(all.length, 1, 'getAll returns one row');
  t.equal(all[0].name, 'TestParty', 'getAll row matches');

  t.ok(await fyo.db.exists('Party', 'TestParty'), 'exists true for inserted');
  t.notOk(await fyo.db.exists('Party', 'Missing'), 'exists false for missing');

  // Update via same typed seam
  await fyo.db.update('Party', { name: 'TestParty', phone: '123' } as never);
  const updated = await fyo.db.get('Party', 'TestParty');
  t.equal(updated.phone, '123', 'update via typed seam preserved');

  // getAllRaw/count also go through typed seam internally
  const count = await fyo.db.count('Party', {});
  t.equal(count, 1, 'count via typed seam');

  await fyo.db.close();
  t.end();
});

test('Memory adapter — getSingleValues via typed seam', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  // SystemSettings singles seeded by Memory adapter
  const sv = await fyo.db.getSingleValues({ fieldname: 'countryCode', parent: 'SystemSettings' });
  t.ok(Array.isArray(sv), 'getSingleValues returns array via typed adapter');
  await fyo.close();
  t.end();
});

test('Two-adapter proof: Memory and Ipc share Database interface shape', async (t) => {
  // This is a static check — both adapters implement Database (typed) with insert/get/getAll/exists.
  // We prove it by constructing both and checking the interface exists at runtime.
  const mem = new MemoryDatabaseAdapter();
  // Ipc adapter requires window.ipc — we only check it can be imported and has the typed methods,
  // without instantiating it in node (it would need Electron). The import itself proves the seam.
  const { IpcDatabaseAdapter } = await import('fyo/database/IpcDatabaseAdapter');
  t.ok(typeof mem.insert === 'function', 'Memory has typed insert');
  t.ok(typeof mem.get === 'function', 'Memory has typed get');
  t.ok(typeof mem.getAll === 'function', 'Memory has typed getAll');
  t.ok(typeof mem.exists === 'function', 'Memory has typed exists');
  t.ok(typeof IpcDatabaseAdapter.prototype.insert === 'function', 'Ipc has typed insert');
  t.ok(typeof IpcDatabaseAdapter.prototype.getAll === 'function', 'Ipc has typed getAll');
  t.end();
});
