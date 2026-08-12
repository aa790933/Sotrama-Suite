import { DatabaseManager } from '../database/manager';

async function execute(dm: DatabaseManager) {
  await dm.db?.query(
    `UPDATE Payment SET referenceType = 'PurchaseInvoice' WHERE referenceType IS NULL AND paymentType = 'Pay'`
  );
  await dm.db?.query(
    `UPDATE Payment SET referenceType = 'SalesInvoice' WHERE referenceType IS NULL AND paymentType = 'Receive'`
  );
}

export default { execute, beforeMigrate: true };
