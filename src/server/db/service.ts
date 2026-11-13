import "server-only";
import { db, type Tx } from "@/server/db/client";

/**
 * PRIVILEGED: runs as `service_role` (bypasses RLS).
 *
 * Allowed callers only: customer estimate token pages, Stripe/Resend webhooks,
 * background worker, rate limiter, platform administration (aggregates only),
 * and auth flows that run before a session exists. Every caller must scope its
 * queries explicitly (by token hash, organization id, event id, ...).
 */
export async function withService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('role', 'service_role', true)`;
    return fn(tx);
  }) as Promise<T>;
}
