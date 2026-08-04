import { t } from 'fyo';
import { Action } from 'fyo/model/types';
import { DateTime } from 'luxon';
import getCommonExportActions from 'reports/commonExporter';
import { Report } from 'reports/Report';
import { ColumnField, ReportData } from 'reports/types';
import { Field } from 'schemas/types';
import {
  buildG50Rows,
  fetchSubmittedSalarySlips,
  SlipRow,
} from './dzPayrollData';

export class G50 extends Report {
  static title = t`IRG Monthly Declaration (G50)`;
  static reportName = 'g50';
  loading = false;

  year?: string;
  month?: string;

  private _rows: SlipRow[] = [];

  setDefaultFilters() {
    const now = DateTime.now();
    if (!this.year) {
      this.year = String(now.year);
    }

    if (!this.month) {
      this.month = String(now.month);
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
        fieldname: 'month',
        label: t`Month`,
        placeholder: t`Month`,
        options: this._monthOptions(),
      },
    ] as Field[];
  }

  getColumns(): ColumnField[] {
    return [
      { fieldname: 'period', label: t`Period`, fieldtype: 'Data', width: 1.25 },
      {
        fieldname: 'slipCount',
        label: t`Salary Slips`,
        fieldtype: 'Int',
        align: 'right',
        width: 0.75,
      },
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
        fieldname: 'irg',
        label: t`Total IRG Withheld`,
        fieldtype: 'Currency',
        align: 'right',
        width: 1.25,
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
        width: 1.75,
      },
    ];
  }

  async setReportData(): Promise<void> {
    this.loading = true;
    this._rows = await fetchSubmittedSalarySlips(this.fyo);
    this.reportData = this._buildRows();
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

  private _monthOptions(): { value: string; label: string }[] {
    const labels = [
      '',
      t`Jan`,
      t`Feb`,
      t`Mar`,
      t`Apr`,
      t`May`,
      t`Jun`,
      t`Jul`,
      t`Aug`,
      t`Sep`,
      t`Oct`,
      t`Nov`,
      t`Dec`,
    ];

    const options: { value: string; label: string }[] = [];
    for (let m = 1; m <= 12; m++) {
      options.push({ value: String(m), label: `${m} - ${labels[m]}` });
    }

    return options;
  }

  private _yearNum(): number {
    const n = Number(this.year);
    return Number.isNaN(n) ? DateTime.now().year : n;
  }

  private _monthNum(): number {
    const n = Number(this.month);
    return Number.isNaN(n) ? DateTime.now().month : n;
  }

  private _buildRows(): ReportData {
    return buildG50Rows(
      this._rows,
      this._yearNum(),
      this._monthNum(),
      (value, kind) => this.fyo.format(value, kind)
    );
  }
}
