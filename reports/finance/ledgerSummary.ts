import { Fyo } from 'fyo';
import { toTimeValue } from 'utils';
import type { QueryFilter } from 'utils/db/types';

/** Parsed AccountingLedgerEntry row: amounts as numbers, date as stored. */
export interface LedgerEntry {
  account: string;
  debit: number;
  credit: number;
  date: string | Date;
}

export interface LedgerEntryFilter {
  accounts?: string[];
  fromDate?: string;
  toDate?: string;
}

/**
 * AccountingLedgerSummary: single aggregation seam over AccountingLedgerEntry.
 * Reverted entries never count; date bounds apply inclusively in JS (the DB
 * layer has no `between` operator); amounts parse once; months key uniformly.
 */
export async function getLedgerEntries(
  fyo: Fyo,
  filter: LedgerEntryFilter = {}
): Promise<LedgerEntry[]> {
  const filters: QueryFilter = { reverted: false };
  if (filter.accounts?.length) {
    filters.account = ['in', filter.accounts];
  }
  const rows = (await fyo.db.getAllRaw('AccountingLedgerEntry', {
    fields: ['account', 'debit', 'credit', 'date'],
    filters,
  })) as { account: string; debit: unknown; credit: unknown; date: string }[];

  const from = filter.fromDate ? Date.parse(filter.fromDate) : null;
  const to = filter.toDate ? Date.parse(filter.toDate) : null;

  const out: LedgerEntry[] = [];
  for (const row of rows) {
    if (from !== null || to !== null) {
      const time = toTimeValue(row.date);
      if (from !== null && time < from) continue;
      if (to !== null && time > to) continue;
    }
    out.push({
      account: row.account,
      debit: parseAmount(row.debit),
      credit: parseAmount(row.credit),
      date: row.date,
    });
  }
  return out;
}

/** Totals over submitted, uncancelled invoice docs in a date range. */
export async function getDocTotals(
  fyo: Fyo,
  schemaName: string,
  fromDate: string,
  toDate: string
): Promise<{ total: number; outstanding: number }> {
  const docs = (await fyo.db.getAll(schemaName, {
    filters: { submitted: true, cancelled: false },
    fields: ['baseGrandTotal', 'outstandingAmount', 'date'],
  })) as {
    baseGrandTotal: unknown;
    outstandingAmount: unknown;
    date: string;
  }[];
  const from = Date.parse(fromDate);
  const to = Date.parse(toDate);
  let total = 0;
  let outstanding = 0;
  for (const doc of docs) {
    const time = toTimeValue(doc.date);
    if (time < from || time > to) continue;
    total += parseAmount(doc.baseGrandTotal);
    outstanding += parseAmount(doc.outstandingAmount);
  }
  return { total, outstanding };
}

export function parseAmount(value: unknown): number {
  return Number(value ?? 0);
}

/** YYYY-MM calendar key for an ISO string or Date. */
export function monthKey(date: string | Date): string {
  if (date instanceof Date) {
    return date.toISOString().slice(0, 7);
  }
  const parsed = Date.parse(String(date).replace(' ', 'T'));
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 7);
  }
  return String(date).slice(0, 7);
}
