import { translateSchema } from 'fyo/utils/translation';
import { cloneDeep } from 'lodash';
import { DateTime } from 'luxon';
import { SetupWizard } from 'models/baseModels/SetupWizard/SetupWizard';
import { ModelNameEnum } from 'models/types';
import { reports } from 'reports/index';
import SetupWizardSchema from 'schemas/app/SetupWizard.json';
import { fyo } from 'src/initFyo';
import { schemaTranslateables } from 'utils/translationHelpers.cjs';
export function getDatesAndPeriodList(period) {
    const toDate = DateTime.now().plus({ days: 1 });
    let fromDate;
    if (period === 'This Year') {
        fromDate = toDate.minus({ months: 12 });
    }
    else if (period === 'YTD') {
        fromDate = DateTime.now().startOf('year');
    }
    else if (period === 'This Quarter') {
        fromDate = toDate.minus({ months: 3 });
    }
    else if (period === 'This Month') {
        fromDate = toDate.startOf('month');
    }
    else {
        fromDate = toDate.minus({ days: 1 });
    }
    /**
     * periodList: Monthly decrements before toDate until fromDate
     */
    const periodList = [toDate];
    while (true) {
        const nextDate = periodList.at(0).minus({ months: 1 });
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
export function getSetupWizardDoc(languageMap) {
    /**
     * This is used cause when setup wizard is running
     * the database isn't yet initialized.
     */
    const schema = cloneDeep(SetupWizardSchema);
    if (languageMap) {
        translateSchema(schema, languageMap, schemaTranslateables);
    }
    return fyo.doc.getNewDoc('SetupWizard', {}, false, schema, SetupWizard);
}
export async function updateConfigFiles(fyo) {
    const configFiles = fyo.config.get('files', []);
    const companyName = fyo.singles.AccountingSettings.companyName;
    const id = fyo.singles.SystemSettings.instanceId;
    const rawDbPath = fyo.db.dbPath;
    const openCount = fyo.singles.Misc.openCount;
    // Main-owned credential custody — store full config in connections, keep files for migration
    // Try to handle as MariaDB JSON or as existing connection ID.
    // Connection rows are persisted via the main process (ipc.upsertConnection):
    // the preload `store.set` guard rejects direct renderer writes to
    // `connections`, which previously crashed boot with
    // "connections must be set via main process".
    let dbPathForFile = rawDbPath;
    let isMariaDB = false;
    try {
        const { parseMariaDBConfigString } = require('utils/mariadb-types');
        const cfg = parseMariaDBConfigString(rawDbPath);
        isMariaDB = true;
        const res = await ipc.upsertConnection({
            companyName,
            config: cfg,
            openCount,
        });
        if (!res.ok || !res.id) {
            throw new Error(res.error ?? 'upsert-connection failed');
        }
        const connId = res.id;
        fyo.config.set('lastSelectedConnectionId', connId);
        // For files, store ID instead of JSON to avoid password in the files list
        dbPathForFile = connId;
        // Replace renderer's in-memory dbPath with ID so password is not retained in Vue state
        fyo.db.dbPath = connId;
    }
    catch {
        // rawDbPath may already be a known connection ID — touch its metadata
        // main-side (best effort; boot must never crash on metadata sync).
        try {
            const res = await ipc.upsertConnection({
                companyName,
                connectionId: rawDbPath,
                openCount,
            });
            if (res.ok && res.id) {
                isMariaDB = true;
                fyo.config.set('lastSelectedConnectionId', res.id);
                dbPathForFile = res.id;
            }
        }
        catch { }
    }
    const fileIndex = configFiles.findIndex((f) => f.id === id);
    let newFile = {
        id,
        companyName,
        dbPath: dbPathForFile,
        openCount,
    };
    if (fileIndex === -1) {
        configFiles.push(newFile);
    }
    else {
        configFiles[fileIndex].companyName = companyName;
        configFiles[fileIndex].dbPath = dbPathForFile;
        configFiles[fileIndex].openCount = openCount;
        newFile = configFiles[fileIndex];
    }
    fyo.config.set('files', configFiles);
    // Keep lastSelectedFilePath in sync, but prefer lastSelectedConnectionId
    if (isMariaDB) {
        fyo.config.set('lastSelectedFilePath', dbPathForFile);
    }
    else {
        fyo.config.set('lastSelectedFilePath', rawDbPath);
    }
    return newFile;
}
export const docsPathMap = {
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
export async function getDataURL(type, data) {
    const blob = new Blob([data.buffer], { type });
    return new Promise((resolve) => {
        const fr = new FileReader();
        fr.addEventListener('loadend', () => {
            resolve(fr.result);
        });
        fr.readAsDataURL(blob);
    });
}
export async function convertFileToDataURL(file, type) {
    const buffer = await file.arrayBuffer();
    const array = new Uint8Array(buffer);
    return await getDataURL(type, array);
}
export function getCreateFiltersFromListViewFilters(filters) {
    const createFilters = {};
    for (const key in filters) {
        let value = filters[key];
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
export async function getReport(name) {
    const cachedReport = fyo.store.reports[name];
    if (cachedReport) {
        return cachedReport;
    }
    const report = new reports[name](fyo);
    await report.initialize();
    fyo.store.reports[name] = report;
    return report;
}
