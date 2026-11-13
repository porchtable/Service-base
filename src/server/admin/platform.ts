import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { withUser } from "@/server/db/tenant";
import { withService } from "@/server/db/service";
import { auditSystem } from "@/server/audit";
import { env } from "@/server/env";
import { conflict, invalid } from "@/server/errors";
import { CONFIG_KEYS } from "@/server/platform-config";
import { supabaseAdmin } from "@/server/supabase/admin";

export interface PlatformAdmin {
  userId: string;
  email: string | null;
}

/** True only for users explicitly listed in platform_administrators (checked via RLS as the user). */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const rows = await withUser({ userId }, (tx) => tx`select 1 from public.platform_administrators where user_id = ${userId}`);
  return rows.length > 0;
}

/** For admin pages: 404 for everyone else (does not reveal that the area exists). */
export const requirePlatformAdmin = cache(async (): Promise<PlatformAdmin> => {
  const user = await requireUser("/admin");
  if (!(await isPlatformAdmin(user.id))) notFound();
  return { userId: user.id, email: user.email };
});

/** For admin actions: re-verified on every call. */
export async function assertPlatformAdmin(): Promise<PlatformAdmin> {
  return requirePlatformAdmin();
}

/** Show only enough of an address to troubleshoot (j***@example.com). */
export function maskEmail(email: string | null): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function platformOverview() {
  return withService(async (tx) => {
    const t0 = Date.now();
    const [counts] = await tx`
      select
        (select count(*) from public.organizations)::int as organizations,
        (select count(*) from public.profiles)::int as users,
        (select count(*) from public.organization_members)::int as memberships,
        (select count(*) from public.estimates where status in ('sent','accepted','declined','expired'))::int as estimates_sent,
        (select count(*) from public.estimates where status = 'accepted')::int as estimates_accepted,
        (select count(*) from public.follow_up_jobs where status = 'failed')::int as failed_jobs,
        (select count(*) from public.follow_up_jobs where status = 'pending' and coalesce(next_attempt_at, scheduled_for) < now() - interval '15 minutes')::int as overdue_jobs,
        (select count(*) from public.email_events where status in ('failed','bounced','complained') and created_at > now() - interval '7 days')::int as email_failures_7d,
        (select count(*) from public.data_requests where status = 'pending')::int as pending_requests,
        (select count(*) from public.stripe_events where processed_at is null and received_at < now() - interval '5 minutes')::int as stuck_stripe_events`;
    const dbLatencyMs = Date.now() - t0;
    const subs = await tx`
      select coalesce(s.status, 'none') as status, count(*)::int as n
      from public.organizations o left join public.subscriptions s on s.organization_id = o.id
      group by 1 order by 2 desc`;
    const [worker] = await tx`select value from public.platform_config where key = ${CONFIG_KEYS.workerLastRun}`;
    const e = env();
    const workerLastRun = typeof worker?.value === "string" ? new Date(worker.value) : null;
    return {
      counts,
      subscriptions: subs.map((r) => ({ status: r.status as string, count: r.n as number })),
      health: {
        databaseLatencyMs: dbLatencyMs,
        workerLastRun,
        workerStale: !workerLastRun || Date.now() - workerLastRun.getTime() > 15 * 60_000,
        integrations: {
          supabaseSecretKey: Boolean(e.SUPABASE_SECRET_KEY),
          ai: Boolean(e.ANTHROPIC_API_KEY),
          email: e.EMAIL_TRANSPORT === "capture" ? "capture (test only)" : Boolean(e.RESEND_API_KEY && e.EMAIL_FROM),
          emailWebhook: Boolean(e.RESEND_WEBHOOK_SECRET),
          stripe: e.STRIPE_SECRET_KEY ? (e.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test") : false,
          stripeWebhook: Boolean(e.STRIPE_WEBHOOK_SECRET),
          cron: Boolean(e.CRON_SECRET),
          linkSecret: Boolean(e.ESTIMATE_LINK_SECRET),
        },
      },
    };
  });
}

export async function listOrganizationsForAdmin(q?: string) {
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  return withService(async (tx) => {
    const rows = await tx`
      select o.id, o.name, o.industry, o.created_at,
        (select count(*) from public.organization_members m where m.organization_id = o.id)::int as members,
        (select count(*) from public.estimates e where e.organization_id = o.id)::int as estimates,
        coalesce(s.status, 'none') as subscription_status, p.name as plan_name, s.current_period_end, s.cancel_at_period_end
      from public.organizations o
      left join public.subscriptions s on s.organization_id = o.id
      left join public.billing_plans p on p.id = s.plan_id
      ${like ? tx`where o.name ilike ${like}` : tx``}
      order by o.created_at desc limit 500`;
    return rows;
  });
}

export async function listFailedJobs() {
  return withService(async (tx) => {
    const rows = await tx`
      select f.id, f.kind, f.attempts, f.last_error, f.updated_at, o.name as org_name, ev.to_email
      from public.follow_up_jobs f
      join public.organizations o on o.id = f.organization_id
      left join public.email_events ev on ev.id = f.email_event_id
      where f.status = 'failed' order by f.updated_at desc limit 200`;
    return rows.map((r) => ({
      id: r.id as string, kind: r.kind as string, attempts: r.attempts as number, last_error: r.last_error as string | null,
      updated_at: r.updated_at as Date, org_name: r.org_name as string, to_email: maskEmail(r.to_email),
    }));
  });
}

export async function listEmailFailures() {
  return withService(async (tx) => {
    const rows = await tx`
      select ev.id, ev.category, ev.status, ev.error, ev.to_email, ev.provider, ev.updated_at, o.name as org_name
      from public.email_events ev left join public.organizations o on o.id = ev.organization_id
      where ev.status in ('failed', 'bounced', 'complained') order by ev.updated_at desc limit 200`;
    return rows.map((r) => ({
      id: r.id as string, category: r.category as string, status: r.status as string, error: r.error as string | null,
      provider: r.provider as string, updated_at: r.updated_at as Date, org_name: r.org_name as string | null, to_email: maskEmail(r.to_email),
    }));
  });
}

/** Audit events without metadata payloads (which can contain customer names). */
export async function listAuditEvents(params: { organizationId?: string; action?: string }) {
  const p = z.object({ organizationId: z.uuid().optional(), action: z.string().trim().max(100).optional() }).parse(params);
  return withService((tx) => tx`
    select a.id, a.created_at, a.action, a.actor_type, a.entity_type, o.name as org_name
    from public.audit_events a left join public.organizations o on o.id = a.organization_id
    where true
      ${p.organizationId ? tx`and a.organization_id = ${p.organizationId}` : tx``}
      ${p.action ? tx`and a.action ilike ${`${p.action.replace(/[\\%_]/g, "")}%`}` : tx``}
    order by a.created_at desc limit 300`);
}

// ---------------------------------------------------------------------------
// Configuration & plans
// ---------------------------------------------------------------------------
export async function listConfig() {
  return withService((tx) => tx`select key, value, description, updated_at from public.platform_config order by key`);
}

const EDITABLE_FLAGS = [CONFIG_KEYS.enforceSubscription, CONFIG_KEYS.aiDrafting, CONFIG_KEYS.signup] as string[];

export async function setConfigFlag(admin: PlatformAdmin, key: string, value: boolean) {
  if (!EDITABLE_FLAGS.includes(key)) throw invalid("That setting cannot be changed here");
  await withService(async (tx) => {
    await tx`update public.platform_config set value = ${tx.json(value)}, updated_by = ${admin.userId}, updated_at = now() where key = ${key}`;
    await auditSystem(tx, { organizationId: null, actorType: "platform_admin", actorUserId: admin.userId, action: "platform.config_changed", metadata: { key, value } });
  });
}

export const planSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, "Use 2–40 lowercase letters, numbers, - or _"),
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  stripePriceId: z.string().trim().regex(/^price_[A-Za-z0-9]+$/, "Paste the Stripe Price ID (starts with price_)"),
  trialDays: z.string().trim().optional().transform((v, c) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      c.addIssue({ code: "custom", message: "1–90 days, or leave empty for no trial" });
      return z.NEVER;
    }
    return n;
  }),
  isActive: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function listAllPlans() {
  return withService((tx) => tx`select * from public.billing_plans order by sort_order, name`);
}

export async function upsertPlan(admin: PlatformAdmin, id: string | null, input: unknown) {
  const d = planSchema.parse(input);
  await withService(async (tx) => {
    if (id) {
      z.uuid().parse(id);
      await tx`update public.billing_plans set key = ${d.key}, name = ${d.name}, description = ${d.description}, stripe_price_id = ${d.stripePriceId},
               trial_days = ${d.trialDays}, is_active = ${d.isActive}, sort_order = ${d.sortOrder} where id = ${id}`;
    } else {
      await tx`insert into public.billing_plans (key, name, description, stripe_price_id, trial_days, is_active, sort_order)
               values (${d.key}, ${d.name}, ${d.description}, ${d.stripePriceId}, ${d.trialDays}, ${d.isActive}, ${d.sortOrder})`;
    }
    await auditSystem(tx, { organizationId: null, actorType: "platform_admin", actorUserId: admin.userId, action: id ? "platform.plan_updated" : "platform.plan_created", metadata: { key: d.key, active: d.isActive } });
  });
}

// ---------------------------------------------------------------------------
// Data requests (account deletion)
// ---------------------------------------------------------------------------
export async function listDataRequests() {
  return withService((tx) => tx`
    select r.*, o.name as org_name from public.data_requests r left join public.organizations o on o.id = r.organization_id
    order by case r.status when 'pending' then 0 else 1 end, r.created_at desc limit 200`);
}

/**
 * Deletes a user's account after checking that no organization would be left
 * without an owner while other members remain. Organizations where the user is
 * the only member are deleted with the account (cascade).
 */
export async function processAccountDeletion(admin: PlatformAdmin, requestId: string, approve: boolean, note?: string) {
  z.uuid().parse(requestId);
  const req = await withService(async (tx) => {
    const [r] = await tx`select * from public.data_requests where id = ${requestId} and kind = 'account_deletion' for update`;
    if (!r) throw invalid("Request not found");
    if (r.status !== "pending") throw conflict("This request was already resolved");
    return r;
  });
  if (!approve) {
    await withService(async (tx) => {
      await tx`update public.data_requests set status = 'rejected', resolution_note = ${note ?? null}, resolved_by = ${admin.userId}, resolved_at = now() where id = ${requestId}`;
      await auditSystem(tx, { organizationId: null, actorType: "platform_admin", actorUserId: admin.userId, action: "platform.deletion_rejected", entityType: "data_request", entityId: requestId });
    });
    return;
  }
  const userId = req.user_id as string | null;
  if (userId) {
    const blocking = await withService((tx) => tx`
      select o.name from public.organization_members m join public.organizations o on o.id = m.organization_id
      where m.user_id = ${userId} and m.role = 'owner'
        and not exists (select 1 from public.organization_members x where x.organization_id = m.organization_id and x.role = 'owner' and x.user_id <> ${userId})
        and exists (select 1 from public.organization_members y where y.organization_id = m.organization_id and y.user_id <> ${userId})`);
    if (blocking.length > 0) {
      throw conflict(`The user is the only owner of ${blocking.map((b) => b.name).join(", ")}, which has other members. Ask them to transfer ownership first.`);
    }
    await withService(async (tx) => {
      // Organizations where they are the sole member go with the account.
      await tx`delete from public.organizations o where exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = ${userId})
               and not exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id <> ${userId})`;
    });
    const { error } = await supabaseAdmin().auth.admin.deleteUser(userId);
    if (error) throw new Error(`Auth deletion failed: ${error.message}`);
  }
  await withService(async (tx) => {
    await tx`update public.data_requests set status = 'completed', resolution_note = ${note ?? null}, resolved_by = ${admin.userId}, resolved_at = now() where id = ${requestId}`;
    await auditSystem(tx, { organizationId: null, actorType: "platform_admin", actorUserId: admin.userId, action: "platform.account_deleted", entityType: "data_request", entityId: requestId });
  });
}
