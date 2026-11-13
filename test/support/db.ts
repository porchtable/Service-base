import postgres from "postgres";
import { randomUUID } from "node:crypto";

/** Superuser connection for test fixtures only (simulates Supabase Auth creating users). */
export const adminSql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });

export async function createAuthUser(opts: { email?: string; confirmed?: boolean; fullName?: string } = {}) {
  const email = (opts.email ?? `user-${randomUUID()}@example.test`).toLowerCase();
  const [row] = await adminSql`
    insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
    values (${email}, ${opts.confirmed === false ? null : new Date()}, ${adminSql.json({ full_name: opts.fullName ?? "Test User" })})
    returning id`;
  return { userId: row.id as string, email };
}

/** Run raw SQL as an authenticated user (RLS applies) — mirrors withUser(). */
export async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return adminSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true),
                    set_config('role', 'authenticated', true)`;
    return fn(tx);
  }) as Promise<T>;
}

export async function asAnon<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return adminSql.begin(async (tx) => {
    await tx`select set_config('role', 'anon', true)`;
    return fn(tx);
  }) as Promise<T>;
}

export async function expectPgError(p: Promise<unknown>, code?: string): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (code && e.code !== code) throw new Error(`expected pg error ${code}, got ${e.code}: ${e.message}`);
    return e.message ?? "";
  }
  throw new Error("expected query to fail, but it succeeded");
}
