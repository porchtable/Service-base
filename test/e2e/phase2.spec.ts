import { test, expect, type Browser } from "@playwright/test";
import { fakeIp, registerAndVerify, signUpWithCompany } from "./helpers";

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  return { ctx, page: await ctx.newPage() };
}

test("price book, technician assignment, observations and private photos", async ({ browser }) => {
  const owner = await newPage(browser);
  const tech = await newPage(browser);
  const outsider = await newPage(browser);

  // Owner sets up price book.
  await signUpWithCompany(owner.page, "Polar Air Services");
  await owner.page.goto("/app/price-book/new");
  await owner.page.getByLabel("Service name").fill("Run capacitor replacement");
  await owner.page.getByLabel("Category").fill("Electrical");
  await owner.page.getByLabel("Unit price ($)").fill("189.5");
  await owner.page.getByRole("button", { name: "Add item" }).click();
  await expect(owner.page.getByText("Price book saved.")).toBeVisible();
  await expect(owner.page.getByRole("cell", { name: /\$189\.50/ })).toBeVisible();
  // Invalid price is rejected with a field error and input kept.
  await owner.page.goto("/app/price-book/new");
  await owner.page.getByLabel("Service name").fill("Bad price");
  await owner.page.getByLabel("Unit price ($)").fill("12.345");
  await owner.page.getByRole("button", { name: "Add item" }).click();
  await expect(owner.page.getByText("Enter unit price like 129.00")).toBeVisible();

  // Owner adds a customer and invites a technician.
  await owner.page.goto("/app/customers/new");
  await owner.page.getByLabel("Customer name").fill("Harper Residence");
  await owner.page.getByLabel("Street address").fill("12 Elm St");
  await owner.page.getByRole("button", { name: "Add customer" }).click();
  await expect(owner.page.getByText("Customer added.")).toBeVisible();

  const techCreds = await registerAndVerify(tech.page, { name: "Sam Tech" });
  await owner.page.goto("/app/settings/team");
  await owner.page.getByLabel("Email").fill(techCreds.email);
  await owner.page.getByRole("button", { name: "Send invite" }).click();
  const link = await owner.page.locator("p.font-mono").textContent();
  expect(link).toContain("/invite/");
  await tech.page.goto(link!);
  await tech.page.getByRole("button", { name: "Join company" }).click();
  await expect(tech.page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Owner creates a job assigned to the technician (service address prefilled from customer).
  await owner.page.goto("/app/customers");
  await owner.page.getByRole("link", { name: /Harper Residence/ }).click();
  await owner.page.getByRole("link", { name: "New job" }).click();
  await expect(owner.page.getByLabel("Street address")).toHaveValue("12 Elm St");
  await owner.page.getByLabel("Job title").fill("AC not cooling");
  await owner.page.getByLabel("Assigned technician").selectOption({ label: "Sam Tech (technician)" });
  await owner.page.getByLabel(/Appointment/).fill("2026-12-01T09:30");
  await owner.page.getByLabel("Equipment type").fill("Split AC");
  await owner.page.getByLabel("Internal notes").fill("Gate code 4455");
  await owner.page.getByRole("button", { name: "Create job" }).click();
  await expect(owner.page.getByText("Job created.")).toBeVisible();
  const jobUrl = new URL(owner.page.url()).pathname;

  // Technician: sees it under "Assigned to me", edits observations, uploads a photo.
  await tech.page.goto("/app/jobs?technician=me");
  await tech.page.getByRole("link", { name: /AC not cooling/ }).click();
  await expect(tech.page.getByText("Gate code 4455")).toHaveCount(0); // internal notes hidden from technicians
  await tech.page.getByRole("link", { name: "Edit job" }).click();
  await tech.page.getByLabel("Technician observations").fill("Run capacitor bulging; contactor pitted.");
  await tech.page.getByRole("button", { name: "Save job" }).click();
  await expect(tech.page.getByText("Job updated.")).toBeVisible();
  await expect(tech.page.getByText("Run capacitor bulging; contactor pitted.")).toBeVisible();
  await tech.page.reload();
  await expect(tech.page.getByText("Run capacitor bulging; contactor pitted.")).toBeVisible();

  await tech.page.getByLabel("Photos").setInputFiles({ name: "capacitor.png", mimeType: "image/png", buffer: PNG });
  await tech.page.getByLabel("Caption (optional)").fill("Capacitor");
  await tech.page.getByRole("button", { name: "Upload photos" }).click();
  await expect(tech.page.getByText("Photos (1)")).toBeVisible();
  const img = tech.page.getByRole("img", { name: "Capacitor" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);

  // A non-image disguised as PNG is rejected by content sniffing.
  await tech.page.getByLabel("Photos").setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
  await tech.page.getByRole("button", { name: "Upload photos" }).click();
  await expect(tech.page.getByText("Only JPEG, PNG, WebP or HEIC photos are supported")).toBeVisible();

  // Technicians cannot manage the price book or delete jobs.
  await tech.page.goto("/app/price-book/new");
  await expect(tech.page).toHaveURL(/\/app\/price-book$/);
  await tech.page.goto(jobUrl);
  await expect(tech.page.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // Attachment link is not usable by another company or anonymously.
  const src = await img.getAttribute("src");
  await signUpWithCompany(outsider.page, "Other Co");
  const res = await outsider.page.request.get(src!, { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  const anon = await browser.newContext();
  const anonRes = await anon.request.get(`http://localhost:3100${src}`, { maxRedirects: 0 });
  expect([307, 404]).toContain(anonRes.status());
  expect(anonRes.headers()["location"] ?? "").not.toContain("storage");
  await anon.close();

  await owner.ctx.close();
  await tech.ctx.close();
  await outsider.ctx.close();
});
