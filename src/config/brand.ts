/**
 * Neutral, rebrandable configuration. No company or product name has been chosen,
 * so the interface deliberately shows no brand: page titles describe the page, and
 * customer-facing pages show the contractor's own company name.
 *
 * When a name is chosen, set `productName` and it will be used in titles and the
 * public page header. Colors/typography live in src/app/globals.css (@theme).
 */
export const brand = {
  productName: null as string | null,
} as const;

export function pageTitle(page: string): string {
  return brand.productName ? `${page} · ${brand.productName}` : page;
}
