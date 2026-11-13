import { test, expect } from "@playwright/test";
import { fakeIp, signUpWithCompany } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
});

test("customers persist after refresh and are searchable", async ({ page }) => {
  await signUpWithCompany(page, "Persist Co");
  await page.goto("/app/customers");
  await expect(page.getByText("No customers yet")).toBeVisible();
  await page.getByRole("link", { name: "Add customer" }).first().click();
  await page.getByLabel("Customer name").fill("Dana Whitfield");
  await page.getByLabel("Email").fill("dana@example.test");
  await page.getByLabel("Phone").fill("555-0142");
  await page.getByLabel("City").fill("Tulsa");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();
  const url = page.url();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Dana Whitfield" })).toBeVisible();
  await expect(page.getByText("dana@example.test")).toBeVisible();

  // Validation errors keep the user's input.
  await page.goto("/app/customers/new");
  await page.getByLabel("Customer name").fill("Bad Email Person");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByLabel("Customer name")).toHaveValue("Bad Email Person");

  await page.goto("/app/customers?q=whit");
  await expect(page.getByRole("link", { name: /Dana Whitfield/ })).toBeVisible();
  await page.goto("/app/customers?q=zzz-nothing");
  await expect(page.getByText("No customers match your search")).toBeVisible();

  // Edit, then archive with confirmation.
  await page.goto(url);
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Customer name").fill("Dana Whitfield-Ray");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Dana Whitfield-Ray" })).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await page.goto("/app/customers");
  await expect(page.getByText("No customers yet")).toBeVisible();
});

test("Company A cannot open Company B's customer", async ({ browser }) => {
  const ctxA = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const ctxB = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await signUpWithCompany(b, "Company B");
  await b.goto("/app/customers/new");
  await b.getByLabel("Customer name").fill("Secret Customer");
  await b.getByRole("button", { name: "Add customer" }).click();
  await expect(b.getByText("Customer added.")).toBeVisible();
  const bCustomerUrl = new URL(b.url()).pathname;

  await signUpWithCompany(a, "Company A");
  const res = await a.goto(bCustomerUrl);
  expect(res?.status()).toBe(404);
  await expect(a.getByText("Secret Customer")).toHaveCount(0);
  await a.goto("/app/customers?q=Secret");
  await expect(a.getByText("No customers match your search")).toBeVisible();
  await ctxA.close();
  await ctxB.close();
});
