import { Fyo, t } from 'fyo';
import { ValidationError } from 'fyo/utils/errors';
import { ModelNameEnum } from 'models/types';
import type { Money } from 'pesa';
import { getShipmentCOGSAmountFromSLEs } from 'reports/inventory/helpers';
import type { QueryFilter } from 'utils/db/types';
import { toTimeValue } from 'utils';
import { getReturnBalanceItemsQty } from './returnBalance';
import type { StockTransfer } from './StockTransfer';
import type { ReturnDocItem } from './types';

export type StockQuantityQuery = {
  item: string;
  location?: string;
  batch?: string;
  serialNumbers?: string[];
  fromDate?: string;
  toDate?: string;
};

/**
 * StockLedger is the single seam for inventory valuation. Quantity, availability,
 * cost of goods sold, and return balances are answered here; generic persistence
 * only provides `getAll`/`getAllRaw` rows. FIFO replay lives in `StockQueue`.
 *
 * @returns summed quantity, or null when no ledger rows match.
 */
export async function getQuantity(
  fyo: Fyo,
  query: StockQuantityQuery
): Promise<number | null> {
  const filters: QueryFilter = { item: query.item };
  if (query.location !== undefined) filters.location = query.location;
  if (query.batch !== undefined) filters.batch = query.batch;
  if (query.serialNumbers?.length) {
    filters.serialNumber = ['in', query.serialNumbers];
  }

  const rows = await fyo.db.getAllRaw(ModelNameEnum.StockLedgerEntry, {
    fields: ['quantity', 'date'],
    filters,
  });

  const from = query.fromDate ? Date.parse(query.fromDate) : null;
  const to = query.toDate ? Date.parse(query.toDate) : null;

  let total = 0;
  let found = false;
  for (const row of rows) {
    const time = toTimeValue(row.date);
    if (from !== null && !(time > from)) continue;
    if (to !== null && !(time < to)) continue;
    const qty = Number(row.quantity ?? 0);
    if (Number.isNaN(qty)) continue;
    total += qty;
    found = true;
  }
  return found ? total : null;
}

/**
 * Availability policy for outward transfers: current balance plus a guard
 * against driving future-dated entries negative.
 *
 * @throws ValidationError when stock is insufficient now or would go negative.
 */
export async function validateAvailability(
  fyo: Fyo,
  details: {
    item: string;
    location: string;
    quantity: number;
    date: Date;
    batch?: string;
    serialNumbers?: string[];
    isReturn?: boolean;
    isCancelled?: boolean;
  }
): Promise<void> {
  const formattedDate = fyo.format(details.date, 'Datetime');
  const batchMessage = details.batch ? t` in Batch ${details.batch}` : '';

  const quantityBefore =
    (await getQuantity(fyo, {
      item: details.item,
      location: details.location,
      toDate: details.date.toISOString(),
      batch: details.batch,
      serialNumbers: details.serialNumbers,
    })) ?? 0;

  const before = details.isCancelled
    ? quantityBefore + details.quantity
    : quantityBefore;

  if (!details.isReturn && before < details.quantity) {
    throw new ValidationError(
      [
        t`Insufficient Quantity.`,
        t`Additional quantity (${
          details.quantity - before
        }) required${batchMessage} to make outward transfer of item ${
          details.item
        } from ${details.location} on ${formattedDate}`,
      ].join('\n')
    );
  }

  const quantityAfter = await getQuantity(fyo, {
    item: details.item,
    location: details.location,
    fromDate: details.date.toISOString(),
    batch: details.batch,
    serialNumbers: details.serialNumbers,
  });

  if (quantityAfter === null) {
    return;
  }

  const futureQuantity = before - details.quantity + quantityAfter;
  if (futureQuantity < 0) {
    throw new ValidationError(
      [
        t`Insufficient Quantity.`,
        t`Transfer will cause future entries to have negative stock.`,
        t`Additional quantity (${-futureQuantity}) required${batchMessage} to make outward transfer of item ${
          details.item
        } from ${details.location} on ${formattedDate}`,
      ].join('\n')
    );
  }
}

/** Cost of goods sold for a sales transfer, replayed through FIFO queues. */
export async function getCOGS(transfer: StockTransfer): Promise<Money> {
  return await getShipmentCOGSAmountFromSLEs(transfer);
}

/** Remaining returnable quantities per item, in `ReturnDocItem` shape. */
export async function getReturnBalance(
  fyo: Fyo,
  schemaName: string,
  docName: string
): Promise<Record<string, ReturnDocItem> | undefined> {
  return await getReturnBalanceItemsQty(fyo, schemaName, docName);
}
