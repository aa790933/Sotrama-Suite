import test from 'tape';
import { Fyo } from 'fyo';
import { MemoryDatabaseAdapter } from 'fyo/database/MemoryDatabaseAdapter';
import { getDbSyncError } from 'fyo/model/errorHelpers';
import { DuplicateEntryError } from 'fyo/utils/errors';
import { getRegionalModels, models } from 'models';
import { DummyAuthDemux } from './helpers';

function getMemoryFyo() {
  return new Fyo({
    database: new MemoryDatabaseAdapter(),
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
}

test('manual naming — temp name colliding with stored draft is bumped', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  const regionalModels = await getRegionalModels('in');
  await fyo.initializeAndRegister(models, regionalModels);

  // Simulate a previous session's draft owning the `01` primary key.
  await fyo.db.insert('Party', {
    name: 'New Party 01',
    role: 'Customer',
  } as never);

  // Fresh handler counters restart at `01` — the engine must scan and bump.
  const doc = fyo.doc.getNewDoc('Party', { role: 'Customer' });
  await doc.sync();
  t.equal(
    doc.name,
    'New Party 02',
    'colliding temporary name resolved to first free slot'
  );

  const second = fyo.doc.getNewDoc('Party', { role: 'Customer' });
  await second.sync();
  t.equal(
    second.name,
    'New Party 03',
    'scan increments past all taken suffixes'
  );

  await fyo.close();
  t.end();
});

test('manual naming — user-chosen names are never rewritten', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  const regionalModels = await getRegionalModels('in');
  await fyo.initializeAndRegister(models, regionalModels);

  const doc = fyo.doc.getNewDoc('Party', {
    name: 'Acme Corp',
    role: 'Customer',
  });
  await doc.sync();
  t.equal(doc.name, 'Acme Corp', 'explicit name preserved verbatim');

  await fyo.close();
  t.end();
});

test('manual naming — MariaDB 1062 maps to DuplicateEntryError', async (t) => {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  const regionalModels = await getRegionalModels('in');
  await fyo.initializeAndRegister(models, regionalModels);

  const doc = fyo.doc.getNewDoc('Party', {
    name: 'Acme Corp',
    role: 'Customer',
  });
  const raw = new Error(
    "(conn=113, no=1062, SQLState=23000) Duplicate entry 'Acme Corp' for key 'PRIMARY'"
  );
  const mapped = await getDbSyncError(raw, doc, fyo);
  t.ok(
    mapped instanceof DuplicateEntryError,
    'MariaDB duplicate maps to DuplicateEntryError'
  );
  t.equal(
    (mapped as DuplicateEntryError).more?.value,
    'Acme Corp',
    'conflicting value carried in `more`'
  );
  t.equal(
    (mapped as DuplicateEntryError).more?.fieldname,
    'name',
    'PRIMARY key attributed to the name field'
  );

  await fyo.close();
  t.end();
});
