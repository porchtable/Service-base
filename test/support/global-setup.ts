import { migrate } from "../../scripts/db-migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/fsa_test";
  process.env.DATABASE_URL = url;
  await migrate(url, { reset: true, compat: true, quiet: true });
}
