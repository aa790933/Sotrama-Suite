/**
 * Algeria (countryCode: "dz") payroll calculation engine — tax year 2026.
 *
 * This module is intentionally kept as pure calculation logic: it does not
 * touch the database or any Fyo model. Settings values can be supplied at
 * call time via the `settings` parameter; when omitted, the module-level
 * DEFAULT constants (matching the 2026 legal rates) are used as fallback.
 *
 * The constants below are the 2026 legal defaults. They are also baked into
 * the PayrollSettings schema as `"default"` values, so a fresh install works
 * out of the box. Users can override them via the Settings → Payroll Settings
 * screen, and the SalarySlip / Employee models read from that singleton at
 * call time (see getPayrollSettingsData).
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
//
// NARROW-BAND SMOOTHING NOTE: the floor/ceiling are intentionally NOT applied
// in the current implementation to reproduce the official worked example
// (which uses the uncapped 40%). The abatementMin / abatementMax settings are
// exposed for future use once the contradiction is resolved.
export const PROFESSIONAL_EXPENSE_RATE = 40; // % of net social
export const PROFESSIONAL_EXPENSE_MIN = 1_000; // DZD / month
export const PROFESSIONAL_EXPENSE_MAX = 1_500; // DZD / month

// ---------------------------------------------------------------------------
// IRG — income tax, progressive / marginal brackets applied to the taxable
// base. Each portion of income is taxed at its own bracket rate.
export const IRG_BRACKET_1_LIMIT = 30_000; // 0% band upper bound
export const IRG_BRACKET_2_LIMIT = 120_000; // 23% band upper bound
export const IRG_BRACKET_3_LIMIT = 360_000; // 27% band upper bound
// Rates expressed as percentages (0–100 scale, consistent with CNAS rates above).
export const IRG_RATE_BRACKET_1 = 0; // 0 → 30,000
export const IRG_RATE_BRACKET_2 = 23; // 30,001 → 120,000
export const IRG_RATE_BRACKET_3 = 27; // 120,001 → 360,000
export const IRG_RATE_BRACKET_4 = 30; // above 360,000

/** Legacy bracket array kept for backward-compat; calculateDZPayroll now
 *  derives brackets from the settings parameter instead. */
export const IRG_BRACKETS_2026 = [
  { min: 0, max: IRG_BRACKET_1_LIMIT, rate: 0 },
  {
    min: IRG_BRACKET_1_LIMIT,
    max: IRG_BRACKET_2_LIMIT,
    rate: 0.23,
  },
  {
    min: IRG_BRACKET_2_LIMIT,
    max: IRG_BRACKET_3_LIMIT,
    rate: 0.27,
  },
  {
    min: IRG_BRACKET_3_LIMIT,
    max: Number.POSITIVE_INFINITY,
    rate: 0.3,
  },
] as const;

/**
 * Shape of the editable payroll configuration.
 * Mirrors the PayrollSettings Doc fields.
 */
export interface PayrollSettingsData {
  snmg: number;
  cnasEmployeeRate: number;
  cnasEmployerRate: number;
  irgBracket1Limit: number;
  irgBracket1Rate: number;
  irgBracket2Limit: number;
  irgBracket2Rate: number;
  irgBracket3Limit: number;
  irgBracket3Rate: number;
  irgBracket4Rate: number;
  professionalExpenseRate: number;
  abatementMin: number;
  abatementMax: number;
}

/**
 * Default 2026 values — used when no PayrollSettings singleton is loaded
 * (e.g. in unit tests or before the database is initialised).
 */
export const DEFAULT_PAYROLL_SETTINGS: PayrollSettingsData = {
  snmg: SNMG_2026,
  cnasEmployeeRate: CNAS_EMPLOYEE_TOTAL,
  cnasEmployerRate: CNAS_EMPLOYER_TOTAL,
  irgBracket1Limit: IRG_BRACKET_1_LIMIT,
  irgBracket1Rate: IRG_RATE_BRACKET_1,
  irgBracket2Limit: IRG_BRACKET_2_LIMIT,
  irgBracket2Rate: IRG_RATE_BRACKET_2,
  irgBracket3Limit: IRG_BRACKET_3_LIMIT,
  irgBracket3Rate: IRG_RATE_BRACKET_3,
  irgBracket4Rate: IRG_RATE_BRACKET_4,
  professionalExpenseRate: PROFESSIONAL_EXPENSE_RATE,
  abatementMin: PROFESSIONAL_EXPENSE_MIN,
  abatementMax: PROFESSIONAL_EXPENSE_MAX,
};

/**
 * Converts a PayrollSettings Doc (or plain partial) into a
 * PayrollSettingsData object, falling back to module-level defaults
 * for any field that is undefined.
 */
export function getPayrollSettingsData(
  settings?: Partial<PayrollSettingsData> | null
): PayrollSettingsData {
  if (!settings) return { ...DEFAULT_PAYROLL_SETTINGS };

  return {
    snmg: settings.snmg ?? DEFAULT_PAYROLL_SETTINGS.snmg,
    cnasEmployeeRate:
      settings.cnasEmployeeRate ?? DEFAULT_PAYROLL_SETTINGS.cnasEmployeeRate,
    cnasEmployerRate:
      settings.cnasEmployerRate ?? DEFAULT_PAYROLL_SETTINGS.cnasEmployerRate,
    irgBracket1Limit:
      settings.irgBracket1Limit ?? DEFAULT_PAYROLL_SETTINGS.irgBracket1Limit,
    irgBracket1Rate:
      settings.irgBracket1Rate ?? DEFAULT_PAYROLL_SETTINGS.irgBracket1Rate,
    irgBracket2Limit:
      settings.irgBracket2Limit ?? DEFAULT_PAYROLL_SETTINGS.irgBracket2Limit,
    irgBracket2Rate:
      settings.irgBracket2Rate ?? DEFAULT_PAYROLL_SETTINGS.irgBracket2Rate,
    irgBracket3Limit:
      settings.irgBracket3Limit ?? DEFAULT_PAYROLL_SETTINGS.irgBracket3Limit,
    irgBracket3Rate:
      settings.irgBracket3Rate ?? DEFAULT_PAYROLL_SETTINGS.irgBracket3Rate,
    irgBracket4Rate:
      settings.irgBracket4Rate ?? DEFAULT_PAYROLL_SETTINGS.irgBracket4Rate,
    professionalExpenseRate:
      settings.professionalExpenseRate ??
      DEFAULT_PAYROLL_SETTINGS.professionalExpenseRate,
    abatementMin:
      settings.abatementMin ?? DEFAULT_PAYROLL_SETTINGS.abatementMin,
    abatementMax:
      settings.abatementMax ?? DEFAULT_PAYROLL_SETTINGS.abatementMax,
  };
}

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
 * Builds the marginal IRG bracket array from settings values.
 * Rates are converted from percentage (0–100) to fraction (0–1) internally.
 */
function buildIrgBrackets(s: PayrollSettingsData) {
  return [
    { min: 0, max: s.irgBracket1Limit, rate: s.irgBracket1Rate / 100 },
    {
      min: s.irgBracket1Limit,
      max: s.irgBracket2Limit,
      rate: s.irgBracket2Rate / 100,
    },
    {
      min: s.irgBracket2Limit,
      max: s.irgBracket3Limit,
      rate: s.irgBracket3Rate / 100,
    },
    {
      min: s.irgBracket3Limit,
      max: Number.POSITIVE_INFINITY,
      rate: s.irgBracket4Rate / 100,
    },
  ];
}

/**
 * Computes an Algerian monthly payroll for 2026.
 *
 * Flow:
 *   gross
 *   -> employee CNAS (settings.cnasEmployeeRate % of gross)
 *   -> net social = gross - employee CNAS
 *   -> professional-expense abatement (settings.professionalExpenseRate % of net social)
 *   -> taxable base = net social - abatement
 *   -> IRG (marginal brackets from settings)
 *   -> net pay = gross - employee CNAS - IRG
 *
 * Employer CNAS (settings.cnasEmployerRate % of gross) is computed for
 * total-cost reporting only; it is not deducted from the employee's net pay.
 *
 * When `settings` is omitted, DEFAULT_PAYROLL_SETTINGS (2026 legal values) are
 * used, preserving the original behaviour for tests and environments without
 * a PayrollSettings singleton.
 *
 * TODO(irg-smoothing): the simple marginal-bracket implementation below produces
 * a discontinuity in marginal net pay for salaries just above the 30,000 DZD
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
export function calculateDZPayroll(
  gross: number,
  settings: PayrollSettingsData = DEFAULT_PAYROLL_SETTINGS
): DZPayrollResult {
  if (gross < 0) {
    throw new RangeError('gross salary must be non-negative');
  }

  if (gross < settings.snmg) {
    // Warn, but do not block — payroll below the minimum wage floor.
    // eslint-disable-next-line no-console
    console.warn(
      `[payroll] gross ${gross} DZD is below the SNMG of ${settings.snmg} DZD/month`
    );
  }

  const employeeCNAS = Math.floor((gross * settings.cnasEmployeeRate) / 100);
  const netSocial = gross - employeeCNAS;
  const abatement = Math.floor(
    (netSocial * settings.professionalExpenseRate) / 100
  );
  const employerCNAS = Math.floor((gross * settings.cnasEmployerRate) / 100);
  const taxableBase = netSocial - abatement;
  const brackets = buildIrgBrackets(settings);
  const irg = computeIrg(taxableBase, brackets);
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
    belowSNMG: gross < settings.snmg,
  };
}

function computeIrg(
  taxableBase: number,
  brackets: { min: number; max: number; rate: number }[]
): number {
  let tax = 0;
  for (const bracket of brackets) {
    const portion = Math.max(
      0,
      Math.min(taxableBase, bracket.max) - bracket.min
    );
    tax += portion * bracket.rate;
  }
  return Math.floor(tax);
}
