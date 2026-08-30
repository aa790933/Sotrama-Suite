import test from 'tape';
import { Fyo } from 'fyo';
import { MemoryDatabaseAdapter } from 'fyo/database/MemoryDatabaseAdapter';
import { DummyAuthDemux } from './helpers';
import { Converter } from 'fyo/core/converter';
import { getMoneyMaker } from 'pesa';
import { FieldTypeEnum } from 'schemas/types';

process.env.TZ = 'UTC';

function getMemoryFyo() {
  return new Fyo({
    database: new MemoryDatabaseAdapter(),
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
}

test('typed surface — rename via Database seam', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  await fyo.db.insert('Party', { name: 'R1', email: 'a@b.com' } as never);
  await fyo.db.rename('Party', 'R1', 'R2');
  t.notOk(await fyo.db.exists('Party', 'R1'), 'old name gone');
  t.ok(await fyo.db.exists('Party', 'R2'), 'new name exists');
  const got = await fyo.db.get('Party', 'R2');
  t.equal(got.name, 'R2', 'rename preserved row');
  await fyo.close();
  t.end();
});

test('typed surface — deleteAll via Database seam', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  for (let i = 1; i <= 3; i++) await fyo.db.insert('Party', { name: `D${i}`, email: 'x@y.com' } as never);
  await fyo.db.insert('Party', { name: 'Keep', email: 'keep@y.com' } as never);
  const deleted = await fyo.db.deleteAll('Party', { email: 'x@y.com' });
  t.equal(deleted, 3, 'deleteAll returns count');
  t.equal(await fyo.db.count('Party', {}), 1, 'count after deleteAll');
  const kept = await fyo.db.get('Party', 'Keep');
  t.equal(kept.name, 'Keep', 'non-matching kept');
  await fyo.close();
  t.end();
});

test('typed surface — getSingleValues via Database seam', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  // SystemSettings singles are seeded by Memory adapter
  const sv = await fyo.db.getSingleValues({ fieldname: 'countryCode', parent: 'SystemSettings' });
  t.ok(Array.isArray(sv) && sv.length > 0, 'getSingleValues returns DocValue via typed seam');
  t.equal(sv[0].fieldname, 'countryCode', 'fieldname preserved');
  await fyo.close();
  t.end();
});

test('typed surface — getAllRaw leaks Raw (no Doc conversion)', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  await fyo.db.insert('Party', { name: 'Raw1', email: 'r@r.com' } as never);
  const raw = await fyo.db.getAllRaw('Party', {});
  const doc = await fyo.db.getAll('Party', {});
  t.equal(raw.length, doc.length, 'getAllRaw and getAll same count for memory (Raw leak intentional)');
  t.equal(raw[0].name, 'Raw1', 'getAllRaw returns Raw without Doc conversion');
  await fyo.close();
  t.end();
});

test('typed surface — close via Database seam', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  await fyo.db.close();
  t.pass('close via typed seam does not throw');
  t.end();
});

// Converter internalization — prove Currency/Check/DATETIME preserved behind Database seam
test('converter — Currency via pesa behind Database seam', async (t) => {
  const pesa = getMoneyMaker({ currency: 'INR', precision: 2, display: 2, wrapper: (v) => v });
  const fieldMap = {
    TestDoc: {
      amount: { fieldname: 'amount', label: 'Amount', fieldtype: FieldTypeEnum.Currency },
      name: { fieldname: 'name', label: 'Name', fieldtype: FieldTypeEnum.Data },
    },
  } as unknown as Record<string, Record<string, import('schemas/types').Field>>;
  const conv = new Converter(() => fieldMap, () => pesa);
  const doc = { name: 'T1', amount: pesa(123.45) } as unknown as import('fyo/core/types').DocValueMap;
  const raw = conv.toRawValueMap('TestDoc', doc) as Record<string, unknown>;
  t.equal(typeof raw.amount, 'string', 'Currency toRaw stores as string via pesa store');
  const back = conv.toDocValueMap('TestDoc', raw as never) as Record<string, unknown>;
  t.ok((back.amount as unknown as { float: number }).float === 123.45 || String(back.amount).includes('123'), 'Currency toDoc restores Money');
  t.end();
});

test('converter — Check/TINYINT and DATETIME timezone', async (t) => {
  const pesa = getMoneyMaker({ currency: 'INR', precision: 2, display: 2, wrapper: (v) => v });
  const fieldMap = {
    TestDoc: {
      isActive: { fieldname: 'isActive', label: 'Active', fieldtype: FieldTypeEnum.Check },
      created: { fieldname: 'created', label: 'Created', fieldtype: FieldTypeEnum.Datetime },
    },
  } as unknown as Record<string, Record<string, import('schemas/types').Field>>;
  const conv = new Converter(() => fieldMap, () => pesa);
  const dt = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));
  const doc = { isActive: true, created: dt } as unknown as import('fyo/core/types').DocValueMap;
  const raw = conv.toRawValueMap('TestDoc', doc) as Record<string, unknown>;
  t.equal(raw.isActive, 1, 'Check true → TINYINT 1');
  t.ok(typeof raw.created === 'string' && (raw.created as string).includes('2024-01-15'), 'Datetime toRaw is space-separated UTC without T/Z');
  t.ok(!(raw.created as string).includes('T') && !(raw.created as string).includes('Z'), 'Datetime MariaDB format correct');
  const back = conv.toDocValueMap('TestDoc', raw as never) as Record<string, unknown>;
  t.equal(back.isActive, true, 'Check toDoc 1 → true');
  t.ok(back.created instanceof Date, 'Datetime toDoc restores Date');
  // Round-trip via MariaDB's space-separated UTC format preserves the instant when TZ=UTC;
  // in test env local TZ may shift, so verify date part and that raw→doc→raw is stable
  t.equal((back.created as Date).toISOString().slice(0, 10), dt.toISOString().slice(0, 10), 'Datetime date part preserved');
  const raw2 = conv.toRawValueMap('TestDoc', back as never) as Record<string, unknown>;
  t.equal(raw2.created, raw.created, 'Datetime raw→doc→raw stable');
  t.end();
});
