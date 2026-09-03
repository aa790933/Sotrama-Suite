import { Fyo } from 'fyo';
import { Cashflow } from 'utils/db/types';
import { getLedgerEntries, monthKey } from './ledgerSummary';

export async function getCashflow(fyo: Fyo, fromDate: string, toDate: string): Promise<Cashflow> {
  const cashBankAccounts = (await fyo.db.getAll('Account', {
    filters: { accountType: ['in', ['Cash', 'Bank']], isGroup: false },
    fields: ['name'],
  })) as { name: string }[];
  const cashSet = new Set(cashBankAccounts.map((a) => a.name));
  const entries = await getLedgerEntries(fyo, {
    accounts: [...cashSet],
    fromDate,
    toDate,
  });
  const byMonth = new Map<string, { inflow: number; outflow: number }>();
  for (const e of entries) {
    if (!cashSet.has(e.account)) continue;
    const ym = monthKey(e.date);
    const cur = byMonth.get(ym) ?? { inflow: 0, outflow: 0 };
    cur.inflow += e.debit;
    cur.outflow += e.credit;
    byMonth.set(ym, cur);
  }
  return Array.from(byMonth.entries()).map(([yearmonth, v]) => ({
    yearmonth,
    inflow: v.inflow,
    outflow: v.outflow,
  }));
}
