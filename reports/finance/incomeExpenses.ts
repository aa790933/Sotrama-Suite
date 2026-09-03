import { Fyo } from 'fyo';
import { IncomeExpense } from 'utils/db/types';
import { getLedgerEntries, monthKey } from './ledgerSummary';

export async function getIncomeAndExpenses(fyo: Fyo, fromDate: string, toDate: string): Promise<IncomeExpense> {
  const incomeAccounts = (await fyo.db.getAll('Account', {
    filters: { rootType: 'Income' },
    fields: ['name'],
  })) as { name: string }[];
  const expenseAccounts = (await fyo.db.getAll('Account', {
    filters: { rootType: 'Expense' },
    fields: ['name'],
  })) as { name: string }[];
  const incomeSet = new Set(incomeAccounts.map((a) => a.name));
  const expenseSet = new Set(expenseAccounts.map((a) => a.name));
  const entries = await getLedgerEntries(fyo, {
    accounts: [...incomeSet, ...expenseSet],
    fromDate,
    toDate,
  });
  const incomeByMonth = new Map<string, number>();
  const expenseByMonth = new Map<string, number>();
  for (const e of entries) {
    const ym = monthKey(e.date);
    if (incomeSet.has(e.account)) {
      const bal = e.credit - e.debit;
      incomeByMonth.set(ym, (incomeByMonth.get(ym) ?? 0) + bal);
    }
    if (expenseSet.has(e.account)) {
      const bal = e.debit - e.credit;
      expenseByMonth.set(ym, (expenseByMonth.get(ym) ?? 0) + bal);
    }
  }
  const income = Array.from(incomeByMonth.entries()).map(([yearmonth, balance]) => ({ yearmonth, balance }));
  const expense = Array.from(expenseByMonth.entries()).map(([yearmonth, balance]) => ({ yearmonth, balance }));
  return { income, expense };
}
