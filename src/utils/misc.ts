import { Fyo } from 'fyo';
import { ConfigFile } from 'fyo/core/types';
import { translateSchema } from 'fyo/utils/translation';
import { cloneDeep } from 'lodash';
import { DateTime } from 'luxon';
import { SetupWizard } from 'models/baseModels/SetupWizard/SetupWizard';
import { ModelNameEnum } from 'models/types';
import { reports } from 'reports/index';
import SetupWizardSchema from 'schemas/app/SetupWizard.json';
import { Schema } from 'schemas/types';
import { fyo } from 'src/initFyo';
import { QueryFilter } from 'utils/db/types';
import { schemaTranslateables } from 'utils/translationHelpers';
import type { LanguageMap } from 'utils/types';
import { PeriodKey } from './types';

export function getDatesAndPeriodList(period: PeriodKey): {
  periodList: DateTime[];
  fromDate: DateTime;
  toDate: DateTime;
} {
  const toDate: DateTime = DateTime.now().plus({ days: 1 });
  let fromDate: DateTime;

  if (period === 'This Year') {
    fromDate = toDate.minus({ months: 12 });
  } else if (period === 'YTD') {
    fromDate = DateTime.now().startOf('year');
  } else if (period === 'This Quarter') {
    fromDate = toDate.minus({ months: 3 });
  } else if (period === 'This Month') {
    fromDate = toDate.startOf('month');
  } else {
    fromDate = toDate.minus({ days: 1 });
  }

  /**
   * periodList: Monthly decrements before toDate until fromDate
   */
  const periodList: DateTime[] = [toDate];
  while (true) {
    const nextDate = periodList.at(0)!.minus({ months: 1 });
    if (nextDate.toMillis() < fromDate.toMillis()) {
      if (period === 'YTD') {
        periodList.unshift(nextDate);
        break;
      }
      break;
    }

    periodList.unshift(nextDate);
  }
  periodList.shift();

  return {
    periodList,
    fromDate,
    toDate,
  };
}

export function getSetupWizardDoc(languageMap?: LanguageMap) {
  /**
   * This is used cause when setup wizard is running
   * the database isn't yet initialized.
   */
  const schema = cloneDeep(SetupWizardSchema);
  if (languageMap) {
    translateSchema(schema, languageMap, schemaTranslateables);
  }
  return fyo.doc.getNewDoc(
    'SetupWizard',
    {},
    false,
    schema as Schema,
    SetupWizard
  );
}

export function updateConfigFiles(fyo: Fyo): ConfigFile {
  const configFiles = fyo.config.get('files', []) as ConfigFile[];
  const companyName = fyo.singles.AccountingSettings!.companyName as string;
  const id = fyo.singles.SystemSettings!.instanceId as string;
  const rawDbPath = fyo.db.dbPath!;
  const openCount = fyo.singles.Misc!.openCount as number;

  // P1-A: main-owned credential custody — store full config in connections, keep files for migration
  // Try to handle as MariaDB JSON or as existing connection ID
  let dbPathForFile: string = rawDbPath;
  let isMariaDB = false;
  try {
    const { parseMariaDBConfigString } = require('utils/mariadb-types') as typeof import('utils/mariadb-types');
    const cfg = parseMariaDBConfigString(rawDbPath);
    isMariaDB = true;
    // Upsert into connections store (main-owned)
    const connections = (fyo.config.get('connections' as never) as import('utils/mariadb-types').PersistedConnection[] | undefined) ?? [];
    let conn = connections.find((c) => c.id === id) || connections.find((c) => c.host === cfg.host && c.port === cfg.port && c.database === cfg.database && c.user === cfg.user);
    if (conn) {
      conn.companyName = companyName;
      conn.host = cfg.host;
      conn.port = cfg.port;
      conn.user = cfg.user;
      conn.database = cfg.database;
      conn.password = cfg.password;
      conn.openCount = openCount;
    } else {
      const { fromMariaDBConfigToPersisted } = require('utils/mariadb-types') as typeof import('utils/mariadb-types');
      conn = fromMariaDBConfigToPersisted(id, companyName, cfg, openCount);
      connections.push(conn);
    }
    fyo.config.set('connections' as never, connections as never);
    fyo.config.set('lastSelectedConnectionId' as never, conn.id as never);
    // For files, store ID instead of JSON to avoid password in legacy list (keep JSON for migration fallback)
    dbPathForFile = conn.id;
    // Replace renderer’s in-memory dbPath with ID so password is not retained in Vue state
    // Keep original JSON in a non-reactive holder for potential retry, but clear from reactive state
    (fyo.db as unknown as { _rawDbPath?: string })._rawDbPath = rawDbPath;
    fyo.db.dbPath = conn.id;
  } catch {
    // Check if rawDbPath is already a known connection ID (post-migration)
    const connections = (fyo.config.get('connections' as never) as import('utils/mariadb-types').PersistedConnection[] | undefined) ?? [];
    const byId = connections.find((c) => c.id === rawDbPath);
    if (byId) {
      isMariaDB = true;
      byId.companyName = companyName;
      byId.openCount = openCount;
      fyo.config.set('connections' as never, connections as never);
      fyo.config.set('lastSelectedConnectionId' as never, byId.id as never);
      dbPathForFile = byId.id;
    }
  }

  const fileIndex = configFiles.findIndex((f) => f.id === id);
  let newFile = { id, companyName, dbPath: dbPathForFile, openCount } as ConfigFile;

  if (fileIndex === -1) {
    configFiles.push(newFile);
  } else {
    configFiles[fileIndex].companyName = companyName;
    configFiles[fileIndex].dbPath = dbPathForFile;
    configFiles[fileIndex].openCount = openCount;
    newFile = configFiles[fileIndex];
  }

  fyo.config.set('files', configFiles);
  // Also keep lastSelectedFilePath for backward compat, but prefer lastSelectedConnectionId
  if (isMariaDB) {
    fyo.config.set('lastSelectedFilePath', dbPathForFile);
  } else {
    fyo.config.set('lastSelectedFilePath', rawDbPath);
  }
  return newFile;
}

export const docsPathMap: Record<string, string | undefined> = {
  // Analytics
  Dashboard: 'books/dashboard',
  Reports: 'books/reports',
  GeneralLedger: 'books/general-ledger',
  ProfitAndLoss: 'books/profit-and-loss',
  BalanceSheet: 'books/balance-sheet',
  TrialBalance: 'books/trial-balance',

  // Transactions
  [ModelNameEnum.SalesInvoice]: 'books/sales-invoices',
  [ModelNameEnum.PurchaseInvoice]: 'books/purchase-invoices',
  [ModelNameEnum.Payment]: 'books/payments',
  [ModelNameEnum.JournalEntry]: 'books/journal-entries',

  // Inventory
  [ModelNameEnum.StockMovement]: 'books/stock-movement',
  [ModelNameEnum.Shipment]: 'books/shipment',
  [ModelNameEnum.PurchaseReceipt]: 'books/purchase-receipt',
  StockLedger: 'books/stock-ledger',
  StockBalance: 'books/stock-balance',
  [ModelNameEnum.Batch]: 'books/batches',

  // Entries
  Entries: 'books/books',
  [ModelNameEnum.Party]: 'books/party',
  [ModelNameEnum.Item]: 'books/items',
  [ModelNameEnum.Tax]: 'books/taxes',
  [ModelNameEnum.PrintTemplate]: 'books/print-templates',

  // Miscellaneous
  Search: 'books/quick-search',
  NumberSeries: 'books/number-series',
  ImportWizard: 'books/import-wizard',
  Settings: 'books/settings',
  ChartOfAccounts: 'books/chart-of-accounts',
};

export async function getDataURL(type: string, data: Uint8Array) {
  const blob = new Blob([data.buffer as ArrayBuffer], { type });

  return new Promise<string>((resolve) => {
    const fr = new FileReader();
    fr.addEventListener('loadend', () => {
      resolve(fr.result as string);
    });

    fr.readAsDataURL(blob);
  });
}

export async function convertFileToDataURL(file: File, type: string) {
  const buffer = await file.arrayBuffer();
  const array = new Uint8Array(buffer);
  return await getDataURL(type, array);
}

export function getCreateFiltersFromListViewFilters(filters: QueryFilter) {
  const createFilters: Record<string, string | number | boolean | null> = {};

  for (const key in filters) {
    let value: (typeof filters)[string] | undefined | number = filters[key];

    if (Array.isArray(value) && value[0] === 'in' && Array.isArray(value[1])) {
      value = value[1].filter((v) => v !== 'Both')[0];
    }

    if (value === undefined || Array.isArray(value)) {
      continue;
    }

    createFilters[key] = value;
  }

  return createFilters;
}

export function getIsMac() {
  return navigator.userAgent.indexOf('Mac') !== -1;
}

export async function getReport(name: keyof typeof reports) {
  const cachedReport = fyo.store.reports[name];
  if (cachedReport) {
    return cachedReport;
  }

  const report = new reports[name](fyo);
  await report.initialize();
  fyo.store.reports[name] = report;
  return report;
}
