import { Fyo } from 'fyo';
import { TotalOutstanding } from 'utils/db/types';
import { getDocTotals } from './ledgerSummary';

export async function getTotalOutstanding(
  fyo: Fyo,
  schemaName: string,
  fromDate: string,
  toDate: string
): Promise<TotalOutstanding> {
  return await getDocTotals(fyo, schemaName, fromDate, toDate);
}
