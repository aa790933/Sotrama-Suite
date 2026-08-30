import { Fyo } from 'fyo';
import { TopExpenses } from 'utils/db/types';

/**
 * Domain-owned Top Expenses report — recomposed via Database.getAll primitives.
 * Previously bespoke SQL in backend/database/bespoke.ts:getTopExpenses.
 * Database now only provides getAll/getAllRaw; report owns business meaning.
 */
export async function getTopExpenses(fyo: Fyo, fromDate: string, toDate: string): Promise<TopExpenses> {
  const expenseAccounts = (await fyo.db.getAll('Account', {
    filters: { rootType: 'Expense' },
    fields: ['name'],
  })) as { name: string }[];
  const expenseSet = new Set(expenseAccounts.map((a) => a.name));
  const entries = (await fyo.db.getAllRaw('AccountingLedgerEntry', {
    filters: { reverted: false, date: ['between', fromDate, toDate] as unknown as string },
    fields: ['account', 'debit', 'credit'],
  })) as { account: string; debit: string | number; credit: string | number }[];
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (!expenseSet.has(e.account)) continue;
    const debit = Number(e.debit ?? 0);
    const credit = Number(e.credit ?? 0);
    const total = debit - credit;
    totals.set(e.account, (totals.get(e.account) ?? 0) + total);
  }
  return Array.from(totals.entries())
    .map(([account, total]) => ({ account, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}
