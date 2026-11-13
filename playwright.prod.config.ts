import { defineConfig, devices } from "@playwright/test";

/**
 * Production-mode smoke/security suite: real `next build` + `next start`
 * (NODE_ENV=production, Secure cookies, no dev overlays). Email transport is left
 * unconfigured, exactly as in a fresh deployment.
 *   npx playwright test -c playwright.prod.config.ts
 */
process.env.E2E_MODE = "production";
const PORT = 3100;
const E2E_DB = "postgres://postgres:postgres@127.0.0.1:54322/fsa_e2e";
const SITE = `http://localhost:${PORT}`;
const env = {
  DATABASE_URL: E2E_DB,
  NEXT_PUBLIC_SITE_URL: SITE,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "emulator-publishable-key",
  SUPABASE_SECRET_KEY: "emulator-secret-key",
  CRON_SECRET: "e2e-cron-secret-0123456789abcdef-0123456789",
  ESTIMATE_LINK_SECRET: "e2e-link-secret-0123456789abcdef-0123456789",
  STRIPE_WEBHOOK_SECRET: "whsec_e2e_test_secret",
};

export default defineConfig({
  testDir: "test/e2e",
  testMatch: /(security|auth|customers|phase3)\.spec\.ts/,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./test/e2e/global-setup.ts",
  use: { baseURL: SITE, trace: "off", ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "npx tsx test/support/supabase-emulator.ts",
      url: "http://127.0.0.1:54321/auth/v1/health",
      env: { DATABASE_URL: E2E_DB, SITE_URL: SITE, EMULATOR_PORT: "54321" },
    },
    {
      command: `npx next build && npx next start --port ${PORT}`,
      url: SITE,
      timeout: 300_000,
      env: { ...env, NODE_ENV: "production" },
    },
  ],
});
