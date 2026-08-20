/**
 * Algeria (dz) leave-accrual engine.
 *
 * Rule (per spec): an employee accrues 2.5 days of annual leave for each
 * FULL calendar month worked since hire, capped at 30 days per year
 * (2.5 * 12 = 30). The July 1 – June 30 reference period defines the annual
 * cap window (the "année de référence"); carry-over of unused balance is a
 * separate concern outside this computation.
 *
 * A month is "fully worked" when the employee's hire day-of-month has been
 * reached in the comparison month (the standard month-boundary rule).
 */

export const ACCRUAL_RATE_PER_MONTH = 2.5;
export const ANNUAL_ACCRUAL_CAP = 30;
export const ACCRUAL_REFERENCE_MONTH = 6; // July (0-indexed) — start of the reference period

/** Whole calendar months between `start` (inclusive) and `asOf` (inclusive). */
function fullMonthsBetween(start: Date, asOf: Date): number {
  let months =
    (asOf.getFullYear() - start.getFullYear()) * 12 +
    (asOf.getMonth() - start.getMonth());
  if (asOf.getDate() < start.getDate()) {
    months -= 1; // current month not yet full
  }
  return Math.max(0, months);
}

/**
 * Accrued leave days as of `asOf`, based on the employee's `hireDate`.
 *
 * Capped at 30 days; seniority beyond one year does not compound past the cap.
 */
export function accruedLeaveDays(hire: Date, asOf: Date): number {
  return Math.min(
    ANNUAL_ACCRUAL_CAP,
    fullMonthsBetween(hire, asOf) * ACCRUAL_RATE_PER_MONTH
  );
}

/**
 * Inclusive calendar-day duration of a leave request over `[start, end]`.
 *
 * Both endpoints are counted (a request that starts and ends on the same date
 * returns 1). Days are measured as whole 24-hour steps; because leave dates are
 * stored at midnight UTC this is independent of the process timezone.
 */
export function leaveDurationDays(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / msPerDay) + 1
  );
}
