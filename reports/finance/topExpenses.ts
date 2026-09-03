import { Fyo } from 'fyo';
import { TopExpenses } from 'utils/db/types';
import { getLedgerEntries } from './ledgerSummary';

export async function getTopExpenses(fyo: Fyo, fromDate: string, toDate: string): Promise<TopExpenses> {
  const expenseAccounts = (await fyo.db.getAll('Account', {
    filters: { rootType: 'Expense' },
    fields: ['name'],
  })) as { name: string }[];
  const expenseSet = new Set(expenseAccounts.map((a) => a.name));
  const entries = await getLedgerEntries(fyo, {
    accounts: [...expenseSet],
    fromDate,
    toDate,
  });
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (!expenseSet.has(e.account)) continue;
    const total = e.debit - e.credit;
    totals.set(e.account, (totals.get(e.account) ?? 0) + total);
  }
  return Array.from(totals.entries())
    .map(([account, total]) => ({ account, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}
