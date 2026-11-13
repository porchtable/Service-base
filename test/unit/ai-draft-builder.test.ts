import { describe, expect, it } from "vitest";
import { buildDraftFromProposal, containsRestrictedLanguage } from "@/server/ai/draft-builder";
import type { CatalogItem } from "@/server/ai/proposal";

const catalog: CatalogItem[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Run capacitor replacement", description: null, category: "Electrical", unit: "each", unitPriceCents: 18950, taxClass: "taxable" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Diagnostic labor", description: null, category: "Labor", unit: "hour", unitPriceCents: 12500, taxClass: "non_taxable" },
];

describe("AI draft builder — pricing comes only from the price book", () => {
  it("attaches price, unit and tax class from the matched catalog item, ignoring any model-supplied price", () => {
    const draft = buildDraftFromProposal({
      summary: "The technician observed a failed run capacitor.",
      line_items: [
        { description: "Replace run capacitor", quantity: 1, price_book_item_id: catalog[0].id, confidence: "high", reason: null,
          // Injected fields the schema does not allow — must be ignored:
          unit_price_cents: 1, price: 999999, discount: 50 },
        { description: "Diagnostic labor", quantity: 1.5, price_book_item_id: catalog[1].id, confidence: "high", reason: null },
      ],
      warnings: [],
    }, catalog);
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[0]).toMatchObject({ unitPriceCents: 18950, unit: "each", taxClass: "taxable", needsReview: false, priceBookItemId: catalog[0].id });
    expect(draft.lines[1]).toMatchObject({ unitPriceCents: 12500, unit: "hour", taxClass: "non_taxable", quantity: "1.5", needsReview: false });
    expect(JSON.stringify(draft)).not.toContain("999999");
    expect(draft.summary).toBe("The technician observed a failed run capacitor.");
  });

  it("never prices unmatched or invented items and flags them", () => {
    const draft = buildDraftFromProposal({
      summary: "Scope",
      line_items: [
        { description: "Replace evaporator coil", quantity: 1, price_book_item_id: null, confidence: "medium", reason: "No coil in catalog" },
        { description: "Refrigerant recharge", quantity: 2, price_book_item_id: "33333333-3333-4333-8333-333333333333", confidence: "high", reason: null },
      ],
      warnings: [],
    }, catalog);
    for (const l of draft.lines) {
      expect(l.unitPriceCents).toBeNull();
      expect(l.priceBookItemId).toBeNull();
      expect(l.needsReview).toBe(true);
      expect(l.reviewReason).toMatch(/No approved price/);
    }
    expect(draft.lines[1].reviewReason).toMatch(/not in your active price book/);
  });

  it("does not match inactive items (catalog passed in contains only active items)", () => {
    const draft = buildDraftFromProposal({
      summary: "", line_items: [{ description: "x", quantity: 1, price_book_item_id: "inactive-id", confidence: "high", reason: null }], warnings: [],
    }, catalog);
    expect(draft.lines[0].unitPriceCents).toBeNull();
  });

  it("flags low/medium-confidence matches but still prices them from the book", () => {
    const draft = buildDraftFromProposal({
      summary: "", line_items: [{ description: "Capacitor", quantity: 1, price_book_item_id: catalog[0].id, confidence: "low", reason: "Might be dual-run" }], warnings: [],
    }, catalog);
    expect(draft.lines[0].unitPriceCents).toBe(18950);
    expect(draft.lines[0].needsReview).toBe(true);
    expect(draft.lines[0].reviewReason).toMatch(/confidence is low/);
  });

  it("flags pricing, discount and warranty language and drops such summaries", () => {
    const draft = buildDraftFromProposal({
      summary: "We'll replace the coil for $1,500 with a 10-year warranty.",
      line_items: [
        { description: "Replace capacitor — 10% discount today", quantity: 1, price_book_item_id: catalog[0].id, confidence: "high", reason: null },
        { description: "Includes lifetime guarantee", quantity: 1, price_book_item_id: catalog[0].id, confidence: "high", reason: null },
      ],
      warnings: [],
    }, catalog);
    expect(draft.summary).toBeNull();
    expect(draft.warnings.join(" ")).toMatch(/summary was removed/);
    expect(draft.lines.every((l) => l.needsReview)).toBe(true);
    expect(draft.lines.every((l) => l.unitPriceCents === 18950)).toBe(true);
  });

  it("normalizes bad quantities and flags them", () => {
    const draft = buildDraftFromProposal({
      summary: "", line_items: [
        { description: "a", quantity: -3, price_book_item_id: catalog[0].id, confidence: "high", reason: null },
        { description: "b", quantity: 1.23456, price_book_item_id: catalog[0].id, confidence: "high", reason: null },
        { description: "c", quantity: 1e9, price_book_item_id: catalog[0].id, confidence: "high", reason: null },
      ], warnings: [],
    }, catalog);
    expect(draft.lines.map((l) => l.quantity)).toEqual(["1", "1.235", "1"]);
    expect(draft.lines.every((l) => l.needsReview)).toBe(true);
  });

  it("rejects malformed responses and caps line count", () => {
    expect(() => buildDraftFromProposal({ nope: true }, catalog)).toThrow();
    const many = Array.from({ length: 60 }, (_, i) => ({ description: `l${i}`, quantity: 1, price_book_item_id: catalog[0].id, confidence: "high", reason: null }));
    const draft = buildDraftFromProposal({ summary: "", line_items: many, warnings: [] }, catalog);
    expect(draft.lines).toHaveLength(40);
  });

  it("detects restricted language", () => {
    expect(containsRestrictedLanguage("Costs $200")).toBe(true);
    expect(containsRestrictedLanguage("about 200 dollars")).toBe(true);
    expect(containsRestrictedLanguage("Replace 2 filters")).toBe(false);
    expect(containsRestrictedLanguage("Replace the 16x25x1 filter")).toBe(false);
  });
});
