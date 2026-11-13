import { test, expect } from "@playwright/test";
import { fakeIp, signUpWithCompany } from "./helpers";

const CRON = "e2e-cron-secret-0123456789abcdef-0123456789";

test("email delivery, reminders, stop on decision, cron auth and dashboard", async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const page = await ctx.newPage();
  await signUpWithCompany(page, "Northline Mechanical");

  await page.goto("/app/price-book/new");
  await page.getByLabel("Service name").fill("Furnace tune-up");
  await page.getByLabel("Unit price ($)").fill("149");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.goto("/app/customers/new");
  await page.getByLabel("Customer name").fill("Jamie Client");
  await page.getByLabel("Email").fill("jamie@example.test");
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByRole("link", { name: "New job" }).click();
  await page.getByLabel("Job title").fill("Annual furnace service");
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByRole("button", { name: "Create estimate" }).click();
  await page.locator("#add-pb-item").selectOption({ label: "Furnace tune-up — $149.00/each" });
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("button", { name: "Approve estimate" }).click();
  await expect(page.getByText("Approved — not yet sent")).toBeVisible();

  // Send by email: delivery is attempted immediately.
  await expect(page.getByLabel("Email it to jamie@example.test")).toBeChecked();
  await page.getByRole("button", { name: "Send estimate" }).click();
  await expect(page.getByText("Sent — email queued for delivery")).toBeVisible();
  const link = (await page.getByTestId("customer-link").textContent())!;
  await page.getByRole("button", { name: "Done" }).click();
  const list = page.getByTestId("follow-up-list");
  await expect(list.getByText("Estimate email")).toBeVisible();
  await expect(list.locator("li").filter({ hasText: "Estimate email" }).getByText("Sent", { exact: true })).toBeVisible();
  await expect(list.locator("li").filter({ hasText: "Automatic reminder" })).toHaveCount(3);

  // Manual reminder, then throttled.
  await page.getByRole("button", { name: "Send reminder now" }).click();
  await expect(page.getByText("Reminder queued")).toBeVisible();
  await expect(list.locator("li").filter({ hasText: "Manual reminder" }).getByText("Sent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send reminder now" }).click();
  await expect(page.getByText("A reminder was already sent for this estimate in the last hour")).toBeVisible();

  // Cron endpoint requires the secret.
  expect((await page.request.get("/api/cron/process-jobs")).status()).toBe(401);
  expect((await page.request.get("/api/cron/process-jobs", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await page.request.get("/api/cron/process-jobs", { headers: { authorization: `Bearer ${CRON}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true });

  // Customer accepts → remaining reminders are cancelled.
  const customerCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const customer = await customerCtx.newPage();
  await customer.goto(link);
  await customer.getByRole("button", { name: "Accept estimate" }).click();
  await customer.getByLabel("Your full name").fill("Jamie Client");
  await customer.getByLabel(/I accept this estimate/).check();
  await customer.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(customer.getByText("You accepted this estimate")).toBeVisible();

  await page.reload();
  const reminders = page.getByTestId("follow-up-list").locator("li").filter({ hasText: "Automatic reminder" });
  await expect(reminders.filter({ hasText: "Not sent — customer accepted" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Send reminder now" })).toHaveCount(0);

  // Follow-ups page lists the cancelled reminders.
  await page.goto("/app/follow-ups?status=cancelled");
  await expect(page.getByText("customer accepted").first()).toBeVisible();

  // Dashboard reflects the database.
  await page.goto("/app");
  const metric = (label: string) => page.locator("a, div").filter({ has: page.getByText(label, { exact: true }) }).last();
  await expect(metric("Accepted").getByText("1", { exact: true })).toBeVisible();
  await expect(metric("Accepted estimate value").getByText("$149.00")).toBeVisible();
  await expect(metric("Total quoted").getByText("$149.00")).toBeVisible();
  await expect(metric("Pending customer decision").getByText("0", { exact: true })).toBeVisible();
  await expect(page.getByText("Not collected payments.")).toBeVisible();
  await page.getByLabel("Estimates created").selectOption("30d");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/period=30d/);
  await expect(metric("Accepted").getByText("1", { exact: true })).toBeVisible();

  await ctx.close();
  await customerCtx.close();
});
