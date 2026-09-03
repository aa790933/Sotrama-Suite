import { Fyo } from 'fyo';
import { Money } from 'pesa';

/**
 * Domain-owned POS transacted amount — recomposed via getAll, N+1 eliminated.
 */
export async function getPOSTransactedAmount(
  fyo: Fyo,
  fromDate: Date,
  toDate: Date,
  lastShiftClosingDate?: Date
): Promise<Record<string, Money> | undefined> {
  const filters: Record<string, unknown> = { isPOS: true, date: ['between', fromDate.toISOString(), toDate.toISOString()] as unknown as string };
  if (lastShiftClosingDate) (filters as Record<string, unknown>)._createdAfter = lastShiftClosingDate.toISOString();
  // Use getAll for SalesInvoice isPOS + date range; lastShift filter applied in JS for simplicity
  const invoices = (await fyo.db.getAll('SalesInvoice', {
    filters: { isPOS: true },
    fields: ['name', 'returnAgainst', 'date', 'created'],
  })) as { name: string; returnAgainst?: string; date: string; created: string }[];
  const filtered = invoices.filter((inv) => {
    const d = new Date(inv.date).toISOString();
    if (d < fromDate.toISOString() || d > toDate.toISOString()) return false;
    if (lastShiftClosingDate && new Date(inv.created) <= lastShiftClosingDate) return false;
    return true;
  });
  if (!filtered.length) return undefined;
  const sinvNames = filtered.map((r) => r.name);
  const signMap = new Map<string, number>(filtered.map((inv) => [inv.name, inv.returnAgainst ? -1 : 1]));
  const paymentFors = (await fyo.db.getAll('PaymentFor', {
    filters: { referenceName: ['in', sinvNames] },
    fields: ['parent', 'referenceName'],
  })) as { parent: string; referenceName: string }[];
  const paymentNames = [...new Set(paymentFors.map((p) => p.parent))];
  if (!paymentNames.length) return undefined;
  const payments = (await fyo.db.getAll('Payment', {
    filters: { name: ['in', paymentNames] },
    fields: ['name', 'paymentMethod', 'amount'],
  })) as { name: string; paymentMethod: string; amount: string | number }[];
  // First PaymentFor reference decides the payment sign.
  const paymentToSign = new Map<string, number>();
  for (const pf of paymentFors) {
    if (!paymentToSign.has(pf.parent)) paymentToSign.set(pf.parent, signMap.get(pf.referenceName) ?? 1);
  }
  const out: Record<string, Money> = {};
  for (const pay of payments) {
    const sign = paymentToSign.get(pay.name) ?? 1;
    const amt = fyo.pesa(pay.amount) as unknown as Money;
    const signed = sign === -1 ? (amt as unknown as { neg: () => Money }).neg?.() ?? amt : amt;
    const key = pay.paymentMethod;
    out[key] = out[key] ? (out[key] as unknown as { add: (m: Money) => Money }).add(signed) : signed;
  }
  return Object.keys(out).length ? out : undefined;
}
