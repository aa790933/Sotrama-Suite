import test from 'tape';
import DatabaseCore from '../core';

function databaseWithQuery(query: () => Promise<unknown>): DatabaseCore {
  const db = new DatabaseCore();
  (db as unknown as { query: () => Promise<unknown> }).query = query;
  return db;
}

test('setRawCustomFields tolerates only a missing customfield table', async (t) => {
  const missingTable = databaseWithQuery(async () => {
    throw Object.assign(new Error('missing table'), {
      errno: 1146,
      code: 'ER_NO_SUCH_TABLE',
    });
  });
  await missingTable.setRawCustomFields();
  t.deepEqual(
    missingTable.rawCustomFields,
    [],
    'fresh database can omit customfield'
  );

  const denied = new Error('Access denied for user');
  const inaccessibleDatabase = databaseWithQuery(async () => {
    throw denied;
  });
  try {
    await inaccessibleDatabase.setRawCustomFields();
    t.fail('connection and permission failures must propagate');
  } catch (error) {
    t.equal(error, denied, 'original connection error is preserved');
  }

  t.end();
});
