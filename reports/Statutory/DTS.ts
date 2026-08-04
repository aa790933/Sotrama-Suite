import { t } from 'fyo';
import { Action } from 'fyo/model/types';
import { DateTime } from 'luxon';
import getCommonExportActions from 'reports/commonExporter';
import { Report } from 'reports/Report';
import { ColumnField, ReportData } from 'reports/types';
import { Field } from 'schemas/types';
import {
  buildDtsRows,
  EmployeeRow,
  fetchEmployeeMap,
  fetchSubmittedSalarySlips,
  SlipRow,
} from './dzPayrollData';

export class DTS extends Report {
  static title = t`Quarterly Wage Declaration (DTS)`;
  static reportName = 'dts';
  loading = false;

  year?: string;
  quarter?: string;

  private _rows: SlipRow[] = [];

  setDefaultFilters() {
    const now = DateTime.now();
    if (!this.year) {
      this.year = String(now.year);
    }

    if (!this.quarter) {
      this.quarter = String(Math.ceil(now.month / 3));
    }
  }

  getFilters(): Field[] {
    return [
      {
        fieldtype: 'Select',
        fieldname: 'year',
        label: t`Year`,
        placeholder: t`Year`,
        options: this._yearOptions(),
      },
      {
        fieldtype: 'Select',
        fieldname: 'quarter',
        label: t`Quarter`,
        placeholder: t`Quarter`,
        options: [
          { value: '1', label: t`Q1 (Jan–Mar)` },
          { value: '2', label: t`Q2 (Apr–Jun)` },
          { value: '3', label: t`Q3 (Jul–Sep)` },
          { value: '4', label: t`Q4 (Oct–Dec)` },
        ],
      },
    ] as Field[];
  }

  getColumns(): ColumnField[] {
    return [
      {
        fieldname: 'employee',
        label: t`Employee`,
        fieldtype: 'Data',
        width: 1.5,
      },
      { fieldname: 'nin', label: t`NIN`, fieldtype: 'Data', width: 1.25 },
      { fieldname: 'cnasNumber', label: t`CNAS Number`, fieldtype: 'Data' },
      {
        fieldname: 'gross',
        label: t`Gross Wages`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'employeeCNAS',
        label: t`Employee CNAS`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'employerCNAS',
        label: t`Employer CNAS`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'netPay',
        label: t`Net Pay`,
        fieldtype: 'Currency',
        align: 'right',
      },
    ];
  }

  async setReportData(): Promise<void> {
    this.loading = true;
    this._rows = await fetchSubmittedSalarySlips(this.fyo);
    const employees = await fetchEmployeeMap(this.fyo);
    this.reportData = this._buildRows(employees);
    this.loading = false;
  }

  getActions(): Action[] {
    return getCommonExportActions(this);
  }

  private _yearOptions(): { value: string; label: string }[] {
    const now = DateTime.now().year;
    const options: { value: string; label: string }[] = [];
    for (let y = now - 3; y <= now + 1; y++) {
      options.push({ value: String(y), label: String(y) });
    }

    return options;
  }

  private _buildRows(employees: Map<string, EmployeeRow>): ReportData {
    return buildDtsRows(
      this._rows,
      employees,
      this._yearNum(),
      this._quarterNum(),
      (value, kind) => this.fyo.format(value, kind)
    );
  }

  private _yearNum(): number {
    const n = Number(this.year);
    return Number.isNaN(n) ? DateTime.now().year : n;
  }

  private _quarterNum(): number {
    const n = Number(this.quarter);
    if (n < 1 || n > 4) {
      return Math.ceil(DateTime.now().month / 3);
    }

    return n;
  }
}
