import test from 'tape';
import { DateTime } from 'luxon';
import { ReportCell, ReportRow } from '../../../../reports/types';
import {
  buildDasRows,
  buildDtsRows,
  buildG50Rows,
  EmployeeRow,
  periodToYearMonth,
  SlipRow,
} from '../../../../reports/Statutory/dzPayrollData';

// Identity formatter: report cells store the unformatted value in `rawValue`
// (which is what we assert on), so formatting is irrelevant for these tests.
const format = (v: unknown): string => String(v);

// Employees: E2 has NO nin -> used to exercise the MISSING_NIN flag.
const employees: EmployeeRow[] = [
  {
    name: 'EMP-001',
    firstName: 'Amine',
    lastName: 'Berkani',
    nin: '123456987',
    cnasNumber: 'CNAS-001',
  },
  {
    name: 'EMP-002',
    firstName: 'Chérif',
    lastName: 'Djaziri',
    nin: '',
    cnasNumber: 'CNAS-002',
  },
  {
    name: 'EMP-003',
    firstName: 'Dina',
    lastName: 'Meziane',
    nin: '987654321',
    cnasNumber: 'CNAS-003',
  },
];

const employeeMap = new Map<string, EmployeeRow>();
for (const e of employees) {
  employeeMap.set(e.name, e);
}

// Five submitted slips across Jan/Feb/Mar/Apr 2024 so we can exercise
// monthly (G50), quarterly (DTS Q1 = Jan/Feb/Mar), and annual (DAS) aggregation.
const slips: SlipRow[] = [
  {
    name: 'SLIP-001',
    employee: 'EMP-001',
    employeeName: 'Amine Berkani',
    period: '2024-01',
    month: 1,
    gross: 100_000,
    employeeCNAS: 9_000,
    employerCNAS: 26_000,
    netSocial: 91_000,
    abatement: 0,
    taxableBase: 0,
    irg: 12_000,
    netPay: 79_000,
    totalEmployerCost: 126_000,
    status: 'Submitted',
  },
  {
    name: 'SLIP-002',
    employee: 'EMP-001',
    employeeName: 'Amine Berkani',
    period: '2024-02',
    month: 2,
    gross: 110_000,
    employeeCNAS: 9_900,
    employerCNAS: 28_600,
    netSocial: 100_100,
    abatement: 0,
    taxableBase: 0,
    irg: 13_500,
    netPay: 86_600,
    totalEmployerCost: 138_600,
    status: 'Submitted',
  },
  {
    name: 'SLIP-003',
    employee: 'EMP-002',
    employeeName: 'Chérif Djaziri',
    period: '2024-01',
    month: 1,
    gross: 90_000,
    employeeCNAS: 8_100,
    employerCNAS: 23_400,
    netSocial: 81_900,
    abatement: 0,
    taxableBase: 0,
    irg: 9_000,
    netPay: 72_900,
    totalEmployerCost: 113_400,
    status: 'Submitted',
  },
  {
    name: 'SLIP-004',
    employee: 'EMP-003',
    employeeName: 'Dina Meziane',
    period: '2024-04',
    month: 4,
    gross: 120_000,
    employeeCNAS: 10_800,
    employerCNAS: 31_200,
    netSocial: 109_200,
    abatement: 0,
    taxableBase: 0,
    irg: 15_000,
    netPay: 94_200,
    totalEmployerCost: 136_800,
    status: 'Submitted',
  },
  {
    name: 'SLIP-005',
    employee: 'EMP-002',
    employeeName: 'Chérif Djaziri',
    period: '2024-03',
    month: 3,
    gross: 95_000,
    employeeCNAS: 8_550,
    employerCNAS: 24_700,
    netSocial: 86_450,
    abatement: 0,
    taxableBase: 0,
    irg: 9_500,
    netPay: 76_950,
    totalEmployerCost: 119_700,
    status: 'Submitted',
  },
];

function byName(rows: ReportRow[], displayName: string): ReportRow | undefined {
  return rows.find((r) => r.cells[0].rawValue === displayName);
}

function cell(row: ReportRow, i: number): ReportCell {
  return row.cells[i];
}

test('G50: monthly IRG totals equal the manual sum for the selected month', (t) => {
  // January 2024 -> SLIP-001 (12,000) + SLIP-003 (9,000) = 21,000.
  const data = buildG50Rows(slips, 2024, 1, format);
  t.equal(data.length, 1, 'G50 emits a single monthly totals row');
  const row = data[0];

  const janSlips = slips.filter((s) => {
    const pm = periodToYearMonth(s.period);
    return pm && pm.year === 2024 && pm.month === 1;
  });
  const expectedIrg = janSlips.reduce((n, s) => n + s.irg, 0);

  t.equal(cell(row, 0).rawValue, '2024-01', 'period label is YYYY-MM');
  t.equal(cell(row, 1).rawValue, 2, 'slip count for Jan 2024 is 2');
  t.equal(cell(row, 5).rawValue, expectedIrg, 'total IRG equals manual sum');
  t.equal(cell(row, 5).rawValue, 21_000, 'IRG total is exactly 21,000');

  // Sanity: a single-slip month (April) isolates one row.
  const apr = buildG50Rows(slips, 2024, 4, format);
  t.equal(cell(apr[0], 1).rawValue, 1, 'Apr 2024 slip count is 1');
  t.equal(cell(apr[0], 5).rawValue, 15_000, 'Apr 2024 IRG is 15,000');

  t.end();
});

test('G50: legal deadline is the 20th of the following month', (t) => {
  const row = buildG50Rows(slips, 2024, 1, format)[0];

  const expected = `20th of the following month: ${DateTime.fromObject({
    year: 2024,
    month: 1,
  })
    .plus({ months: 1 })
    .set({ day: 20 })
    .toFormat('dd LLL yyyy')}`;
  t.equal(
    cell(row, 7).rawValue,
    expected,
    'deadline label matches the formula'
  );
  t.match(
    cell(row, 7).rawValue as string,
    /20\d{2}/,
    'deadline references the year'
  );

  t.end();
});

test('DTS: quarterly per-employee totals and totals row match manual sums', (t) => {
  // Q1 2024 = Jan/Feb/Mar -> E1 (Jan+Feb), E2 (Jan+Mar).
  const rows = buildDtsRows(slips, employeeMap, 2024, 1, format);
  t.equal(rows.length, 3, 'DTS Q1 emits 2 employees + 1 totals row');

  const e1 = byName(rows, 'Amine Berkani');
  const e2 = byName(rows, 'Chérif Djaziri');
  t.ok(e1, 'E1 row present');
  t.ok(e2, 'E2 row present');
  if (!e1 || !e2) {
    t.end();
    return;
  }

  // E1: gross 210000, empCNAS 18900, employerCNAS 54600, netPay 165600.
  t.equal(cell(e1, 3).rawValue, 210_000, 'E1 Q1 gross');
  t.equal(cell(e1, 4).rawValue, 18_900, 'E1 Q1 employee CNAS');
  t.equal(cell(e1, 5).rawValue, 54_600, 'E1 Q1 employer CNAS');
  t.equal(cell(e1, 6).rawValue, 165_600, 'E1 Q1 net pay');

  // E2 missing NIN -> flagged.
  t.equal(cell(e2, 1).rawValue, '', 'E2 nin rawValue is empty');
  t.equal(
    cell(e2, 1).value,
    'MISSING_NIN',
    'E2 nin value is the MISSING_NIN sentinel'
  );
  t.equal(cell(e2, 1).bold, true, 'E2 nin cell is bold');
  t.equal(cell(e2, 1).color, 'red', 'E2 nin cell is red');
  t.equal(cell(e2, 3).rawValue, 185_000, 'E2 Q1 gross');
  t.equal(cell(e2, 6).rawValue, 149_850, 'E2 Q1 net pay');

  // Totals row is last: gross 395000, empCNAS 35550, employerCNAS 102700, netPay 315450.
  const totals = rows[rows.length - 1];
  t.equal(cell(totals, 3).rawValue, 395_000, 'DTS Q1 totals gross');
  t.equal(cell(totals, 4).rawValue, 35_550, 'DTS Q1 totals employee CNAS');
  t.equal(cell(totals, 5).rawValue, 102_700, 'DTS Q1 totals employer CNAS');
  t.equal(cell(totals, 6).rawValue, 315_450, 'DTS Q1 totals net pay');

  t.end();
});

test('DAS: annual per-employee summary + totals row + MISSING_NIN flag', (t) => {
  const rows = buildDasRows(slips, employeeMap, 2024, format);
  t.equal(rows.length, 4, 'DAS 2024 emits 3 employees + 1 totals row');

  const e1 = byName(rows, 'Amine Berkani');
  const e2 = byName(rows, 'Chérif Djaziri');
  const e3 = byName(rows, 'Dina Meziane');
  t.ok(e1, 'E1 row present');
  t.ok(e2, 'E2 row present');
  t.ok(e3, 'E3 row present');
  if (!e1 || !e2 || !e3) {
    t.end();
    return;
  }

  // E1 has a NIN -> not flagged (bold false, no red).
  t.equal(cell(e1, 1).rawValue, '123456987', 'E1 nin rawValue present');
  t.equal(cell(e1, 1).value, '123456987', 'E1 nin value not flagged');
  t.equal(cell(e1, 1).bold, false, 'E1 nin cell not bold');
  t.equal(cell(e1, 1).color, undefined, 'E1 nin cell not red');
  // E1 annual: gross 210000, empCNAS 18900, employerCNAS 54600, totalEmployerCost 264600, netPay 165600.
  t.equal(cell(e1, 3).rawValue, 210_000, 'E1 annual gross');
  t.equal(cell(e1, 4).rawValue, 18_900, 'E1 annual employee CNAS');
  t.equal(cell(e1, 5).rawValue, 54_600, 'E1 annual employer CNAS');
  t.equal(cell(e1, 6).rawValue, 264_600, 'E1 annual total employer cost');
  t.equal(cell(e1, 7).rawValue, 165_600, 'E1 annual net pay');

  // E2 missing NIN -> flagged exactly once; numeric totals still correct.
  t.equal(cell(e2, 1).rawValue, '', 'E2 nin rawValue empty');
  t.equal(
    cell(e2, 1).value,
    'MISSING_NIN',
    'E2 nin value is MISSING_NIN sentinel'
  );
  t.equal(cell(e2, 1).bold, true, 'E2 nin cell bold');
  t.equal(cell(e2, 1).color, 'red', 'E2 nin cell red');
  t.equal(cell(e2, 3).rawValue, 185_000, 'E2 annual gross');
  t.equal(cell(e2, 6).rawValue, 233_100, 'E2 annual total employer cost');
  t.equal(cell(e2, 7).rawValue, 149_850, 'E2 annual net pay');

  // E3 only the April slip.
  t.equal(cell(e3, 3).rawValue, 120_000, 'E3 annual gross');
  t.equal(cell(e3, 7).rawValue, 94_200, 'E3 annual net pay');

  // Totals row (last): gross 515000, empCNAS 46350, employerCNAS 133900, totalEmployerCost 634500, netPay 409650.
  const totals = rows[rows.length - 1];
  t.equal(cell(totals, 3).rawValue, 515_000, 'DAS totals gross');
  t.equal(cell(totals, 4).rawValue, 46_350, 'DAS totals employee CNAS');
  t.equal(cell(totals, 5).rawValue, 133_900, 'DAS totals employer CNAS');
  t.equal(cell(totals, 6).rawValue, 634_500, 'DAS totals employer cost');
  t.equal(cell(totals, 7).rawValue, 409_650, 'DAS totals net pay');

  // Deadline = "Before 31 March 2025".
  t.equal(
    cell(totals, 8).rawValue,
    `Before 31 March ${2024 + 1}`,
    'DAS deadline label'
  );

  t.end();
});
