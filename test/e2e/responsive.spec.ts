import { test, expect } from "@playwright/test";
import { fakeIp, signUpWithCompany } from "./helpers";

test("mobile layout: navigation menu and no horizontal overflow", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await signUpWithCompany(page, "Mobile Mechanical");
  for (const path of ["/app", "/app/customers", "/app/jobs", "/app/estimates", "/app/price-book", "/app/settings"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
  await page.goto("/app");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Customers" }).click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
});
