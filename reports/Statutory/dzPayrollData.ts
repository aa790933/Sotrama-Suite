import { DateTime } from 'luxon';
import { Fyo, t } from 'fyo';
import { ModelNameEnum } from 'models/types';
import { ReportCell, ReportData } from 'reports/types';
import { Field, FieldType } from 'schemas/types';
import { safeParseFloat } from 'utils';

export type Formatter = (value: unknown, kind: Field | FieldType) => string;

/**
 * Raw shape of an Algerian Salary Slip as returned by `fyo.db.getAllRaw`.
 * Money fields are persisted as numbers; `period` is "YYYY-MM", `month` is 1..12.
 */
export interface SlipRow {
  name: string;
  employee: string;
  employeeName: string;
  period: string;
  month: number;
  gross: number;
  employeeCNAS: number;
  employerCNAS: number;
  netSocial: number;
  abatement: number;
  taxableBase: number;
  irg: number;
  netPay: number;
  totalEmployerCost: number;
  status: string;
}

export interface EmployeeRow {
  name: string;
  firstName: string;
  lastName: string;
  nin: string;
  cnasNumber: string;
}

/** Numeric helper that tolerates the raw `unknown` shape returned by getAllRaw. */
export function num(value: unknown): number {
  return safeParseFloat(value);
}

/** All submitted, non-cancelled Algerian salary slips, oldest first. */
export async function fetchSubmittedSalarySlips(fyo: Fyo): Promise<SlipRow[]> {
  if (fyo.singles.SystemSettings?.countryCode !== 'dz') {
    return [];
  }

  return (await fyo.db.getAllRaw(ModelNameEnum.SalarySlip, {
    fields: [
      'name',
      'employee',
      'employeeName',
      'gross',
      'employeeCNAS',
      'employerCNAS',
      'netSocial',
      'abatement',
      'taxableBase',
      'irg',
      'netPay',
      'totalEmployerCost',
      'period',
      'month',
      'status',
    ],
    filters: { submitted: true, cancelled: false },
    orderBy: ['period', 'name'],
    order: 'asc',
  })) as unknown as SlipRow[];
}

/** Employee lookup keyed by `name`, for NIN / CNAS number resolution. */
export async function fetchEmployeeMap(
  fyo: Fyo
): Promise<Map<string, EmployeeRow>> {
  const map = new Map<string, EmployeeRow>();
  if (fyo.singles.SystemSettings?.countryCode !== 'dz') {
    return map;
  }

  const employees = (await fyo.db.getAllRaw(ModelNameEnum.Employee, {
    fields: ['name', 'firstName', 'lastName', 'nin', 'cnasNumber'],
  })) as unknown as EmployeeRow[];

  for (const employee of employees) {
    map.set(employee.name, employee);
  }

  return map;
}

/** Splits a "YYYY-MM" period into its numeric parts (or null if unparseable). */
export function periodToYearMonth(
  period: string
): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period ?? '');
  if (!match) {
    return null;
  }

  return { year: Number(match[1]), month: Number(match[2]) };
}

const QUARTERS: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

export function quarterMonths(quarter: number): number[] {
  return QUARTERS[quarter] ?? [];
}

/**
 * Pure, importable report builders.
 *
 * These were extracted out of the G50/DTS/DAS `Report` subclasses so the
 * aggregation logic can be unit-tested without instantiating those classes
 * (which pull in the Vue-tainted `reports/commonExporter` graph). The report
 * classes below call these and pass through their `fyo.format` binding.
 */

export function g50Deadline(year: number, month: number): string {
  const due = DateTime.fromObject({ year, month })
    .plus({ months: 1 })
    .set({ day: 20 });
  return t`20th of the following month: ${due.toFormat('dd LLL yyyy')}`;
}

export function dasDeadline(year: number): string {
  return t`Before 31 March ${year + 1}`;
}

export interface G50Accumulator {
  gross: number;
  employeeCNAS: number;
  employerCNAS: number;
  irg: number;
  netPay: number;
  count: number;
}

export function buildG50Rows(
  slips: SlipRow[],
  year: number,
  month: number,
  format: Formatter
): ReportData {
  const filtered = slips.filter((s) => {
    const pm = periodToYearMonth(s.period);
    return !!pm && pm.year === year && pm.month === month;
  });

  const totals = filtered.reduce(
    (acc: G50Accumulator, s) => {
      acc.gross += num(s.gross);
      acc.employeeCNAS += num(s.employeeCNAS);
      acc.employerCNAS += num(s.employerCNAS);
      acc.irg += num(s.irg);
      acc.netPay += num(s.netPay);
      acc.count += 1;
      return acc;
    },
    { gross: 0, employeeCNAS: 0, employerCNAS: 0, irg: 0, netPay: 0, count: 0 }
  );

  const periodLabel = month
    ? `${year}-${String(month).padStart(2, '0')}`
    : `${year}`;

  const cells: ReportCell[] = [
    { rawValue: periodLabel, value: periodLabel, align: 'left', width: 1.25 },
    {
      rawValue: totals.count,
      value: format(totals.count, 'Int'),
      align: 'right',
      width: 0.75,
    },
    {
      rawValue: totals.gross,
      value: format(totals.gross, 'Currency'),
      align: 'right',
    },
    {
      rawValue: totals.employeeCNAS,
      value: format(totals.employeeCNAS, 'Currency'),
      align: 'right',
    },
    {
      rawValue: totals.employerCNAS,
      value: format(totals.employerCNAS, 'Currency'),
      align: 'right',
    },
    {
      rawValue: totals.irg,
      value: format(totals.irg, 'Currency'),
      align: 'right',
      bold: true,
      width: 1.25,
    },
    {
      rawValue: totals.netPay,
      value: format(totals.netPay, 'Currency'),
      align: 'right',
    },
    {
      rawValue: g50Deadline(year, month),
      value: g50Deadline(year, month),
      align: 'left',
      width: 1.75,
    },
  ];

  return [{ cells }];
}

interface EmployeeAccumulator {
  gross: number;
  employeeCNAS: number;
  employerCNAS: number;
  netPay: number;
}

export function buildDtsRows(
  slips: SlipRow[],
  employees: Map<string, EmployeeRow>,
  year: number,
  quarter: number,
  format: Formatter
): ReportData {
  const months = quarterMonths(quarter);
  const filtered = slips.filter((s) => {
    const pm = periodToYearMonth(s.period);
    return !!pm && pm.year === year && months.includes(pm.month);
  });

  const acc = new Map<string, EmployeeAccumulator>();
  for (const s of filtered) {
    const key = s.employee;
    const a = acc.get(key) ?? {
      gross: 0,
      employeeCNAS: 0,
      employerCNAS: 0,
      netPay: 0,
    };
    a.gross += num(s.gross);
    a.employeeCNAS += num(s.employeeCNAS);
    a.employerCNAS += num(s.employerCNAS);
    a.netPay += num(s.netPay);
    acc.set(key, a);
  }

  const reportRows: ReportData = [];
  for (const [employee, a] of acc) {
    const emp = employees.get(employee) ?? {
      name: employee,
      firstName: '',
      lastName: '',
      nin: '',
      cnasNumber: '',
    };

    const displayName =
      [emp.firstName, emp.lastName].filter(Boolean).join(' ') || employee;

    const cells: ReportCell[] = [
      { rawValue: displayName, value: displayName, align: 'left', width: 1.5 },
      {
        rawValue: emp.nin,
        value: emp.nin || t`MISSING_NIN`,
        align: 'left',
        color: emp.nin ? undefined : 'red',
        bold: !emp.nin,
        width: 1.25,
      },
      { rawValue: emp.cnasNumber, value: emp.cnasNumber, align: 'left' },
      { rawValue: a.gross, value: format(a.gross, 'Currency'), align: 'right' },
      {
        rawValue: a.employeeCNAS,
        value: format(a.employeeCNAS, 'Currency'),
        align: 'right',
      },
      {
        rawValue: a.employerCNAS,
        value: format(a.employerCNAS, 'Currency'),
        align: 'right',
      },
      {
        rawValue: a.netPay,
        value: format(a.netPay, 'Currency'),
        align: 'right',
      },
    ];

    reportRows.push({ cells });
  }

  // totals row
  const totals = [...acc.values()].reduce(
    (t: EmployeeAccumulator, a) => {
      t.gross += a.gross;
      t.employeeCNAS += a.employeeCNAS;
      t.employerCNAS += a.employerCNAS;
      t.netPay += a.netPay;
      return t;
    },
    { gross: 0, employeeCNAS: 0, employerCNAS: 0, netPay: 0 }
  );

  const totalCells: ReportCell[] = [
    {
      rawValue: 'Total',
      value: t`Total`,
      align: 'left',
      width: 1.5,
      bold: true,
    },
    { rawValue: '', value: '', align: 'left', width: 1.25 },
    { rawValue: '', value: '', align: 'left' },
    {
      rawValue: totals.gross,
      value: format(totals.gross, 'Currency'),
      align: 'right',
      bold: true,
    },
    {
      rawValue: totals.employeeCNAS,
      value: format(totals.employeeCNAS, 'Currency'),
      align: 'right',
      bold: true,
    },
    {
      rawValue: totals.employerCNAS,
      value: format(totals.employerCNAS, 'Currency'),
      align: 'right',
      bold: true,
    },
    {
      rawValue: totals.netPay,
      value: format(totals.netPay, 'Currency'),
      align: 'right',
      bold: true,
    },
  ];

  reportRows.push({ cells: totalCells });
  return reportRows;
}

interface DasAccumulator {
  gross: number;
  employeeCNAS: number;
  employerCNAS: number;
  netPay: number;
  totalEmployerCost: number;
}

export function buildDasRows(
  slips: SlipRow[],
  employees: Map<string, EmployeeRow>,
  year: number,
  format: Formatter
): ReportData {
  const filtered = slips.filter((s) => {
    const pm = periodToYearMonth(s.period);
    return !!pm && pm.year === year;
  });

  const acc = new Map<string, DasAccumulator>();
  for (const s of filtered) {
    const key = s.employee;
    const a = acc.get(key) ?? {
      gross: 0,
      employeeCNAS: 0,
      employerCNAS: 0,
      netPay: 0,
      totalEmployerCost: 0,
    };
    a.gross += num(s.gross);
    a.employeeCNAS += num(s.employeeCNAS);
    a.employerCNAS += num(s.employerCNAS);
    a.netPay += num(s.netPay);
    a.totalEmployerCost += num(s.totalEmployerCost);
    acc.set(key, a);
  }

  const deadline = dasDeadline(year);
  const reportRows: ReportData = [];

  for (const [employee, a] of acc) {
    const emp = employees.get(employee) ?? {
      name: employee,
      firstName: '',
      lastName: '',
      nin: '',
      cnasNumber: '',
    };

    const displayName =
      [emp.firstName, emp.lastName].filter(Boolean).join(' ') || employee;

    const cells: ReportCell[] = [
      { rawValue: displayName, value: displayName, align: 'left', width: 1.5 },
      {
        rawValue: emp.nin,
        value: emp.nin || t`MISSING_NIN`,
        align: 'left',
        color: emp.nin ? undefined : 'red',
        bold: !emp.nin,
        width: 1.25,
      },
      { rawValue: emp.cnasNumber, value: emp.cnasNumber, align: 'left' },
      { rawValue: a.gross, value: format(a.gross, 'Currency'), align: 'right' },
      {
        rawValue: a.employeeCNAS,
        value: format(a.employeeCNAS, 'Currency'),
        align: 'right',
      },
      {
        rawValue: a.employerCNAS,
        value: format(a.employerCNAS, 'Currency'),
        align: 'right',
      },
      {
        rawValue: a.totalEmployerCost,
        value: format(a.totalEmployerCost, 'Currency'),
        align: 'right',
      },
      {
        rawValue: a.netPay,
        value: format(a.netPay, 'Currency'),
        align: 'right',
      },
      { rawValue: deadline, value: deadline, align: 'left', width: 1.5 },
    ];

    reportRows.push({ cells });
  }

  // summary totals row
  const totals = [...acc.values()].reduce(
    (t: DasAccumulator, a) => {
      t.gross += a.gross;
      t.employeeCNAS += a.employeeCNAS;
      t.employerCNAS += a.employerCNAS;
      t.netPay += a.netPay;
      t.totalEmployerCost += a.totalEmployerCost;
      return t;
    },
    {
      gross: 0,
      employeeCNAS: 0,
      employerCNAS: 0,
      netPay: 0,
      totalEmployerCost: 0,
    }
  );

  const totalCells: ReportCell[] = [
    {
      rawValue: 'Total',
      value: t`Total`,
      align: 'left',
      width: 1.5,
      bold: true,
    },
    { rawValue: '', value: '', align: 'left', width: 1.25 },
    { rawValue: '', value: '', align: 'left' },
    {
      rawValue: totals.gross,
      value: format(totals.gross, 'Currency'),
      align: 'right',
      bold: true,
    },
    {
      rawValue: totals.employeeCNAS,
      value: format(totals.employeeCNAS, 'Currency'),
      align: 'right',
      bold: true,
    },
    {
      rawValue: totals.employerCNAS,
      value: format(totals.employerCNAS, 'Currency'),
      align: 'right',
      bold: true,
    },
    {
      rawValue: totals.totalEmployerCost,
      value: format(totals.totalEmployerCost, 'Currency'),
      align: 'right',
      bold: true,
    },
    {
      rawValue: totals.netPay,
      value: format(totals.netPay, 'Currency'),
      align: 'right',
      bold: true,
    },
    { rawValue: deadline, value: deadline, align: 'left', width: 1.5 },
  ];

  reportRows.push({ cells: totalCells });
  return reportRows;
}
