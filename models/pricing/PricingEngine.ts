import type { Money } from 'pesa';

/**
 * PricingEngine: pure invoice/transfer totals. Row math applies percent to the
 * line amount, or to the taxed total when discounting after tax; callers own
 * document reads. All functions are side-effect free.
 */

export interface DiscountLine {
  setItemDiscountAmount?: boolean;
  itemDiscountAmount?: Money;
  quantity?: number;
  amount?: Money;
  itemTaxedTotal?: Money;
  itemDiscountPercent?: number;
}

export interface DiscountContext {
  enabled: boolean;
  discountAfterTax: boolean;
  isReturn: boolean;
}

function signedPercent(percent: number | undefined, negate: boolean): number {
  const p = percent ?? 0;
  return negate ? -Math.abs(p) : p;
}

function lineBase(
  line: DiscountLine,
  discountAfterTax: boolean,
  zero: Money
): Money {
  return discountAfterTax
    ? (line.itemTaxedTotal ?? zero)
    : (line.amount ?? zero);
}

/**
 * Row discount for totals: percent applies to the line amount, or to the
 * taxed total when discounting after tax. Set-amount rows scale by quantity.
 */
export function lineDiscount(
  line: DiscountLine,
  ctx: DiscountContext,
  zero: Money
): Money {
  if (!ctx.enabled) return zero;
  if (line.setItemDiscountAmount) {
    return (line.itemDiscountAmount ?? zero).mul(line.quantity as number);
  }
  const base = lineBase(line, ctx.discountAfterTax, zero);
  const pct = signedPercent(
    line.itemDiscountPercent,
    ctx.isReturn && ctx.discountAfterTax
  );
  return base.mul(pct / 100);
}

/**
 * Row discount for the tax path. Same ordering, but the caller passes
 * pre-signed amounts, so returns negate the percent whenever they apply.
 */
export function lineDiscountForTax(
  line: DiscountLine,
  ctx: DiscountContext,
  zero: Money
): Money {
  if (!ctx.enabled) return zero;
  if (line.setItemDiscountAmount) {
    return (line.itemDiscountAmount ?? zero).mul(line.quantity as number);
  }
  const base = lineBase(line, ctx.discountAfterTax, zero);
  return base.mul(signedPercent(line.itemDiscountPercent, ctx.isReturn) / 100);
}

export function totalItemDiscount(
  lines: DiscountLine[] | undefined,
  ctx: DiscountContext,
  zero: Money
): Money {
  if (!ctx.enabled) return zero;
  if (!lines?.length) return zero;
  let total = zero;
  for (const line of lines) {
    total = total.add(lineDiscount(line, ctx, zero));
  }
  return ctx.isReturn ? total.neg() : total;
}

export function singleItemDiscount(
  line: DiscountLine,
  hasLines: boolean,
  ctx: DiscountContext,
  zero: Money
): Money {
  if (!ctx.enabled) return zero;
  if (!hasLines) return zero;
  const discount = lineDiscountForTax(line, ctx, zero);
  return ctx.isReturn ? discount.neg() : discount;
}

export interface InvoiceDiscountInput {
  enabled: boolean;
  setDiscountAmount?: boolean;
  discountAmount?: Money;
  lines: { itemTaxedTotal?: Money; itemDiscountedTotal?: Money }[];
  discountAfterTax: boolean;
  discountPercent?: number;
}

export function invoiceDiscountAmount(
  input: InvoiceDiscountInput,
  zero: Money
): Money {
  if (!input.enabled) return zero;
  if (input.setDiscountAmount) {
    return input.discountAmount ?? zero;
  }
  let base = zero;
  for (const line of input.lines ?? []) {
    base = base.add(
      input.discountAfterTax ? line.itemTaxedTotal! : line.itemDiscountedTotal!
    );
  }
  return base.percent(input.discountPercent ?? 0);
}

export function totalDiscount(
  itemDiscount: Money,
  invoiceDiscount: Money,
  isReturn: boolean
): Money {
  const total = itemDiscount.add(invoiceDiscount);
  if (isReturn && total.isPositive()) {
    return total.neg();
  }
  return total;
}

export interface LineTaxInput {
  amount: Money;
  discount: Money;
  isReturn: boolean;
  discountAfterTax: boolean;
  rate: number;
}

export function lineTax(input: LineTaxInput): {
  fullAmount: Money;
  taxAmount: Money;
} {
  let fullAmount = input.amount;
  if (!input.discountAfterTax) {
    fullAmount = input.isReturn
      ? input.amount.add(input.discount)
      : input.amount.sub(input.discount);
  }
  return { fullAmount, taxAmount: fullAmount.mul(input.rate / 100) };
}

export function summarizeTaxes(
  items: { account: string; rate: number; amount: Money }[],
  newZero: () => Money
): ({ account: string; rate: number; amount: Money } & { idx: number })[] {
  const taxes: Record<string, { account: string; rate: number; amount: Money }> =
    {};
  for (const { account, rate, amount } of items) {
    taxes[account] ??= { account, rate, amount: newZero() };
    taxes[account].amount = taxes[account].amount.add(amount);
  }
  const out: ({ account: string; rate: number; amount: Money } & {
    idx: number;
  })[] = [];
  let idx = 0;
  for (const account in taxes) {
    const tax = taxes[account];
    if (tax.amount.isZero()) {
      continue;
    }
    out.push({ ...tax, idx });
    idx += 1;
  }
  return out;
}

export function sumWithTaxes(
  netTotal: Money,
  taxes: Money[],
  isReturn: boolean
): Money {
  return taxes.reduce(
    (a, b) => {
      if (isReturn) {
        return a.abs().add(b.abs()).neg();
      }
      return a.add(b.abs());
    },
    netTotal.abs()
  );
}
