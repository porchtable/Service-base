import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

export const EMULATOR = "http://127.0.0.1:54321";
export const db = postgres("postgres://postgres:postgres@127.0.0.1:54322/fsa_e2e", { max: 2, onnotice: () => {} });

export function uniqueEmail(prefix = "user") {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Each test gets its own client IP so per-IP rate limits don't interfere across tests. */
export function fakeIp() {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
}

export async function latestEmail(request: APIRequestContext, to: string, kind: string) {
  let found: { link: string } | undefined;
  await expect.poll(async () => {
    const res = await request.get(`${EMULATOR}/__emails?to=${encodeURIComponent(to)}`);
    const list = (await res.json()) as Array<{ kind: string; link: string }>;
    found = list.filter((e) => e.kind === kind).at(-1);
    return Boolean(found);
  }).toBe(true);
  return found!;
}

/** Register through the real UI, confirm via the emailed link, and land on onboarding. */
export async function registerAndVerify(page: Page, opts: { email?: string; password?: string; name?: string } = {}) {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? "correct-horse-42";
  await page.goto("/register");
  await page.getByLabel("Your name").fill(opts.name ?? "Pat Contractor");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  const mail = await latestEmail(page.request, email, "confirmation");
  await page.goto(mail.link);
  await expect(page).toHaveURL(/\/onboarding/);
  return { email, password };
}

export async function createCompany(page: Page, name: string) {
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

export async function signUpWithCompany(page: Page, company: string) {
  const creds = await registerAndVerify(page);
  await createCompany(page, company);
  return creds;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
