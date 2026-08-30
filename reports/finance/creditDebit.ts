import { Fyo } from 'fyo';
import { TotalCreditAndDebit } from 'utils/db/types';

export async function getTotalCreditAndDebit(fyo: Fyo): Promise<TotalCreditAndDebit[]> {
  const entries = (await fyo.db.getAllRaw('AccountingLedgerEntry', {
    fields: ['account', 'credit', 'debit'],
  })) as { account: string; credit: string | number; debit: string | number }[];
  const byAccount = new Map<string, { totalCredit: number; totalDebit: number }>();
  for (const e of entries) {
    const cur = byAccount.get(e.account) ?? { totalCredit: 0, totalDebit: 0 };
    cur.totalCredit += Number(e.credit ?? 0);
    cur.totalDebit += Number(e.debit ?? 0);
    byAccount.set(e.account, cur);
  }
  return Array.from(byAccount.entries()).map(([account, v]) => ({
    account,
    totalCredit: v.totalCredit,
    totalDebit: v.totalDebit,
  }));
}
