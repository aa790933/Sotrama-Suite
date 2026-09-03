import type DatabaseCore from '../database/core';

async function execute(db: DatabaseCore) {
  await db.query(
    `UPDATE Payment SET referenceType = 'PurchaseInvoice' WHERE referenceType IS NULL AND paymentType = 'Pay'`
  );
  await db.query(
    `UPDATE Payment SET referenceType = 'SalesInvoice' WHERE referenceType IS NULL AND paymentType = 'Receive'`
  );
}

export default { execute, beforeMigrate: true };
