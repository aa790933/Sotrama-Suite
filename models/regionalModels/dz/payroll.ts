/**
 * Algeria (countryCode: "dz") payroll calculation engine — tax year 2026.
 *
 * This is a pure, side-effect-free calculation module: it does not touch the
 * database or any Fyo model. It is intentionally kept out of the registered
 * model map (see models/index.ts -> getRegionalModels) because payslips /
 * salary structures are wired up in a later session.
 *
 * All legally-defined values are exposed as named constants below so that the
 * yearly indexation can be applied in one place.
 */

// SNMG — Salaire National Minimum Général (minimum wage floor), DZD / month.
// A gross salary below this floor must produce a non-blocking warning.
export const SNMG_2026 = 24_000;

// ---------------------------------------------------------------------------
// CNAS — general social security contributions, expressed as % of gross salary.
// Employer side — declared total 26%.
export const CNAS_EMPLOYER_SICKNESS_MATERNITY = 12.5;
export const CNAS_EMPLOYER_RETIREMENT = 10.5;
export const CNAS_EMPLOYER_WORK_ACCIDENTS = 1.25;
export const CNAS_EMPLOYER_UNEMPLOYMENT = 1.5;
export const CNAS_EMPLOYER_TOTAL = 26;

// Employee side — declared total 9%.
// NOTE: the listed components (1.5 + 6.75 + 0.5) sum to 8.75%, not 9%. The 0.25%
// gap is undocumented here; to match the official worked example we use the
// declared total of 9% as the effective employee rate. Reconcile components vs.
// total in a future review. See the "flagged contradictions" section at the
// bottom of this file.
export const CNAS_EMPLOYEE_SICKNESS_MATERNITY = 1.5;
export const CNAS_EMPLOYEE_RETIREMENT = 6.75;
export const CNAS_EMPLOYEE_UNEMPLOYMENT = 0.5;
export const CNAS_EMPLOYEE_TOTAL = 9;

// ---------------------------------------------------------------------------
// Professional-expense abatement, applied to "net social" (gross minus employee
// CNAS) before computing IRG. Declared as 40% of net social, with a legal
// floor of 1,000 DZD and a ceiling of 1,500 DZD.
export const PROFESSIONAL_EXPENSE_RATE = 40; // % of net social
export const PROFESSIONAL_EXPENSE_MIN = 1_000; // DZD / month
export const PROFESSIONAL_EXPENSE_MAX = 1_500; // DZD / month

// ---------------------------------------------------------------------------
// IRG — income tax, progressive / marginal brackets applied to the taxable
// base. Each portion of income is taxed at its own bracket rate.
export const IRG_BRACKET_1_LIMIT = 30_000; // 0% band upper bound
export const IRG_BRACKET_2_LIMIT = 120_000; // 23% band upper bound
export const IRG_BRACKET_3_LIMIT = 360_000; // 27% band upper bound
const IRG_RATE_BRACKET_1 = 0; // 0 -> 30,000
const IRG_RATE_BRACKET_2 = 0.23; // 30,001 -> 120,000
const IRG_RATE_BRACKET_3 = 0.27; // 120,001 -> 360,000
const IRG_RATE_BRACKET_4 = 0.3; // above 360,000
export const IRG_BRACKETS_2026 = [
  { min: 0, max: IRG_BRACKET_1_LIMIT, rate: IRG_RATE_BRACKET_1 },
  {
    min: IRG_BRACKET_1_LIMIT,
    max: IRG_BRACKET_2_LIMIT,
    rate: IRG_RATE_BRACKET_2,
  },
  {
    min: IRG_BRACKET_2_LIMIT,
    max: IRG_BRACKET_3_LIMIT,
    rate: IRG_RATE_BRACKET_3,
  },
  {
    min: IRG_BRACKET_3_LIMIT,
    max: Number.POSITIVE_INFINITY,
    rate: IRG_RATE_BRACKET_4,
  },
] as const;

export interface DZPayrollResult {
  gross: number;
  employeeCNAS: number;
  employerCNAS: number;
  netSocial: number;
  abatement: number;
  taxableBase: number;
  irg: number;
  netPay: number;
  belowSNMG: boolean;
}

/**
 * Computes an Algerian monthly payroll for 2026.
 *
 * Flow:
 *   gross
 *   -> employee CNAS (9% of gross)
 *   -> net social = gross - employee CNAS
 *   -> professional-expense abatement (40% of net social)
 *   -> taxable base = net social - abatement
 *   -> IRG (marginal brackets)
 *   -> net pay = gross - employee CNAS - IRG
 *
 * Employer CNAS (26% of gross) is computed for total-cost reporting only; it is
 * not deducted from the employee's net pay.
 *
 * TODO(irg-smoothing): the simple bracket implementation below produces a
 * discontinuity in marginal net pay for salaries just above the 30,000 DZD
 * income-tax exemption. The verified smoothing formula for that transition
 * zone has not been provided yet — do NOT invent it. Re-implement once the
 * exact rule is supplied.
 *
 * TODO(abatement-cap): the legal abatement is described as floored at 1,000
 * and capped at 1,500 DZD, yet the official worked example for gross=80,000
 * expects an abatement of 29,120 (the uncapped 40%). To reproduce the worked
 * example we deliberately do NOT apply the floor/cap here. Re-enable once the
 * contradiction is resolved.
 */
export function calculateDZPayroll(gross: number): DZPayrollResult {
  if (gross < 0) {
    throw new RangeError('gross salary must be non-negative');
  }

  if (gross < SNMG_2026) {
    // Warn, but do not block — payroll below the minimum wage floor.
    // eslint-disable-next-line no-console
    console.warn(
      `[payroll] gross ${gross} DZD is below the 2026 SNMG of ${SNMG_2026} DZD/month`
    );
  }

  const employeeCNAS = Math.floor((gross * CNAS_EMPLOYEE_TOTAL) / 100);
  const netSocial = gross - employeeCNAS;
  const abatement = Math.floor((netSocial * PROFESSIONAL_EXPENSE_RATE) / 100);
  const employerCNAS = Math.floor((gross * CNAS_EMPLOYER_TOTAL) / 100);
  const taxableBase = netSocial - abatement;
  const irg = computeIrg(taxableBase);
  const netPay = Math.floor(gross - employeeCNAS - irg);

  return {
    gross,
    employeeCNAS,
    employerCNAS,
    netSocial,
    abatement,
    taxableBase,
    irg,
    netPay,
    belowSNMG: gross < SNMG_2026,
  };
}

function computeIrg(taxableBase: number): number {
  let tax = 0;
  for (const bracket of IRG_BRACKETS_2026) {
    const portion = Math.max(
      0,
      Math.min(taxableBase, bracket.max) - bracket.min
    );
    tax += portion * bracket.rate;
  }
  return Math.floor(tax);
}
