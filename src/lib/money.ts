/**
 * Money math. All amounts are integer cents; quantities are decimals with at most
 * 3 fractional digits, handled as scaled integers. No floating point is used for
 * any monetary result. Rounding is half away from zero, matching PostgreSQL's
 * round(numeric) used by the database triggers.
 */

export const MAX_UNIT_PRICE_CENTS = 100_000_000_000; // $1B, mirrors DB CHECK
const QTY_SCALE = 1000n;

/** "1,234.5" | "$12" | "0.99" → cents. Returns null when invalid. */
export function parseMoneyToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents <= MAX_UNIT_PRICE_CENTS ? cents : null;
}

/** Parse a positive quantity with up to 3 decimals into thousandths. */
export function parseQuantity(input: string | number): bigint | null {
  const s = String(input).trim();
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const milli = BigInt(whole) * QTY_SCALE + BigInt(frac.padEnd(3, "0"));
  return milli > 0n ? milli : null;
}

export function formatQuantity(milli: bigint): string {
  const whole = milli / QTY_SCALE;
  const frac = (milli % QTY_SCALE).toString().padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Integer division rounding half away from zero (inputs non-negative here). */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

export function lineTotalCents(quantity: string | number, unitPriceCents: number): number {
  const q = parseQuantity(quantity);
  if (q === null) throw new Error("invalid quantity");
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new Error("invalid unit price");
  const total = divRoundHalfUp(q * BigInt(unitPriceCents), QTY_SCALE);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("line total too large");
  return Number(total);
}

export interface TotalsLine {
  quantity: string | number;
  unitPriceCents: number | null;
  taxClass: "taxable" | "non_taxable";
}

export interface Totals {
  subtotalCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Lines lacking an approved price. Totals are incomplete while > 0. */
  unpricedLines: number;
}

export function computeTotals(lines: TotalsLine[], taxRateBps: number): Totals {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) throw new Error("invalid tax rate");
  let subtotal = 0;
  let taxable = 0;
  let unpriced = 0;
  for (const l of lines) {
    if (l.unitPriceCents === null) {
      unpriced++;
      continue;
    }
    const t = lineTotalCents(l.quantity, l.unitPriceCents);
    subtotal += t;
    if (l.taxClass === "taxable") taxable += t;
  }
  const tax = Number(divRoundHalfUp(BigInt(taxable) * BigInt(taxRateBps), 10000n));
  return { subtotalCents: subtotal, taxableSubtotalCents: taxable, taxCents: tax, totalCents: subtotal + tax, unpricedLines: unpriced };
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
