import "server-only";
import { z } from "zod";
import type { EstimateSnapshot } from "@/lib/estimate-snapshot";
import { withService } from "@/server/db/service";
import { auditSystem } from "@/server/audit";
import { hashToken, looksLikeToken } from "@/server/tokens";

/**
 * Customer-facing estimate access (no user session). Runs with the service
 * connection, scoped strictly by the token hash. Every failure mode (unknown,
 * revoked, expired token; superseded version) returns the same generic result so
 * the page cannot be used to probe for valid links.
 */
export type CustomerEstimateView =
  | { kind: "unavailable" }
  | {
      kind: "ok";
      status: "sent" | "accepted" | "declined" | "expired";
      snapshot: EstimateSnapshot;
      decision: { decision: "accepted" | "declined"; signerName: string | null; createdAt: Date } | null;
      canDecide: boolean;
    };

interface TokenRow {
  token_id: string;
  organization_id: string;
  estimate_version_id: string;
  estimate_id: string;
  status: string;
  expires_at: Date;
  snapshot: EstimateSnapshot;
}

async function resolve(tx: Parameters<Parameters<typeof withService>[0]>[0], token: string): Promise<TokenRow | null> {
  if (!looksLikeToken(token)) return null;
  const [row] = await tx<TokenRow[]>`
    select t.id as token_id, t.organization_id, t.estimate_version_id, v.estimate_id, v.status, v.expires_at, v.snapshot
    from public.estimate_access_tokens t
    join public.estimate_versions v on v.id = t.estimate_version_id
    where t.token_hash = ${hashToken(token)}
      and t.revoked_at is null
      and t.expires_at > now()
      and v.status in ('sent', 'accepted', 'declined', 'expired')
      and v.snapshot is not null`;
  return row ?? null;
}

export async function loadCustomerEstimate(token: string): Promise<CustomerEstimateView> {
  return withService(async (tx) => {
    const row = await resolve(tx, token);
    if (!row) return { kind: "unavailable" };
    await tx`update public.estimate_access_tokens set last_used_at = now() where id = ${row.token_id}`;
    const [d] = await tx`select decision, signer_name, created_at from public.estimate_decisions where estimate_version_id = ${row.estimate_version_id}`;
    const effectiveStatus = row.status === "sent" && new Date(row.expires_at) <= new Date() ? "expired" : (row.status as "sent" | "accepted" | "declined" | "expired");
    return {
      kind: "ok",
      status: effectiveStatus,
      snapshot: row.snapshot,
      decision: d ? { decision: d.decision, signerName: d.signer_name, createdAt: d.created_at } : null,
      canDecide: effectiveStatus === "sent" && !d,
    };
  });
}

export const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("accepted"),
    signerName: z.string().trim().min(1, "Type your full name to accept").max(160),
    comment: z.string().trim().max(2000).optional().transform((v) => v || undefined),
    agree: z.literal("on", { error: "Confirm that you accept this estimate" }),
  }),
  z.object({
    decision: z.literal("declined"),
    signerName: z.string().trim().max(160).optional().transform((v) => v || undefined),
    comment: z.string().trim().max(2000).optional().transform((v) => v || undefined),
  }),
]);

export type DecisionOutcome =
  | { kind: "recorded"; decision: "accepted" | "declined" }
  | { kind: "already_decided"; decision: "accepted" | "declined"; sameAsRequested: boolean }
  | { kind: "not_available"; reason: "expired" | "unavailable" };

/**
 * Records a customer decision exactly once per version. Concurrent or repeated
 * submissions (double clicks, retries) resolve to the existing decision.
 */
export async function recordCustomerDecision(
  token: string,
  input: unknown,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DecisionOutcome> {
  const d = decisionSchema.parse(input);
  return withService(async (tx) => {
    const row = await resolve(tx, token);
    if (!row) return { kind: "not_available", reason: "unavailable" };
    // Serialize concurrent decisions for this version.
    const [locked] = await tx`select status, expires_at from public.estimate_versions where id = ${row.estimate_version_id} for update`;
    const [existing] = await tx`select decision from public.estimate_decisions where estimate_version_id = ${row.estimate_version_id}`;
    if (existing) {
      return { kind: "already_decided", decision: existing.decision, sameAsRequested: existing.decision === d.decision };
    }
    if (locked.status !== "sent" || new Date(locked.expires_at) <= new Date()) {
      return { kind: "not_available", reason: "expired" };
    }
    const inserted = await tx`
      insert into public.estimate_decisions (organization_id, estimate_version_id, decision, signer_name, comment, access_token_id, ip_address, user_agent)
      values (${row.organization_id}, ${row.estimate_version_id}, ${d.decision}, ${d.signerName ?? null}, ${d.comment ?? null},
              ${row.token_id}, ${meta.ip}, ${meta.userAgent})
      on conflict (estimate_version_id) do nothing
      returning id`;
    if (inserted.length === 0) {
      const [again] = await tx`select decision from public.estimate_decisions where estimate_version_id = ${row.estimate_version_id}`;
      return { kind: "already_decided", decision: again.decision, sameAsRequested: again.decision === d.decision };
    }
    await auditSystem(tx, {
      organizationId: row.organization_id,
      actorType: "customer",
      action: `estimate.customer_${d.decision}`,
      entityType: "estimate",
      entityId: row.estimate_id,
      metadata: { version_id: row.estimate_version_id, signer_name: d.signerName ?? null },
      ipAddress: meta.ip,
    });
    return { kind: "recorded", decision: d.decision };
  });
}
