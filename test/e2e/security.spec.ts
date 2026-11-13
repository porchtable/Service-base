import { test, expect } from "@playwright/test";
import { fakeIp, signUpWithCompany } from "./helpers";

test("session cookies are HttpOnly and security headers are present", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  await signUpWithCompany(page, "Cookie Audit Co");
  const authCookies = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(authCookies.length).toBeGreaterThan(0);
  for (const c of authCookies) {
    expect(c.httpOnly, `${c.name} must be HttpOnly`).toBe(true);
    expect(c.sameSite).toBe("Lax");
  }
  expect(await page.evaluate(() => document.cookie.includes("sb-"))).toBe(false);

  const res = await page.request.get("/app");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["strict-transport-security"]).toBeTruthy();
  expect(h["x-powered-by"]).toBeUndefined();
});

test("bad identifiers return 404 without leaking internals", async ({ page, context }) => {
  // Dev builds intentionally embed debug stacks; this check is meaningful only in production mode.
  test.skip(process.env.E2E_MODE !== "production", "run with playwright.prod.config.ts");
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  await signUpWithCompany(page, "Leak Audit Co");
  for (const path of ["/app/customers/not-a-uuid", "/app/jobs/00000000-0000-4000-8000-000000000000", "/app/estimates/'%20or%201=1--", "/api/attachments/../../etc"]) {
    const res = await page.goto(path);
    expect([404, 400], path).toContain(res?.status());
    const body = await page.content();
    expect(body).not.toMatch(/postgres|stack|at Object\.|DATABASE_URL|syntax error/i);
  }
});
