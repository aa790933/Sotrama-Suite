import { getDefaultMetaFieldValueMap } from '../../backend/helpers';
import type DatabaseCore from '../database/core';

async function execute(db: DatabaseCore) {
  const s = (await db.getAll('SingleValue', {
    fields: ['value'],
    filters: { fieldname: 'setupComplete' },
  })) as { value: string }[];

  if (!Number(s?.[0]?.value ?? '0')) {
    return;
  }

  const names: Record<string, string> = {
    StockMovement: 'SMOV-',
    PurchaseReceipt: 'PREC-',
    Shipment: 'SHPM-',
  };

  for (const referenceType in names) {
    const name = names[referenceType];
    await createNumberSeries(name, referenceType, db);
  }
}

async function createNumberSeries(
  name: string,
  referenceType: string,
  db: DatabaseCore
) {
  const exists = await db.exists('NumberSeries', name);
  if (exists) {
    return;
  }

  await db.insert('NumberSeries', {
    name,
    start: 1001,
    padZeros: 4,
    current: 0,
    referenceType,
    ...getDefaultMetaFieldValueMap(),
  });
}

export default { execute, beforeMigrate: true };
