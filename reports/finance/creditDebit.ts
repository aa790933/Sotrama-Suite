import { Fyo } from 'fyo';
import { TotalCreditAndDebit } from 'utils/db/types';
import { getLedgerEntries } from './ledgerSummary';

export async function getTotalCreditAndDebit(fyo: Fyo): Promise<TotalCreditAndDebit[]> {
  const entries = await getLedgerEntries(fyo);
  const byAccount = new Map<string, { totalCredit: number; totalDebit: number }>();
  for (const e of entries) {
    const cur = byAccount.get(e.account) ?? { totalCredit: 0, totalDebit: 0 };
    cur.totalCredit += e.credit;
    cur.totalDebit += e.debit;
    byAccount.set(e.account, cur);
  }
  return Array.from(byAccount.entries()).map(([account, v]) => ({
    account,
    totalCredit: v.totalCredit,
    totalDebit: v.totalDebit,
  }));
}
