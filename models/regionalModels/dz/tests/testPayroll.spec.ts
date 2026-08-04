import test from 'tape';
import { calculateDZPayroll, CNAS_EMPLOYEE_TOTAL } from '../payroll';

test('calculateDZPayroll reproduces the 80,000 DZD worked example', (t) => {
  const r = calculateDZPayroll(80_000);

  t.equal(r.gross, 80_000);
  t.equal(r.employeeCNAS, 7_200); // 9% of 80,000
  t.equal(r.netSocial, 72_800); // 80,000 - 7,200
  t.equal(r.abatement, 29_120); // 40% of 72,800 (uncapped - see TODO)
  t.equal(r.taxableBase, 43_680); // 72,800 - 29,120
  t.equal(r.irg, 3_146); // (43,680 - 30,000) * 23% = 3,146.4 floored
  t.equal(r.netPay, 69_654); // 80,000 - 7,200 - 3,146
  t.equal(r.belowSNMG, false);

  t.end();
});

test('IRG is marginal, not a flat top-bracket rate', (t) => {
  // 50,000 gross: taxable base stays within the 0% band -> IRG 0.
  t.equal(calculateDZPayroll(50_000).irg, 0);

  // Sanity: employee CNAS rate is the declared 9% total.
  const empRate = (calculateDZPayroll(100_000).employeeCNAS / 100_000) * 100;
  t.equal(empRate, CNAS_EMPLOYEE_TOTAL);

  t.end();
});

test('gross below SNMG warns but still computes', (t) => {
  t.doesNotThrow(() => calculateDZPayroll(20_000));
  t.equal(calculateDZPayroll(20_000).belowSNMG, true);
  t.end();
});

test('negative gross throws', (t) => {
  t.throws(() => calculateDZPayroll(-1), RangeError);
  t.end();
});
