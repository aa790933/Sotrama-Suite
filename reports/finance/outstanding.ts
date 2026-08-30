import { Fyo } from 'fyo';
import { TotalOutstanding } from 'utils/db/types';

/**
 * Domain-owned outstanding — recomposed via Database.getAll.
 * Previously bespoke SQL with SUM(baseGrandTotal/outstandingAmount) and submitted/cancelled/date filter.
 */
export async function getTotalOutstanding(
  fyo: Fyo,
  schemaName: string,
  fromDate: string,
  toDate: string
): Promise<TotalOutstanding> {
  const docs = (await fyo.db.getAll(schemaName, {
    filters: { submitted: true, cancelled: false, date: ['between', fromDate, toDate] as unknown as string },
    fields: ['baseGrandTotal', 'outstandingAmount'],
  })) as { baseGrandTotal: string | number; outstandingAmount: string | number }[];
  let total = 0;
  let outstanding = 0;
  for (const d of docs) {
    total += Number(d.baseGrandTotal ?? 0);
    outstanding += Number(d.outstandingAmount ?? 0);
  }
  return { total, outstanding };
}
