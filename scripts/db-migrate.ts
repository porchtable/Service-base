/**
 * Applies versioned SQL migrations in supabase/migrations to DATABASE_URL.
 *
 * Production/staging on Supabase: prefer `supabase db push` (Supabase CLI), which
 * records into the same supabase_migrations.schema_migrations table.
 *
 * Usage:
 *   tsx scripts/db-migrate.ts                 # apply pending migrations
 *   tsx scripts/db-migrate.ts --compat        # LOCAL ONLY: first load test/support/supabase-compat.sql
 *   tsx scripts/db-migrate.ts --reset --compat  # LOCAL ONLY: drop & recreate the database first
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));

function isLocal(u: string) {
  const host = new URL(u).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export async function migrate(databaseUrl: string, opts: { compat?: boolean; reset?: boolean; quiet?: boolean } = {}) {
  const log = opts.quiet ? () => {} : console.log;
  if ((opts.compat || opts.reset) && !isLocal(databaseUrl)) {
    throw new Error("--compat/--reset are only allowed against a localhost database");
  }
  if (opts.reset) {
    const u = new URL(databaseUrl);
    const dbName = u.pathname.slice(1);
    u.pathname = "/postgres";
    const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`create database "${dbName}"`);
    await admin.end();
    log(`reset database ${dbName}`);
  }
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    if (opts.compat) {
      await sql.unsafe(readFileSync(path.join(process.cwd(), "test/support/supabase-compat.sql"), "utf8"));
      log("loaded supabase-compat bootstrap (local only)");
    }
    await sql.unsafe(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key, statements text[], name text
      );`);
    const dir = path.join(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
    const applied = new Set(
      (await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version as string),
    );
    for (const file of files) {
      const version = file.slice(0, 14);
      if (applied.has(version)) continue;
      const body = readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements)
                 values (${version}, ${file.slice(15, -4)}, ${[body]})`;
      });
      log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("scripts", "db-migrate.ts"));
if (isDirectRun) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  migrate(url, { compat: args.has("--compat"), reset: args.has("--reset") }).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
