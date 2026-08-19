/*
 * Real end-to-end test of the Algerian annual-leave balance guard over MariaDB.
 *
 * Covers the beforeSubmit guard + the query-sum used-leave model:
 *   (a) an Annual leave with insufficient balance is blocked at submit,
 *   (b) an Annual leave with sufficient balance submits successfully and the
 *       remaining balance decreases afterward,
 *   (c) only `type === 'Annual'` is blocked (e.g. Sick leave submits freely).
 *
 * Boot: in-process DatabaseManager (setDbConfig via a subclass ctor, since
 * DatabaseHandler hides its #demux) over a fresh MariaDB `test_leavbal` db,
 * with the real Algerian (dz) schema map + registered regional models.
 */
import DatabaseCore, { MariaDBConfig } from 'backend/database/core';
import { DatabaseManager } from 'backend/database/manager';
import { config } from 'dotenv';
import { Fyo } from 'fyo';
import { DummyAuthDemux } from 'fyo/tests/helpers';
import { getTestDbConfig } from 'backend/database/tests/dbTestConfig';
import { getRegionalModels, models } from 'models/index';
import { Employee } from 'models/regionalModels/dz/Employee';
import { LeaveApplication } from 'models/regionalModels/dz/LeaveApplication';
import {
  accruedLeaveDays,
  leaveDurationDays,
} from 'models/regionalModels/dz/leaveAccrual';
import test from 'tape';

config();
process.env.TZ = process.env.TZ || 'UTC';

const cfg: MariaDBConfig = getTestDbConfig('test_leavbal');

/**
 * DatabaseManager subclass that injects the test MariaDB config in its
 * constructor (mirroring main/registerIpcMainActionListeners setDbConfig flow),
 * and performs a lean createNewDatabase (connect + migrate) that skips patches.
 */
class TestDemux extends DatabaseManager {
  constructor() {
    super();
    this.setDbConfig(cfg);
  }
  override async createNewDatabase(_dbPath: string, countryCode: string) {
    countryCode = await this._connect(_dbPath, countryCode);
    await this.db!.migrate();
    return countryCode;
  }
}

async function boot(): Promise<Fyo> {
  // Pre-create a clean database (DatabaseManager.createNewDatabase for MariaDB
  // is effectively a connect; it does not create the db itself).
  const admin = new DatabaseCore(undefined, { ...cfg, database: 'test' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS \`${cfg.database}\``);
  await admin.query(`CREATE DATABASE \`${cfg.database}\``);
  await admin.close();

  const fyo = new Fyo({
    DatabaseDemux: TestDemux,
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
  await fyo.db.createNewDatabase(':memory:', 'dz');
  const regionalModels = await getRegionalModels('dz');
  await fyo.initializeAndRegister(models, regionalModels);
  return fyo;
}

let fyo: Fyo;

test('setup: boot fyo over MariaDB (dz) for leave-balance tests', async (t) => {
  fyo = await boot();
  t.ok(fyo, 'fyo booted over MariaDB (dz)');
  t.end();
});

test('Annual leave with insufficient balance is blocked at submit', async (t) => {
  const emp = fyo.doc.getNewDoc('Employee', {
    firstName: 'Tes',
    lastName: 'Tyr',
    hireDate: new Date(Date.UTC(2025, 0, 1)),
    baseSalary: fyo.pesa(50000),
    personalID: 'CIN-0001',
    nin: 'NIN-0001',
    cnasNumber: 'CNAS-0001',
  }) as Employee;
  await emp.sync();
  t.ok(emp.name, 'created employee ' + emp.name);

  // Pre-existing approved annual leave: Feb 1 -> Feb 10 (10 days) = already used.
  const seed = fyo.doc.getNewDoc('LeaveApplication', {
    employee: emp.name,
    startDate: new Date(Date.UTC(2026, 1, 1)),
    endDate: new Date(Date.UTC(2026, 1, 10)),
    type: 'Annual',
    status: 'Approved',
  }) as LeaveApplication;
  await seed.sync();
  seed.submitted = true; // mark as already-submitted / granted
  await seed.sync();
  t.equal(
    await seed.getUsedAnnualLeaveDays(),
    10,
    'seed approved leave counts as 10 used days'
  );

  // Accrued as of the leave start (Feb 10 2026, hire Jan 1 2025):
  // 13 full months -> capped at 30 (the engine is cumulative-from-hire).
  t.equal(
    accruedLeaveDays(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2026, 1, 10))),
    30,
    'accrued as of Feb 10 2026 = 30 (cap)'
  );
  t.equal(
    leaveDurationDays(new Date(Date.UTC(2026, 1, 1)), new Date(Date.UTC(2026, 1, 10))),
    10,
    'seed duration = 10 inclusive days'
  );

  // ---- (b) Sufficient balance: Feb 10 -> Feb 21 = 12 days. ----
  // remaining = 30 - 10(used) = 20; 12 <= 20 -> allowed; balance decreases to 8.
  const lb = fyo.doc.getNewDoc('LeaveApplication', {
    employee: emp.name,
    startDate: new Date(Date.UTC(2026, 1, 10)),
    endDate: new Date(Date.UTC(2026, 1, 21)),
    type: 'Annual',
  }) as LeaveApplication;
  await lb.sync();
  await lb.submit();
  t.ok(lb.submitted, 'leave B (12 days) submitted: 12 <= remaining 20');
  t.equal(
    await lb.getRemainingBalance(),
    8,
    'remaining balance decreased to 8 after B submits (30 - 10 seed - 12 B)'
  );

  // ---- (a) Insufficient balance: Mar 1 -> Mar 20 = 20 days. ----
  // remaining is now 8 (seed 10 + B 12 = 22 used); 20 > 8 -> BLOCKED.
  const lc = fyo.doc.getNewDoc('LeaveApplication', {
    employee: emp.name,
    startDate: new Date(Date.UTC(2026, 2, 1)),
    endDate: new Date(Date.UTC(2026, 2, 20)),
    type: 'Annual',
  }) as LeaveApplication;
  await lc.sync();
  let threw = false;
  let msg = '';
  try {
    await lc.submit();
  } catch (e: any) {
    threw = true;
    msg = e.message;
  }
  t.ok(threw, 'leave C (20 days) was blocked at submit (20 > 8)');
  t.ok(
    msg.includes('Insufficient annual leave balance'),
    'block raised the balance error message'
  );
  t.ok(
    msg.includes('8 day(s)') && msg.includes('20 day(s)') && msg.includes('already used 22'),
    'error message reports requested/proposed/used/remaining: ' + msg
  );
  t.notOk(lc.submitted, 'leave C was not submitted after the block');
  t.end();
});

test('Non-Annual leave types are not blocked by the annual-leave guard', async (t) => {
  const emp = fyo.doc.getNewDoc('Employee', {
    firstName: 'Tes',
    lastName: 'Two',
    hireDate: new Date(Date.UTC(2025, 0, 1)),
    baseSalary: fyo.pesa(50000),
    cnasNumber: 'CNAS-0002',
  }) as Employee;
  await emp.sync();

  // A 30-day Sick request — far exceeds the annual balance, but type !== 'Annual'.
  const ls = fyo.doc.getNewDoc('LeaveApplication', {
    employee: emp.name,
    startDate: new Date(Date.UTC(2026, 3, 1)),
    endDate: new Date(Date.UTC(2026, 3, 30)),
    type: 'Sick',
  }) as LeaveApplication;
  await ls.sync();
  let threw = false;
  try {
    await ls.submit();
  } catch {
    threw = true;
  }
  t.notOk(threw, 'Sick leave (non-Annual) was not blocked by the guard');
  t.ok(ls.submitted, 'Sick leave submitted successfully');
  t.end();
});

test('cleanup: close fyo', async (t) => {
  await fyo.close();
  t.pass('fyo closed');
  t.end();
});
