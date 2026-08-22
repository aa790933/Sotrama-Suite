import test from 'tape';
import {
  ACCRUAL_RATE_PER_MONTH,
  ANNUAL_ACCRUAL_CAP,
  accruedLeaveDays,
  leaveDurationDays,
} from '../leaveAccrual';

const jane = (iso: string) => new Date(iso);

test('accrual rate and cap are 2.5 days/month and 30 days', (t) => {
  t.equal(ACCRUAL_RATE_PER_MONTH, 2.5);
  t.equal(ANNUAL_ACCRUAL_CAP, 30);
  t.end();
});

test('under one full month worked yields 0 accrued days', (t) => {
  t.equal(
    accruedLeaveDays(
      jane('2024-07-01T00:00:00Z'),
      jane('2024-07-15T00:00:00Z')
    ),
    0
  );
  t.end();
});

test('one full month worked yields 2.5 days', (t) => {
  t.equal(
    accruedLeaveDays(
      jane('2024-07-01T00:00:00Z'),
      jane('2024-08-01T00:00:00Z')
    ),
    2.5
  );
  t.end();
});

test('three full months worked yields 7.5 days (cap not yet hit)', (t) => {
  t.equal(
    accruedLeaveDays(
      jane('2024-07-01T00:00:00Z'),
      jane('2024-10-01T00:00:00Z')
    ),
    7.5
  );
  t.end();
});

test('twelve full months worked yields 30 days (cap applies)', (t) => {
  t.equal(
    accruedLeaveDays(
      jane('2024-07-01T00:00:00Z'),
      jane('2025-07-01T00:00:00Z')
    ),
    30
  );
  t.end();
});

test('seniority beyond one year does not compound past the cap', (t) => {
  // 36 months tenure -> still capped at 30
  t.equal(
    accruedLeaveDays(
      jane('2022-07-01T00:00:00Z'),
      jane('2025-07-01T00:00:00Z')
    ),
    30
  );
  t.end();
});

test('the Jan-15 -> Mar-20 worked example', (t) => {
  // employee hired Jan 1, 2024
  const hire = jane('2024-01-01T00:00:00Z');
  // as of the leave start (Jan 15): 0 full months worked
  t.equal(accruedLeaveDays(hire, jane('2024-01-15T00:00:00Z')), 0);
  // as of Mar 20: Jan + Feb full = 2 months -> 5 days
  t.equal(accruedLeaveDays(hire, jane('2024-03-20T00:00:00Z')), 5);
  // as of Apr 1: 3 full months -> 7.5 days (the spec point "3 months -> 7.5")
  t.equal(accruedLeaveDays(hire, jane('2024-04-01T00:00:00Z')), 7.5);
  t.end();
});

test('hire day-of-month later in the month is not counted as full until reached', (t) => {
  // hired Jul 15, asOf Jul 20 -> 0 full months (same month, partial)
  t.equal(
    accruedLeaveDays(
      jane('2024-07-15T00:00:00Z'),
      jane('2024-07-20T00:00:00Z')
    ),
    0
  );
  // asOf the 1st month later, day reached -> 1 full month -> 2.5
  t.equal(
    accruedLeaveDays(
      jane('2024-07-15T00:00:00Z'),
      jane('2024-08-15T00:00:00Z')
    ),
    2.5
  );
  // asOf one day short of the anniversary -> 0
  t.equal(
    accruedLeaveDays(
      jane('2024-07-15T00:00:00Z'),
      jane('2024-08-14T00:00:00Z')
    ),
    0
  );
  t.end();
});

test('leaveDurationDays counts both endpoints inclusively', (t) => {
  const d = (iso: string) => new Date(iso);
  t.equal(
    leaveDurationDays(d('2026-02-10T00:00:00Z'), d('2026-02-10T00:00:00Z')),
    1
  ); // same day = 1
  t.equal(
    leaveDurationDays(d('2026-02-01T00:00:00Z'), d('2026-02-10T00:00:00Z')),
    10
  ); // 10 inclusive
  t.equal(
    leaveDurationDays(d('2026-02-10T00:00:00Z'), d('2026-02-21T00:00:00Z')),
    12
  ); // 12 inclusive
  t.end();
});

test('leaveDurationDays never goes negative for inverted bounds', (t) => {
  const a = new Date('2026-02-21T00:00:00Z');
  const b = new Date('2026-02-10T00:00:00Z');
  t.equal(leaveDurationDays(a, b), 0);
  t.end();
});
