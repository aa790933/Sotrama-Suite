import { t } from 'fyo';
import { Action } from 'fyo/model/types';
import { DateTime } from 'luxon';
import getCommonExportActions from 'reports/commonExporter';
import { Report } from 'reports/Report';
import { ColumnField, ReportData } from 'reports/types';
import { Field } from 'schemas/types';
import {
  buildDasRows,
  EmployeeRow,
  fetchEmployeeMap,
  fetchSubmittedSalarySlips,
  SlipRow,
} from './dzPayrollData';

export class DAS extends Report {
  static title = t`Annual Wage Declaration (DAS)`;
  static reportName = 'das';
  loading = false;

  year?: string;

  private _rows: SlipRow[] = [];

  setDefaultFilters() {
    if (!this.year) {
      this.year = String(DateTime.now().year);
    }
  }

  getFilters(): Field[] {
    return [
      {
        fieldtype: 'Select',
        fieldname: 'year',
        label: t`Financial Year`,
        placeholder: t`Year`,
        options: this._yearOptions(),
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
      {
        fieldname: 'nin',
        label: t`NIN (required)`,
        fieldtype: 'Data',
        width: 1.25,
      },
      { fieldname: 'cnasNumber', label: t`CNAS Number`, fieldtype: 'Data' },
      {
        fieldname: 'gross',
        label: t`Gross Wages`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'employeeCNAS',
        label: t`Employee CNAS (9%)`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'employerCNAS',
        label: t`Employer CNAS (26%)`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'totalEmployerCost',
        label: t`Total Employer Cost`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'netPay',
        label: t`Net Pay`,
        fieldtype: 'Currency',
        align: 'right',
      },
      {
        fieldname: 'deadline',
        label: t`Legal Deadline`,
        fieldtype: 'Data',
        align: 'left',
        width: 1.5,
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

  private _yearNum(): number {
    const n = Number(this.year);
    return Number.isNaN(n) ? DateTime.now().year : n;
  }

  private _buildRows(employees: Map<string, EmployeeRow>): ReportData {
    return buildDasRows(this._rows, employees, this._yearNum(), (value, kind) =>
      this.fyo.format(value, kind)
    );
  }
}
