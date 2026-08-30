import { Fyo } from 'fyo';
import { IncomeExpense } from 'utils/db/types';

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
  const entries = (await fyo.db.getAllRaw('AccountingLedgerEntry', {
    filters: { reverted: false, date: ['between', fromDate, toDate] as unknown as string },
    fields: ['account', 'debit', 'credit', 'date'],
  })) as { account: string; debit: string | number; credit: string | number; date: string }[];
  const incomeByMonth = new Map<string, number>();
  const expenseByMonth = new Map<string, number>();
  for (const e of entries) {
    const ym = String(e.date).slice(0, 7);
    const credit = Number(e.credit ?? 0);
    const debit = Number(e.debit ?? 0);
    if (incomeSet.has(e.account)) {
      const bal = credit - debit;
      incomeByMonth.set(ym, (incomeByMonth.get(ym) ?? 0) + bal);
    }
    if (expenseSet.has(e.account)) {
      const bal = debit - credit;
      expenseByMonth.set(ym, (expenseByMonth.get(ym) ?? 0) + bal);
    }
  }
  const income = Array.from(incomeByMonth.entries()).map(([yearmonth, balance]) => ({ yearmonth, balance }));
  const expense = Array.from(expenseByMonth.entries()).map(([yearmonth, balance]) => ({ yearmonth, balance }));
  return { income, expense };
}
