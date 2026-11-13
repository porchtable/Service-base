import { describe, expect, it } from "vitest";
import { computeTotals, formatQuantity, lineTotalCents, parseMoneyToCents, parseQuantity } from "@/lib/money";

describe("parseMoneyToCents", () => {
  it.each([
    ["12", 1200], ["12.5", 1250], ["12.05", 1205], ["$1,234.99", 123499], ["0", 0], ["0.01", 1],
  ])("%s → %d", (input, cents) => expect(parseMoneyToCents(input)).toBe(cents));

  it.each(["", "abc", "-5", "1.234", "1e5", "12.", ".5", "1,00,0.00x"])("rejects %j", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });
});

describe("quantities", () => {
  it("parses up to 3 decimals and rejects zero/negative", () => {
    expect(parseQuantity("1.5")).toBe(1500n);
    expect(parseQuantity("0.125")).toBe(125n);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("1.2345")).toBeNull();
    expect(formatQuantity(1500n)).toBe("1.5");
    expect(formatQuantity(2000n)).toBe("2");
  });
});

describe("lineTotalCents", () => {
  it("multiplies exactly without floating point drift", () => {
    expect(lineTotalCents("3", 1999)).toBe(5997);
    expect(lineTotalCents("0.1", 333)).toBe(33); // 33.3 → 33
    expect(lineTotalCents("0.5", 333)).toBe(167); // 166.5 → 167 (half away from zero)
    expect(lineTotalCents("1.333", 10000)).toBe(13330);
    expect(lineTotalCents("2.5", 12345)).toBe(30863); // 30862.5 → 30863
    // Classic float trap: 0.1 * 3 * 100
    expect(lineTotalCents("3", 10)).toBe(30);
  });
});

describe("computeTotals", () => {
  it("applies tax only to taxable lines, in basis points", () => {
    const t = computeTotals(
      [
        { quantity: "1", unitPriceCents: 45000, taxClass: "taxable" }, // part
        { quantity: "2.5", unitPriceCents: 12500, taxClass: "non_taxable" }, // labor
      ],
      825,
    );
    expect(t.subtotalCents).toBe(45000 + 31250);
    expect(t.taxableSubtotalCents).toBe(45000);
    expect(t.taxCents).toBe(3713); // 3712.5 → 3713
    expect(t.totalCents).toBe(76250 + 3713);
    expect(t.unpricedLines).toBe(0);
  });

  it("reports unpriced lines and excludes them from totals", () => {
    const t = computeTotals([
      { quantity: "1", unitPriceCents: 1000, taxClass: "taxable" },
      { quantity: "1", unitPriceCents: null, taxClass: "taxable" },
    ], 0);
    expect(t.unpricedLines).toBe(1);
    expect(t.totalCents).toBe(1000);
  });

  it("rejects invalid tax rates", () => {
    expect(() => computeTotals([], -1)).toThrow();
    expect(() => computeTotals([], 10001)).toThrow();
  });
});
