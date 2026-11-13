import { migrate } from "../../scripts/db-migrate";

export default async function globalSetup() {
  // Fresh database for every run. (The emulator holds an open pool, so we only
  // reset when it is not running yet — Playwright starts webServers after this.)
  await migrate("postgres://postgres:postgres@127.0.0.1:54322/fsa_e2e", { reset: true, compat: true, quiet: true });
}
