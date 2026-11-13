import { test, expect } from "@playwright/test";
import { fakeIp, signUpWithCompany } from "./helpers";

test("draft → AI failure keeps notes → review → approve → send → customer accepts", async ({ browser }) => {
  const ownerCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const page = await ownerCtx.newPage();
  await signUpWithCompany(page, "Summit Comfort HVAC");

  // Company settings: tax rate + terms.
  await page.goto("/app/settings");
  await page.getByLabel("Sales tax rate (%)").fill("8.25");
  await page.getByLabel("Terms shown on estimates").fill("50% deposit due at scheduling. Balance due on completion.");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Company settings saved")).toBeVisible();

  // Price book.
  for (const [name, price, unit, tax] of [["Run capacitor replacement", "189.50", "each", "taxable"], ["Diagnostic labor", "125", "hour", "non_taxable"]]) {
    await page.goto("/app/price-book/new");
    await page.getByLabel("Service name").fill(name);
    await page.getByLabel("Unit price ($)").fill(price);
    await page.locator("#unit").fill(unit);
    await page.getByLabel("Tax").selectOption(tax);
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Price book saved.")).toBeVisible();
  }

  // Customer + job with observations.
  await page.goto("/app/customers/new");
  await page.getByLabel("Customer name").fill("Riley Homeowner");
  await page.getByLabel("Email").fill("riley@example.test");
  await page.getByRole("button", { name: "Add customer" }).click();
  await page.getByRole("link", { name: "New job" }).click();
  await page.getByLabel("Job title").fill("Upstairs AC not cooling");
  await page.getByLabel("Technician observations").fill("Run capacitor bulging, measured 12 µF on a 45 µF rating.");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText("Job created.")).toBeVisible();

  // Create estimate from the job.
  await page.getByRole("button", { name: "Create estimate" }).click();
  await expect(page).toHaveURL(/\/app\/estimates\//);
  const notes = page.getByLabel("Technician notes and required work");
  await expect(notes).toHaveValue(/Run capacitor bulging/);

  // AI is not configured in this environment: the failure is reported and notes are kept.
  await notes.fill("Run capacitor bulging; replace. 1.5 hours diagnostic. Contactor looks worn.");
  await page.getByRole("button", { name: "Draft line items with AI" }).click();
  await expect(page.getByText("AI drafting is not configured for this workspace").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Last AI attempt failed")).toBeVisible();
  await expect(page.getByLabel("Technician notes and required work")).toHaveValue("Run capacitor bulging; replace. 1.5 hours diagnostic. Contactor looks worn.");

  // Lines from the price book + one custom line without a price.
  await page.locator("#add-pb-item").selectOption({ label: "Run capacitor replacement — $189.50/each" });
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("listitem", { name: "Line 1" })).toBeVisible();
  await page.locator("#add-pb-item").selectOption({ label: "Diagnostic labor — $125.00/hour" });
  await page.locator("#add-pb-qty").fill("1.5");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("listitem", { name: "Line 2" })).toBeVisible();
  await page.locator("#add-manual-desc").fill("Contactor replacement");
  await page.getByRole("button", { name: "Add line" }).click();
  const line3 = page.getByRole("listitem", { name: "Line 3" });
  await expect(line3.getByText("Missing price")).toBeVisible();
  await expect(page.getByText("Resolve 1 flagged or unpriced line first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve estimate" })).toHaveCount(0);

  // Admin review: set price, mark reviewed.
  await line3.getByLabel("Unit price ($)").fill("45.00");
  await line3.getByLabel("I reviewed this line").check();
  await line3.getByRole("button", { name: "Save line" }).click();
  await expect(line3.getByText("Missing price")).toHaveCount(0);

  // Server-computed totals: 189.50 + 187.50 + 45.00 = 422.00; tax 8.25% of 234.50 = 19.35.
  await expect(page.getByTestId("subtotal")).toHaveText("$422.00");
  await expect(page.getByTestId("tax")).toHaveText("$19.35");
  await expect(page.getByTestId("total")).toHaveText("$441.35");

  await page.getByLabel("Scope of work (shown to the customer)").fill("Replace the failed run capacitor and worn contactor, then verify cooling.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();

  await page.getByRole("button", { name: "Approve estimate" }).click();
  await expect(page.getByText("Approved — not yet sent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save line" })).toHaveCount(0); // locked

  await page.getByLabel(/Email it to/).uncheck();
  await page.getByRole("button", { name: "Send estimate" }).click();
  const link = (await page.getByTestId("customer-link").textContent())!;
  expect(link).toMatch(/\/e\/[A-Za-z0-9_-]{43}$/);
  await page.reload();
  await expect(page.getByText("Sent — awaiting customer").first()).toBeVisible();

  // Customer (no account) opens the link and accepts.
  const customerCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const customer = await customerCtx.newPage();
  const resp = await customer.goto(link);
  expect(resp?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(customer.getByText("Summit Comfort HVAC")).toBeVisible();
  await expect(customer.getByTestId("customer-total")).toHaveText("$441.35");
  await expect(customer.getByText("50% deposit due at scheduling.")).toBeVisible();
  await customer.getByRole("button", { name: "Accept estimate" }).click();
  await customer.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(customer.getByText("Type your full name to accept")).toBeVisible();
  await customer.getByLabel("Your full name").fill("Riley Homeowner");
  await customer.getByLabel(/I accept this estimate/).check();
  await customer.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(customer.getByText("You accepted this estimate")).toBeVisible();
  await customer.reload();
  await expect(customer.getByText("You accepted this estimate")).toBeVisible();
  await expect(customer.getByRole("button", { name: "Accept estimate" })).toHaveCount(0);

  // Contractor sees the decision; accepted estimates cannot be revised.
  await page.reload();
  await expect(page.getByText("Accepted by the customer")).toBeVisible();
  await expect(page.getByText("Signed by")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revise" })).toHaveCount(0);

  // Invalid links fail generically.
  await customer.goto(link.slice(0, -2) + "zz");
  await expect(customer.getByText("This estimate link is not available")).toBeVisible();
  await customer.goto("/e/not-a-token");
  await expect(customer.getByText("This estimate link is not available")).toBeVisible();

  await ownerCtx.close();
  await customerCtx.close();
});
