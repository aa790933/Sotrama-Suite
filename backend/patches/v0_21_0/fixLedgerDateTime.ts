import { DatabaseManager } from '../../database/manager';

/* eslint-disable */
async function execute(dm: DatabaseManager) {
  const sourceTables = [
    'PurchaseInvoice',
    'SalesInvoice',
    'JournalEntry',
    'Payment',
    'StockMovement',
    'StockTransfer',
  ];

  const ledgerEntries = (await dm.db?.query(
    `SELECT name, date, referenceName FROM AccountingLedgerEntry`
  )) as Array<{ name: string; date: Date; referenceName: string }>;

  for (const entry of ledgerEntries) {
    for (const table of sourceTables) {
      const rows = (await dm.db?.query(
        `SELECT name, date FROM \`${table}\` WHERE name = ?`,
        [entry.referenceName]
      )) as Array<{ name: string; date: Date }>;

      if (rows.length !== 0) {
        const dateTimeValue = new Date(rows[0].date);
        await dm.db?.query(
          `UPDATE AccountingLedgerEntry SET date = ? WHERE name = ?`,
          [dateTimeValue.toISOString(), entry.name]
        );
      }
    }
  }
}

export default { execute, beforeMigrate: true };
/* eslint-enable */
