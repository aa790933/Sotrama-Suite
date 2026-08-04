import test from 'tape';
import { calculateDZPayroll } from '../payroll';
import {
  OVERTIME_REST_DAY_MULTIPLIER,
  OVERTIME_STANDARD_MULTIPLIER,
  buildSalarySlipPostingLines,
  getGrossNumber,
} from '../salarySlipLogic';

test('getGrossNumber returns the base salary when there are no earnings', (t) => {
  t.equal(getGrossNumber(80_000), 80_000);
  t.equal(getGrossNumber(80_000, []), 80_000);
  t.end();
});

test('rest-day overtime is paid at 1.5x the rate', (t) => {
  const gross = getGrossNumber(
    80_000,
    [{ type: 'overtime', hours: 2, restDayOrHoliday: true }],
    500
  );
  t.equal(gross, 80_000 + 2 * 500 * OVERTIME_REST_DAY_MULTIPLIER);
  t.equal(gross, 81_500);
  t.end();
});

test('standard overtime is 1.25x and allowances add flat', (t) => {
  const gross = getGrossNumber(
    80_000,
    [
      { type: 'overtime', hours: 4 }, // 4 * 500 * 1.25 = 2500
      { type: 'housing', amount: 7_000 },
    ],
    500
  );
  t.equal(gross, 80_000 + 2_500 + 7_000);
  t.equal(gross, 89_500);
  t.end();
});

test('overtime row without an explicit rate falls back to the employee rate', (t) => {
  const gross = getGrossNumber(
    100_000,
    [{ type: 'overtime', hours: 10, overtimeRate: 800 }],
    500
  );
  t.equal(gross, 100_000 + 10 * 800 * OVERTIME_STANDARD_MULTIPLIER);
  t.end();
});

test('salary slip posting lines always balance', (t) => {
  const payroll = calculateDZPayroll(80_000);
  const lines = buildSalarySlipPostingLines(payroll, 'Caisse');

  const debit = lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0);

  t.equal(debit, credit, 'total debits equal total credits');
  t.equal(lines.length, 4, 'touches four accounts');
  t.end();
});

test('net pay is gross minus employee CNAS minus IRG', (t) => {
  const payroll = calculateDZPayroll(80_000);
  t.equal(payroll.netPay, payroll.gross - payroll.employeeCNAS - payroll.irg);
  t.end();
});

test('gross below SNMG still yields a balanced slip', (t) => {
  const payroll = calculateDZPayroll(20_000);
  const lines = buildSalarySlipPostingLines(payroll);
  const debit = lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0);
  t.equal(debit, credit);
  t.equal(payroll.belowSNMG, true);
  t.end();
});
