import "server-only";
import { db, type Tx } from "@/server/db/client";

export interface DbIdentity {
  userId: string;
  email?: string | null;
}

/**
 * Runs `fn` in a transaction as the Supabase `authenticated` role with the
 * caller's JWT claims, so every statement is filtered by Row Level Security
 * (identical to how Supabase's Data API executes requests).
 */
export async function withUser<T>(identity: DbIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: identity.userId, role: "authenticated", email: identity.email ?? undefined });
  return db().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`;
    return fn(tx);
  }) as Promise<T>;
}
