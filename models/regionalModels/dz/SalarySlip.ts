import { ListViewSettings } from 'fyo/model/types';
import { ValidationError } from 'fyo/utils/errors';
import { t } from 'fyo';
import { LedgerPosting } from 'models/Transactional/LedgerPosting';
import { Transactional } from 'models/Transactional/Transactional';
import { Money } from 'pesa';
import {
  calculateDZPayroll,
  DZPayrollResult,
  getPayrollSettingsData,
} from './payroll';
import {
  EarningRow,
  buildSalarySlipPostingLines,
  getGrossNumber,
} from './salarySlipLogic';
import { EarningItem } from './EarningItem';
import { Employee } from './Employee';

export class SalarySlip extends Transactional {
  employee?: string;
  employeeName?: string;
  period?: string;
  month?: number;
  earnings?: EarningItem[];
  baseSalary?: Money;
  allowances?: Money;
  overtimeTotal?: Money;
  gross?: Money;
  employeeCNAS?: Money;
  employerCNAS?: Money;
  netSocial?: Money;
  abatement?: Money;
  taxableBase?: Money;
  irg?: Money;
  netPay?: Money;
  totalEmployerCost?: Money;
  paymentAccount?: string;
  status?: 'Draft' | 'Processed';
  remark?: string;

  private async runPayroll(): Promise<DZPayrollResult> {
    if (!this.employee) {
      throw new ValidationError(
        t`Employee is required to compute the salary slip payroll`
      );
    }

    const emp = (await this.loadAndGetLink('employee')) as Employee | null;
    if (!emp) {
      throw new ValidationError(t`Employee "${this.employee}" was not found`);
    }

    const baseSalary = emp.baseSalary?.float ?? 0;
    const overtimeRate = emp.overtimeRate?.float ?? 0;

    const rows: EarningItem[] = this.earnings ?? [];
    const earnings: EarningRow[] = rows.map((e) => ({
      type: e.type ?? 'other',
      amount: e.amount?.float ?? 0,
      hours: e.hours,
      overtimeRate: e.overtimeRate?.float,
      restDayOrHoliday: !!e.restDayOrHoliday,
    }));

    const gross = getGrossNumber(baseSalary, earnings, overtimeRate);
    const settings = getPayrollSettingsData(this.fyo.singles.PayrollSettings);
    const payroll = calculateDZPayroll(gross, settings);

    this.baseSalary = this.fyo.pesa(baseSalary);
    this.employeeName = emp.fullName || emp.name;
    this.gross = this.fyo.pesa(payroll.gross);
    this.employeeCNAS = this.fyo.pesa(payroll.employeeCNAS);
    this.employerCNAS = this.fyo.pesa(payroll.employerCNAS);
    this.netSocial = this.fyo.pesa(payroll.netSocial);
    this.abatement = this.fyo.pesa(payroll.abatement);
    this.taxableBase = this.fyo.pesa(payroll.taxableBase);
    this.irg = this.fyo.pesa(payroll.irg);
    this.netPay = this.fyo.pesa(payroll.netPay);
    this.totalEmployerCost = this.fyo.pesa(
      payroll.gross + payroll.employerCNAS
    );

    return payroll;
  }

  async beforeSubmit(): Promise<void> {
    await super.beforeSubmit();
    if (this.employee) {
      await this.runPayroll();
    }
  }

  async getPosting(): Promise<LedgerPosting | null> {
    // A draft slip with no employee yet must still be saveable; the schema
    // marks `employee` as required, so it cannot be submitted without one.
    if (!this.employee) {
      return null;
    }

    const payroll = await this.runPayroll();
    const posting = new LedgerPosting(this, this.fyo);

    const lines = buildSalarySlipPostingLines(
      payroll,
      this.paymentAccount ?? 'Cash in Hand'
    );

    for (const line of lines) {
      const amount = this.fyo.pesa(line.debit || line.credit);
      if (line.debit > 0) {
        await posting.debit(line.account, amount);
      } else {
        await posting.credit(line.account, amount);
      }
    }

    await posting.makeRoundOffEntry();
    return posting;
  }

  static getListViewSettings(): ListViewSettings {
    return {
      columns: ['name', 'employee', 'period', 'gross', 'netPay', 'status'],
    };
  }
}
