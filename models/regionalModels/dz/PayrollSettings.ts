import { Doc } from 'fyo/model/doc';

/**
 * Payroll Settings singleton (countryCode: "dz").
 *
 * Replaces the hardcoded tax-year constants that previously lived in
 * payroll.ts. All values default to the 2026 legal rates baked into the
 * schema; users can edit them from the Settings screen.
 *
 * When `fyo.singles.PayrollSettings` is not loaded (e.g. in unit tests),
 * the payroll engine falls back to the module-level DEFAULT constants.
 */
export class PayrollSettings extends Doc {
  snmg?: number;
  cnasEmployeeRate?: number;
  cnasEmployerRate?: number;
  irgBracket1Limit?: number;
  irgBracket1Rate?: number;
  irgBracket2Limit?: number;
  irgBracket2Rate?: number;
  irgBracket3Limit?: number;
  irgBracket3Rate?: number;
  irgBracket4Rate?: number;
  professionalExpenseRate?: number;
  abatementMin?: number;
  abatementMax?: number;
}
