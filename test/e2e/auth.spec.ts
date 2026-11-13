import { test, expect } from "@playwright/test";
import { createCompany, fakeIp, latestEmail, login, registerAndVerify, uniqueEmail } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
});

test("register → verify email → create organization → log out → log in", async ({ page }) => {
  const email = uniqueEmail("owner");
  const password = "correct-horse-42";

  // Cannot log in before verifying.
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Jordan Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  await login(page, email, password);
  await expect(page.getByText("Please verify your email address first")).toBeVisible();

  // Verify via the emailed link.
  const mail = await latestEmail(page.request, email, "confirmation");
  await page.goto(mail.link);
  await expect(page).toHaveURL(/\/onboarding/);
  await createCompany(page, "Northwind Heating & Air");
  await expect(page.getByText("Northwind Heating & Air").first()).toBeVisible();

  // Log out.
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login\?signed_out=1/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);

  // Log back in; redirected to the original destination.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("wrong password is rejected without revealing account existence", async ({ page }) => {
  const { email } = await registerAndVerify(page);
  await page.context().clearCookies();
  await login(page, email, "wrong-password-1");
  await expect(page.getByText("Incorrect email or password")).toBeVisible();
  await login(page, uniqueEmail("nobody"), "wrong-password-1");
  await expect(page.getByText("Incorrect email or password")).toBeVisible();
});

test("password reset via emailed link", async ({ page }) => {
  const { email } = await registerAndVerify(page);
  await page.context().clearCookies();
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account exists for that address")).toBeVisible();
  const mail = await latestEmail(page.request, email, "recovery");
  await page.goto(mail.link);
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByLabel(/^New password/).fill("brand-new-pass-77");
  await page.getByLabel("Confirm new password").fill("brand-new-pass-77");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/onboarding|\/app/);
  await page.context().clearCookies();
  await login(page, email, "brand-new-pass-77");
  await expect(page).toHaveURL(/\/onboarding|\/app/);
});

test("unauthenticated users cannot reach protected routes", async ({ page }) => {
  for (const path of ["/app", "/app/customers", "/app/settings", "/onboarding", "/admin"]) {
    await page.goto(path);
    await expect(page, `${path} should redirect`).toHaveURL(/\/login\?next=/);
  }
  const res = await page.request.post("/app/customers/new", { maxRedirects: 0, failOnStatusCode: false });
  expect([303, 307, 308, 405]).toContain(res.status());
});
