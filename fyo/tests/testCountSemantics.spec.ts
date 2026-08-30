import test from 'tape';
import { Fyo } from 'fyo';
import { MemoryDatabaseAdapter } from 'fyo/database/MemoryDatabaseAdapter';
import { DummyAuthDemux } from './helpers';

test('count semantics — total matching rows, not limited page', async (t) => {
  const fyo = new Fyo({
    database: new MemoryDatabaseAdapter(),
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
  await fyo.db.createNewDatabase('', 'in');

  for (let i = 1; i <= 5; i++) {
    await fyo.db.insert('Party', { name: `P${i}`, email: 'a@b.com' } as never);
  }

  const page = await fyo.db.getAll('Party', { filters: { email: 'a@b.com' }, limit: 2, offset: 0 });
  t.equal(page.length, 2, 'getAll with LIMIT 2 returns 2');

  const total = await fyo.db.count('Party', { filters: { email: 'a@b.com' } });
  t.equal(total, 5, 'count returns total matching rows (5), not page size');

  const totalWithLimit = await fyo.db.count('Party', { filters: { email: 'a@b.com' }, limit: 2 } as never);
  t.equal(totalWithLimit, 5, 'count ignores LIMIT/OFFSET — still total');

  const filtered = await fyo.db.count('Party', { filters: { email: 'nope' } });
  t.equal(filtered, 0, 'count with non-matching filter is 0');

  await fyo.close();
  t.end();
});
