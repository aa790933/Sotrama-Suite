import DatabaseCore from 'backend/database/core';
import { config } from 'dotenv';
import { createConnection } from 'mariadb';
import { Fyo } from 'fyo';
import { DummyAuthDemux } from 'fyo/tests/helpers';
import { DateTime } from 'luxon';
import path from 'path';
import setupInstance from 'src/setup/setupInstance';
import { SetupWizardOptions } from 'src/setup/types';
import test from 'tape';
import { getFiscalYear } from 'utils/misc';
import { getTestDbConfig } from 'backend/database/tests/dbTestConfig';

export function getTestSetupWizardOptions(): SetupWizardOptions {
  return {
    logo: null,
    companyName: 'Test Company',
    country: 'India',
    fullname: 'Test Person',
    email: 'test@testmyfantasy.com',
    bankName: 'Test Bank of Scriptia',
    currency: 'INR',
    fiscalYearStart: DateTime.fromJSDate(
      getFiscalYear('04-01', true)!
    ).toISODate(),
    fiscalYearEnd: DateTime.fromJSDate(
      getFiscalYear('04-01', false)!
    ).toISODate(),
    chartOfAccounts: 'India - Chart of Accounts',
  };
}

export function getTestDbPath(dbPath?: string) {
  config();
  // MariaDB uses MariaDBConfig via DatabaseCore; dbPath is retained for API
  // compatibility but ignored for MariaDB (see DatabaseCore.createNewDatabase).
  return dbPath ?? process.env.TEST_DB_PATH ?? '';
}

/**
 * In-process MariaDB for integration tests. Use a dedicated database so the
 * schema-migration tests can reset `test_books_core` without interrupting
 * application/setup tests that run in the same Tape process.
 */
export class MariaDBTestDemux extends DatabaseCore {
  constructor() {
    super(undefined, getTestDbConfig('test_sotrama_app'));
  }
}

/**
 * Test Boilerplate
 *
 * The bottom three functions are test boilerplate for when
 * an initialized fyo object is to be used.
 *
 * They are required because top level await is not supported.
 *
 * Therefore setup and cleanup of the fyo object is wrapped
 * in tests which are executed serially (and awaited in order)
 * by tape.
 *
 * If `closeTestFyo` is not called the test process won't exit.
 */

export function getTestFyo(): Fyo {
  return new Fyo({
    DatabaseDemux: MariaDBTestDemux,
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
}

const ext = '.spec.ts';

/* eslint-disable @typescript-eslint/no-misused-promises */

export function setupTestFyo(fyo: Fyo, filename: string) {
  const testName = path.basename(filename, ext);

  return test(`setup: ${testName}`, async () => {
    const options = getTestSetupWizardOptions();
    const dbPath = getTestDbPath();
    await resetTestDatabase();
    await setupInstance(dbPath, options, fyo);
  });
}

async function resetTestDatabase() {
  const connection = await createConnection({
    ...getTestDbConfig('test_sotrama_app'),
    multipleStatements: true,
  });

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    const tables = (await connection.query(
      `SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    )) as { tableName: string }[];

    for (const { tableName } of tables) {
      if (tableName.toLowerCase() === 'patchrun') {
        continue;
      }

      const safeTableName = tableName.replace(/`/g, '``');
      await connection.query(`DELETE FROM \`${safeTableName}\``);
    }
  } finally {
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      await connection.end();
    }
  }
}

export function closeTestFyo(fyo: Fyo, filename: string) {
  const testName = path.basename(filename, ext);

  return test(`cleanup: ${testName}`, async () => {
    await fyo.close();
  });
}
