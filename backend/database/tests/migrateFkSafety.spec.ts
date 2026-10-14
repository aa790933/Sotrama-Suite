import test from 'tape';
import DatabaseCore from '../core';

/**
 * Regression: migrate must restore FOREIGN_KEY_CHECKS=1 even when DDL fails.
 * This test fakes the pool/connection so no MariaDB is required — it proves
 * the finally path is taken. Production MariaDB behavior is still covered by
 * testCore.spec.ts Post Migrate TableInfo.
 */

test('migrate restores FOREIGN_KEY_CHECKS=1 even when CREATE fails', async (t) => {
  const db = new DatabaseCore(undefined, {
    host: 'localhost',
    port: 3306,
    user: 'test',
    password: 'test',
    database: 'test_fk_safety',
  });

  // Minimal schema that will trigger a create
  db.setSchemaMap({
    SingleValue: {
      name: 'SingleValue',
      label: 'SingleValue',
      fields: [
        { fieldname: 'name', label: 'name', fieldtype: 'Data', required: true },
        { fieldname: 'parent', label: 'parent', fieldtype: 'Data' },
        { fieldname: 'fieldname', label: 'fieldname', fieldtype: 'Data' },
        { fieldname: 'value', label: 'value', fieldtype: 'Text' },
      ],
      isSingle: false,
    },
    Dummy: {
      name: 'Dummy',
      label: 'Dummy',
      fields: [
        { fieldname: 'name', label: 'name', fieldtype: 'Data', required: true },
        { fieldname: 'value', label: 'value', fieldtype: 'Data' },
      ],
      isSingle: false,
    },
  } as never);

  const calls: string[] = [];
  let createShouldFail = true;

  const fakeConn: unknown = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes('SELECT 1 FROM INFORMATION_SCHEMA.TABLES')) {
        // Pretend Dummy does not exist → create list will include Dummy
        return [];
      }
      if (sql.includes('FOREIGN_KEY_CHECKS=0')) return [];
      if (sql.includes('FOREIGN_KEY_CHECKS=1')) return [];
      if (sql.includes('CREATE TABLE') && createShouldFail) {
        throw new Error('simulated DDL failure');
      }
      if (sql.includes('SELECT') && sql.includes('COLUMN_NAME')) return [];
      if (sql.includes('SELECT') && sql.includes('KEY_COLUMN_USAGE')) return [];
      return [];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const fakePool: unknown = {
    async getConnection() {
      return fakeConn;
    },
    async end() {},
  };

  // Inject fake pool directly (no real MariaDB)
  (db as unknown as { pool: unknown }).pool = fakePool;

  // Force #getCreateAlterList to think Dummy needs creation by stubbing #tableExists
  // Our fake query for INFORMATION_SCHEMA.TABLES already returns [] for Dummy,
  // so create will contain Dummy.

  try {
    await db.migrate();
    t.fail('migrate should have thrown simulated failure');
  } catch (e) {
    t.ok(
      (e as Error).message.includes('simulated DDL failure'),
      'migrate propagated DDL error'
    );
  }

  const hadSet0 = calls.some((s) => s.includes('FOREIGN_KEY_CHECKS=0'));
  const hadSet1 = calls.some((s) => s.includes('FOREIGN_KEY_CHECKS=1'));
  t.ok(hadSet0, 'SET FOREIGN_KEY_CHECKS=0 was executed');
  t.ok(hadSet1, 'SET FOREIGN_KEY_CHECKS=1 was restored even after failure (finally path)');

  // Next migrate should still be able to run (pool not leaked, #txConn cleared)
  // Make create succeed this time
  createShouldFail = false;
  calls.length = 0;
  try {
    await db.migrate();
    t.pass('second migrate after failure still executes (pool released, #txConn cleared)');
  } catch (e) {
    t.fail('second migrate should not throw: ' + (e as Error).message);
  }

  t.end();
});
