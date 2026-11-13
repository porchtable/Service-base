import { test, expect } from "@playwright/test";
import Stripe from "stripe";
import { EMULATOR, db, fakeIp, latestEmail, login, registerAndVerify, signUpWithCompany, uniqueEmail } from "./helpers";

const WEBHOOK_SECRET = "whsec_e2e_test_secret";

/** Sign up via the Supabase Auth API directly (bypassing the app's form), then confirm. */
async function registerAndVerifyDirect(page: import("@playwright/test").Page) {
  const email = uniqueEmail("direct");
  const res = await page.request.post(`${EMULATOR}/auth/v1/signup`, { data: { email, password: "correct-horse-42" } });
  expect(res.ok()).toBe(true);
  const mail = await latestEmail(page.request, email, "confirmation");
  await page.goto(mail.link);
  await expect(page).toHaveURL(/\/onboarding/);
}

test("platform admin is explicit; contractors cannot reach it", async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const page = await ctx.newPage();
  const { email } = await signUpWithCompany(page, "Ordinary Contractor Co");
  for (const path of ["/admin", "/admin/organizations", "/admin/config", "/admin/requests"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByText("Platform administration")).toHaveCount(0);
  }

  // Explicit grant (as the CLI script does) → access.
  await db`insert into public.platform_administrators (user_id) select id from auth.users where email = ${email}`;
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Application health")).toBeVisible();
  await page.goto("/admin/organizations?q=Ordinary");
  await expect(page.getByRole("cell", { name: "Ordinary Contractor Co" })).toBeVisible();

  // Configuration: close registrations, verify, reopen.
  await page.goto("/admin/config");
  const signup = page.locator("form").filter({ hasText: "features.signup" });
  await signup.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("features.signup = false")).toBeVisible();
  const anon = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const visitor = await anon.newPage();
  await visitor.goto("/register");
  await visitor.getByLabel("Your name").fill("Late Comer");
  await visitor.getByLabel("Work email").fill(uniqueEmail("late"));
  await visitor.getByLabel("Password").fill("correct-horse-42");
  await visitor.getByRole("button", { name: "Create account" }).click();
  await expect(visitor.getByText("New registrations are temporarily closed.")).toBeVisible();
  // An account created directly through Supabase Auth still cannot create a company.
  const direct = await anon.newPage();
  await registerAndVerifyDirect(direct);
  await direct.getByLabel("Company name").fill("Sneaky Co");
  await direct.getByRole("button", { name: "Create company" }).click();
  await expect(direct.getByText("New company registration is temporarily closed.")).toBeVisible();
  await page.locator("form").filter({ hasText: "features.signup" }).getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("features.signup = true")).toBeVisible();

  // Register a plan (operator-provided Stripe Price ID; no price is invented).
  await page.locator("#new-key").fill("e2e-plan");
  await page.locator("#new-name").fill("Standard");
  await page.locator("#new-price").fill("price_e2eTest123");
  await page.getByRole("button", { name: "Add plan" }).click();
  await expect(page.getByText("Plan saved")).toBeVisible();
  const plans = await db`select name, stripe_price_id, is_active from public.billing_plans where key = 'e2e-plan'`;
  expect(plans).toEqual([{ name: "Standard", stripe_price_id: "price_e2eTest123", is_active: false }]);
  await anon.close();
  await ctx.close();
});

test("Stripe webhook endpoint authenticates and is idempotent", async ({ request }) => {
  const payload = JSON.stringify({
    id: `evt_e2e${Date.now()}`, object: "event", type: "customer.subscription.updated", created: 1_800_000_000,
    data: { object: { id: "sub_e2e", object: "subscription", customer: "cus_e2e_unknown", status: "active", cancel_at_period_end: false,
      canceled_at: null, trial_end: null, metadata: {}, items: { data: [{ current_period_end: 1_802_000_000, price: { id: "price_x" } }] } } },
  });
  expect((await request.post("/api/stripe/webhook", { data: payload, headers: { "content-type": "application/json" } })).status()).toBe(400);
  expect((await request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": "t=1,v1=bad" } })).status()).toBe(400);
  const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const first = await request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": sig, "content-type": "application/json" } });
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ received: true });
  const replay = await request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": sig, "content-type": "application/json" } });
  expect(await replay.json()).toEqual({ received: true, duplicate: true });
});

test("billing page, data export, health check, account deletion workflow", async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const page = await ctx.newPage();
  const { email, password } = await signUpWithCompany(page, "Lifecycle HVAC");

  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByText("No subscription")).toBeVisible();
  await expect(page.getByText("All features are currently available without a subscription.")).toBeVisible();

  await page.goto("/app/settings/data");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download export" }).click();
  const file = await download;
  const content = await (await file.createReadStream()).toArray();
  const json = JSON.parse(Buffer.concat(content as Buffer[]).toString());
  expect(json.organization.name).toBe("Lifecycle HVAC");

  expect((await page.request.get("/api/health")).status()).toBe(200);

  // Account deletion request → operator approves → the user can no longer sign in.
  await page.goto("/app/account");
  await page.getByRole("button", { name: "Request account deletion" }).click();
  await page.getByRole("dialog").getByLabel("Reason (optional)").fill("Testing deletion");
  await page.getByRole("dialog").getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText(/Deletion requested on/)).toBeVisible();

  const opCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const op = await opCtx.newPage();
  const operator = await registerAndVerify(op);
  await db`insert into public.platform_administrators (user_id) select id from auth.users where email = ${operator.email}`;
  await op.goto("/admin/requests");
  const row = op.locator("li").filter({ hasText: "Testing deletion" });
  await row.getByRole("button", { name: "Approve & delete" }).click();
  await op.getByRole("dialog").getByRole("button", { name: "Delete account" }).click();
  await expect(op.locator("li").filter({ hasText: "Testing deletion" }).getByText("completed")).toBeVisible();
  const remaining = await db`select count(*)::int as n from public.organizations where name = 'Lifecycle HVAC'`;
  expect(remaining[0].n).toBe(0);

  const fresh = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  const again = await fresh.newPage();
  await login(again, email, password);
  await expect(again.getByText("Incorrect email or password")).toBeVisible();
  await ctx.close();
  await opCtx.close();
  await fresh.close();
});
