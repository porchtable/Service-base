/**
 * The frozen, customer-facing content of a sent estimate version. Built once at
 * send time and stored in estimate_versions.snapshot; the customer page renders
 * exclusively from it, so later edits to the company, customer or price book
 * never change what was sent.
 */
export interface EstimateSnapshot {
  schema: 1;
  organization: {
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    timezone: string;
  };
  customer: { name: string; companyName: string | null; email: string | null; address: string | null };
  job: { number: number; title: string; serviceAddress: string | null };
  estimate: {
    number: number;
    version: number;
    title: string;
    summary: string | null;
    issuedAt: string;
    expiresAt: string;
  };
  lines: Array<{
    description: string;
    quantity: string;
    unit: string;
    unit_price_cents: number;
    line_total_cents: number;
    tax_class: "taxable" | "non_taxable";
  }>;
  totals: {
    subtotal_cents: number;
    taxable_subtotal_cents: number;
    tax_rate_bps: number;
    tax_cents: number;
    total_cents: number;
  };
  terms: string | null;
}

export function joinAddress(parts: Array<string | null | undefined>): string | null {
  const s = parts.filter((p) => p && p.trim()).join(", ");
  return s || null;
}
