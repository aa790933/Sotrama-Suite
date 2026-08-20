/**
 * Algeria (countryCode: "dz") legal / statutory compliance configuration.
 *
 * IMPORTANT: every value in this file is either (a) a documented, fixed legal
 * fact supplied by the user, or (b) explicitly marked as a PLACEHOLDER that
 * NEEDS VERIFICATION against the official Journal Officiel or a licensed
 * accountant before it is relied upon for filing.
 *
 * Nothing here is ever used to block a save — these are reference values for
 * the statutory reports and the non-blocking Employee pre-checks.
 */

/** SNMG — Salaire National Minimum Général (minimum wage floor), DZD/month. Fixed legal fact for 2026. */
export { SNMG_2026 } from './payroll';

// ---------------------------------------------------------------------------
// WEEKLY REST DAY + PUBLIC HOLIDAYS
// Used to default overtime on a rest day / public holiday to 150% (see
// salarySlipLogic.getEarningRowTotal). The 1.5x multiplier itself is already
// hard-wired; what is MISSING is the calendar used to DETECT that a given
// overtime day is legally a rest day / public holiday.
// ---------------------------------------------------------------------------

/**
 * Legal weekly rest day in Algeria is Friday. Fixed fact — can be used once a
 * calendar is present. (No calendar is modelled in this app yet.)
 */
export const WEEKLY_REST_DAY = 'Friday';

/**
 * Public holidays for the tax year. PLACEHOLDER — NEEDS VERIFICATION.
 * Do NOT invent dates. Replace with the official 2026 holiday calendar from
 * the Journal Officiel / MAPRST before enabling automatic detection.
 */
export const PUBLIC_HOLIDAYS_2026: string[] = [
  // e.g. '2026-01-01', ...
];

// ---------------------------------------------------------------------------
// SPECIAL LEAVES — duration in working days (Loi 90-11 relative aux relations
// de travail, article 54 modifiée et complétée; Loi 83-11 relative aux assurances
// sociales pour la maternité).
// ---------------------------------------------------------------------------
export const SPECIAL_LEAVE_DURATIONS_2026 = {
  /** Mariage du travailleur (Loi 90-11, art. 54) — 3 jours ouvrables rémunérés. */
  marriage: 3,
  /** Naissance d'un enfant du travailleur (Loi 90-11, art. 54) — 3 jours ouvrables rémunérés. */
  birth: 3,
  /** Mariage d'un descendant du travailleur (Loi 90-11, art. 54) — 3 jours ouvrables rémunérés. */
  marriageOfChild: 3,
  /** Décès ascendant/descendant/conjoint/frère/sœur (Loi 90-11, art. 54) — 3 jours ouvrables rémunérés. */
  bereavement: 3,
  /** Circoncision d'un enfant du travailleur (Loi 90-11, art. 54) — 3 jours ouvrables rémunérés. */
  circumcision: 3,
  /** Congé de maternité (Loi 83-11, art. 28) — 14 semaines consécutives (98 jours) indemnisées par la CNAS. */
  maternityDays: 98,
} as const;

// ---------------------------------------------------------------------------
// SEVERANCE / END-OF-SERVICE INDEMNITY (indemnité de fin de service).
// PLACEHOLDER — NEEDS VERIFICATION. CDD and CDI are governed by different
// articles of the Code du travail algérien; the formula and the 1/5th seniority
// share rules must be confirmed with a licensed accountant / the JO.
// Not implemented in any calculation yet.
// ---------------------------------------------------------------------------
export const SEVERANCE_RULES_2026 = {
  /** PLACEHOLDER — end-of-service indemnity rate (fraction of monthly pay per year). */
  endOfServiceIndemnityRate: null as number | null,
  /** PLACEHOLDER — seniority share fraction (commonly 1/5, but unverified). */
  seniorityShare: null as number | null,
} as const;

// ---------------------------------------------------------------------------
// IRG SMOOTHING — transition zone just above the 30,000 DZD exemption.
// PLACEHOLDER — NEEDS VERIFICATION. The simple marginal-bracket engine in
// payroll.ts produces a discontinuity in net pay for salaries just above the
// zero-rate band; the exact smoothing formula from the official guidance is
// not yet available (see TODO(irg-smoothing) in payroll.ts). Set to `false`
// until the verified formula is supplied.
// ---------------------------------------------------------------------------
export const IRG_SMOOTHING_ENABLED = false;

// ---------------------------------------------------------------------------
// DTS (Déclaration Trimestrielle des Salaires) filing deadline.
// CNAS regulation: au plus tard dans les 30 jours suivant la fin du trimestre.
// ---------------------------------------------------------------------------
export const DTS_FILING_DEADLINE = {
  /** Exigée au plus tard dans les 30 jours suivant l'échéance du trimestre civil (CNAS). */
  rule: 'Within 30 days following the end of each calendar quarter (30 April, 31 July, 31 October, 31 January)',
  daysAfterQuarter: 30,
} as const;

