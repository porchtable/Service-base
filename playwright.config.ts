import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const E2E_DB = "postgres://postgres:postgres@127.0.0.1:54322/fsa_e2e";
export const SITE = `http://localhost:${PORT}`;

/**
 * E2E runs the real Next.js app against a local Postgres plus the TEST-ONLY
 * Supabase emulator (test/support/supabase-emulator.ts). See docs/TESTING.md.
 */
export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./test/e2e/global-setup.ts",
  use: {
    baseURL: SITE,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "npx tsx test/support/supabase-emulator.ts",
      url: "http://127.0.0.1:54321/auth/v1/health",
      env: { DATABASE_URL: E2E_DB, SITE_URL: SITE, EMULATOR_PORT: "54321" },
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: `npx next dev --port ${PORT}`,
      url: SITE,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: E2E_DB,
        NEXT_PUBLIC_SITE_URL: SITE,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "emulator-publishable-key",
        SUPABASE_SECRET_KEY: "emulator-secret-key",
        EMAIL_TRANSPORT: "capture",
        EMAIL_FROM: "Estimates <estimates@example.test>",
        CRON_SECRET: "e2e-cron-secret-0123456789abcdef",
        STRIPE_WEBHOOK_SECRET: "whsec_e2e_test_secret",
        STRIPE_SECRET_KEY: "sk_test_e2e_not_a_real_key",
      },
    },
  ],
});
