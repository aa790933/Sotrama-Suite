import { DZPayrollResult } from './payroll';

/**
 * Pure, framework-free helpers that bridge an Employee/EarningItem graph and
 * the Algerian payroll engine. They are kept out of the Fyo model layer so
 * they can be unit-tested without a database.
 */

export type EarningType =
  'housing' | 'transport' | 'bonus' | 'overtime' | 'other';

export interface EarningRow {
  type: EarningType;
  amount?: number;
  hours?: number;
  overtimeRate?: number;
  restDayOrHoliday?: boolean;
}

export interface LedgerLine {
  account: string;
  debit: number;
  credit: number;
}

/** Overtime worked on a rest day or public holiday is paid at 1.5x. */
export const OVERTIME_REST_DAY_MULTIPLIER = 1.5;
/** Overtime worked on a normal day is paid at 1.25x. */
export const OVERTIME_STANDARD_MULTIPLIER = 1.25;

export function getEarningRowTotal(
  row: EarningRow,
  defaultOvertimeRate: number
): number {
  if (row.type === 'overtime') {
    const rate =
      row.overtimeRate && row.overtimeRate > 0
        ? row.overtimeRate
        : defaultOvertimeRate;
    const hours = row.hours ?? 0;
    const multiplier = row.restDayOrHoliday
      ? OVERTIME_REST_DAY_MULTIPLIER
      : OVERTIME_STANDARD_MULTIPLIER;
    return hours * rate * multiplier;
  }
  return row.amount ?? 0;
}

export function getGrossNumber(
  baseSalary: number,
  earnings: EarningRow[] = [],
  defaultOvertimeRate = 0
): number {
  const earningsTotal = earnings.reduce(
    (sum, row) => sum + getEarningRowTotal(row, defaultOvertimeRate),
    0
  );
  return baseSalary + earningsTotal;
}

export function getSalarySlipAccounts(paymentAccount?: string) {
  return {
    expenseAccount: 'Salaries Expense',
    cnasAccount: 'CNAS Payable',
    irgAccount: 'IRG Payable',
    paymentAccount: paymentAccount ?? 'Cash in Hand',
  };
}

/**
 * Builds the balanced set of ledger lines for a submitted Salary Slip.
 *
 *   debit  Salaries Expense (gross + employer CNAS)
 *   credit CNAS Payable   (employee CNAS + employer CNAS)
 *   credit IRG Payable    (income tax)
 *   credit <paymentAccount> (net pay to hand / bank)
 *
 * Totals always balance because:
 *   gross + employerCNAS
 *     = (netPay + employeeCNAS + irg) + employerCNAS
 *     = netPay + employeeCNAS + employerCNAS + irg
 */
export function buildSalarySlipPostingLines(
  payroll: DZPayrollResult,
  paymentAccount = 'Cash in Hand'
): LedgerLine[] {
  return [
    {
      account: 'Salaries Expense',
      debit: payroll.gross + payroll.employerCNAS,
      credit: 0,
    },
    {
      account: 'CNAS Payable',
      debit: 0,
      credit: payroll.employeeCNAS + payroll.employerCNAS,
    },
    {
      account: 'IRG Payable',
      debit: 0,
      credit: payroll.irg,
    },
    {
      account: paymentAccount,
      debit: 0,
      credit: payroll.netPay,
    },
  ];
}
