import { aiProposalSchema, type CatalogItem } from "./proposal";

export interface DraftLine {
  description: string;
  quantity: string;
  unit: string;
  priceBookItemId: string | null;
  unitPriceCents: number | null;
  taxClass: "taxable" | "non_taxable";
  source: "ai";
  needsReview: boolean;
  reviewReason: string | null;
}

export interface DraftResult {
  summary: string | null;
  lines: DraftLine[];
  warnings: string[];
}

export const MAX_AI_LINES = 40;

/** Pricing, discount, tax and warranty language the AI is not allowed to introduce. */
const RESTRICTED_LANGUAGE =
  /\$\s?\d|\d[\d,]*(\.\d+)?\s?(dollars?|usd|bucks)\b|\b\d+(\.\d+)?\s?%|\bper\s?cent\b|\bdiscount|\bcoupon|\brebate|\bwarrant|\bguarantee|\bfree of charge\b|\bno charge\b|\bat no cost\b|\bsales tax\b|\btax(es)?\b/i;

export function containsRestrictedLanguage(text: string): boolean {
  return RESTRICTED_LANGUAGE.test(text);
}

function clean(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeQuantity(q: unknown): { value: string; ok: boolean } {
  if (typeof q !== "number" || !Number.isFinite(q) || q <= 0 || q > 10000) return { value: "1", ok: false };
  const rounded = Math.round(q * 1000) / 1000;
  if (rounded <= 0) return { value: "1", ok: false };
  return { value: String(rounded), ok: rounded === q };
}

/**
 * Turns an untrusted model proposal into draft estimate lines.
 *
 * Guarantees (unit-tested):
 *  - every price comes from the organization's ACTIVE price book; never from the model
 *  - unmatched / unknown items get NO price and are flagged for review
 *  - low/medium-confidence matches are flagged for review
 *  - descriptions mentioning prices, discounts, taxes or warranties are flagged
 *  - a summary containing such language is dropped (with a warning)
 */
export function buildDraftFromProposal(raw: unknown, catalog: CatalogItem[]): DraftResult {
  const parsed = aiProposalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("AI response did not match the expected structure");
  }
  const proposal = parsed.data;
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const warnings: string[] = proposal.warnings.map((w) => clean(w, 300)).filter(Boolean).slice(0, 10);

  let summary: string | null = clean(proposal.summary ?? "", 2000) || null;
  if (summary && containsRestrictedLanguage(summary)) {
    summary = null;
    warnings.push("The AI summary was removed because it mentioned prices, discounts, taxes or warranties. Write the summary yourself.");
  }

  if (proposal.line_items.length > MAX_AI_LINES) {
    warnings.push(`Only the first ${MAX_AI_LINES} proposed lines were kept.`);
  }

  const lines: DraftLine[] = [];
  for (const item of proposal.line_items.slice(0, MAX_AI_LINES)) {
    const description = clean(item.description, 2000);
    if (!description) continue;
    const reasons: string[] = [];
    const qty = normalizeQuantity(item.quantity);
    if (!qty.ok) reasons.push("Check the quantity");

    const match = item.price_book_item_id ? byId.get(item.price_book_item_id) : undefined;
    let line: DraftLine;
    if (match) {
      line = {
        description,
        quantity: qty.value,
        unit: match.unit,
        priceBookItemId: match.id,
        unitPriceCents: match.unitPriceCents, // price book is the ONLY price source
        taxClass: match.taxClass,
        source: "ai",
        needsReview: false,
        reviewReason: null,
      };
      if (item.confidence !== "high") {
        reasons.push(`AI match confidence is ${item.confidence} — confirm "${match.name}" is the right item`);
      }
    } else {
      if (item.price_book_item_id) reasons.push("AI referenced an item that is not in your active price book");
      reasons.push("No approved price — choose a price book item or have an admin set the price");
      line = {
        description,
        quantity: qty.value,
        unit: "each",
        priceBookItemId: null,
        unitPriceCents: null,
        taxClass: "taxable",
        source: "ai",
        needsReview: true,
        reviewReason: null,
      };
    }
    if (containsRestrictedLanguage(description)) {
      reasons.push("Mentions prices, discounts, taxes or warranties — verify the wording");
    }
    if (item.reason && line.needsReview === false && reasons.length > 0) {
      reasons.push(clean(item.reason, 200));
    }
    if (reasons.length > 0) {
      line.needsReview = true;
      line.reviewReason = reasons.join(". ").slice(0, 500);
    }
    lines.push(line);
  }
  return { summary, lines, warnings };
}
