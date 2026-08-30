import { Fyo } from 'fyo';
import { Cashflow } from 'utils/db/types';

/**
 * Domain-owned cashflow — recomposed via getAll.
 * Previously bespoke: SUM(debit) inflow / SUM(credit) outflow grouped by yearmonth
 * where accountType Cash/Bank and isGroup=0.
 */
export async function getCashflow(fyo: Fyo, fromDate: string, toDate: string): Promise<Cashflow> {
  const cashBankAccounts = (await fyo.db.getAll('Account', {
    filters: { accountType: ['in', ['Cash', 'Bank']], isGroup: false },
    fields: ['name'],
  })) as { name: string }[];
  const cashSet = new Set(cashBankAccounts.map((a) => a.name));
  const entries = (await fyo.db.getAllRaw('AccountingLedgerEntry', {
    filters: { reverted: false, date: ['between', fromDate, toDate] as unknown as string },
    fields: ['account', 'debit', 'credit', 'date'],
  })) as { account: string; debit: string | number; credit: string | number; date: string }[];
  const byMonth = new Map<string, { inflow: number; outflow: number }>();
  for (const e of entries) {
    if (!cashSet.has(e.account)) continue;
    const ym = String(e.date).slice(0, 7); // YYYY-MM
    const cur = byMonth.get(ym) ?? { inflow: 0, outflow: 0 };
    cur.inflow += Number(e.debit ?? 0);
    cur.outflow += Number(e.credit ?? 0);
    byMonth.set(ym, cur);
  }
  return Array.from(byMonth.entries()).map(([yearmonth, v]) => ({
    yearmonth,
    inflow: v.inflow,
    outflow: v.outflow,
  }));
}
