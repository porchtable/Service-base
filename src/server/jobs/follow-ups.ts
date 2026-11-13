import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { EstimateSnapshot } from "@/lib/estimate-snapshot";
import type { Tx } from "@/server/db/client";
import { withService } from "@/server/db/service";
import { withUser } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit, auditSystem } from "@/server/audit";
import { conflict, invalid, notFound } from "@/server/errors";
import { env, requireSetting } from "@/server/env";
import { hashToken } from "@/server/tokens";
import { EmailSendError, getEmailTransport, type EmailTransport } from "@/server/email/transport";
import { estimateEmail } from "@/server/email/templates";

export type FollowUpKind = "initial_delivery" | "automatic_reminder" | "manual_reminder";
export type FollowUpStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";

export interface FollowUpRow {
  id: string;
  organization_id: string;
  estimate_version_id: string;
  kind: FollowUpKind;
  sequence: number;
  scheduled_for: Date;
  status: FollowUpStatus;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  locked_by: string | null;
}

/** Retry delay after the n-th failed attempt: 1, 2, 4, 8 … minutes, capped at 6 hours. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1) * 60_000, 6 * 3600_000);
}

/**
 * The customer link token for an email job is derived from the job id with a
 * server secret, so every retry of the same job sends byte-identical content
 * (required for provider idempotency) and a crash mid-send never strands a link.
 * Only the SHA-256 hash is stored.
 */
export function deriveEmailToken(jobId: string): string {
  const secret = requireSetting("ESTIMATE_LINK_SECRET", "Email delivery");
  return createHmac("sha256", secret).update(`estimate-email:${jobId}`).digest("base64url");
}

// ---------------------------------------------------------------------------
// Scheduling (inside the send transaction)
// ---------------------------------------------------------------------------
export async function scheduleFollowUps(
  tx: Tx,
  args: { organizationId: string; userId: string | null; versionId: string; sendEmail: boolean },
): Promise<boolean> {
  if (!args.sendEmail) return false;
  const [v] = await tx`
    select v.sent_at, v.expires_at, o.follow_up_enabled, o.follow_up_offsets_days
    from public.estimate_versions v join public.organizations o on o.id = v.organization_id
    where v.id = ${args.versionId}`;
  await tx`
    insert into public.follow_up_jobs (organization_id, estimate_version_id, kind, sequence, scheduled_for, idempotency_key, created_by)
    values (${args.organizationId}, ${args.versionId}, 'initial_delivery', 0, now(), ${`estimate-delivery:${args.versionId}`}, ${args.userId})
    on conflict do nothing`;
  if (v.follow_up_enabled) {
    const offsets = (v.follow_up_offsets_days as number[]) ?? [];
    let seq = 0;
    for (const days of offsets) {
      const when = new Date(new Date(v.sent_at).getTime() + days * 86_400_000);
      if (when >= new Date(v.expires_at)) continue; // never remind about an expired estimate
      seq += 1;
      await tx`
        insert into public.follow_up_jobs (organization_id, estimate_version_id, kind, sequence, scheduled_for, idempotency_key, created_by)
        values (${args.organizationId}, ${args.versionId}, 'automatic_reminder', ${seq}, ${when},
                ${`estimate-reminder:${args.versionId}:${seq}`}, ${args.userId})
        on conflict do nothing`;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
export interface ProcessSummary {
  expired: number;
  claimed: number;
  sent: number;
  cancelled: number;
  retrying: number;
  failed: number;
}

type Outcome = "sent" | "cancelled" | "retrying" | "failed" | "skipped";

async function cancelJob(tx: Tx, jobId: string, reason: string) {
  await tx`update public.follow_up_jobs set status = 'cancelled', cancelled_at = now(), cancel_reason = ${reason},
           locked_at = null, locked_by = null where id = ${jobId}`;
}

async function failOrRetry(tx: Tx, job: FollowUpRow, message: string, retryable: boolean, emailEventId: string | null): Promise<Outcome> {
  const [cur] = await tx`select attempts, max_attempts from public.follow_up_jobs where id = ${job.id}`;
  const canRetry = retryable && cur.attempts < cur.max_attempts;
  if (canRetry) {
    await tx`update public.follow_up_jobs set status = 'pending', next_attempt_at = ${new Date(Date.now() + backoffMs(cur.attempts))},
             last_error = ${message.slice(0, 1000)}, locked_at = null, locked_by = null where id = ${job.id}`;
  } else {
    await tx`update public.follow_up_jobs set status = 'failed', last_error = ${message.slice(0, 1000)}, locked_at = null, locked_by = null
             where id = ${job.id}`;
    if (emailEventId) await tx`update public.email_events set status = 'failed', error = ${message.slice(0, 1000)} where id = ${emailEventId}`;
    await auditSystem(tx, {
      organizationId: job.organization_id, actorType: "system", action: "follow_up.failed", entityType: "follow_up_job",
      entityId: job.id, metadata: { error: message.slice(0, 300), kind: job.kind },
    });
  }
  return canRetry ? "retrying" : "failed";
}

async function processOne(job: FollowUpRow, transport: EmailTransport, workerId: string): Promise<Outcome> {
  // Phase 1: validate, persist the link token and the email record (committed before any send).
  const prep = await withService(async (tx) => {
    const [j] = await tx`select * from public.follow_up_jobs where id = ${job.id} for update`;
    if (!j || j.status !== "processing" || j.locked_by !== workerId) return { skip: true as const };
    const [v] = await tx`
      select v.status, v.expires_at, v.snapshot, o.follow_up_enabled, o.email as org_email,
        exists (select 1 from public.estimate_decisions d where d.estimate_version_id = v.id) as decided
      from public.estimate_versions v join public.organizations o on o.id = v.organization_id
      where v.id = ${job.estimate_version_id}`;
    if (!v || v.status !== "sent" || v.decided || new Date(v.expires_at) <= new Date()) {
      await cancelJob(tx, job.id, v?.decided ? "estimate_decided" : `estimate_${v?.status ?? "missing"}`);
      return { skip: true as const, outcome: "cancelled" as Outcome };
    }
    if (job.kind === "automatic_reminder" && !v.follow_up_enabled) {
      await cancelJob(tx, job.id, "follow_ups_disabled");
      return { skip: true as const, outcome: "cancelled" as Outcome };
    }
    const snap = v.snapshot as EstimateSnapshot;
    const to = snap.customer.email;
    if (!to) {
      return { skip: true as const, outcome: await failOrRetry(tx, job, "Customer has no email address", false, null) };
    }
    const token = deriveEmailToken(job.id);
    await tx`
      insert into public.estimate_access_tokens (organization_id, estimate_version_id, token_hash, purpose, expires_at)
      values (${job.organization_id}, ${job.estimate_version_id}, ${hashToken(token)},
              ${job.kind === "initial_delivery" ? "email" : "reminder"}, ${v.expires_at})
      on conflict (token_hash) do nothing`;
    const content = estimateEmail({
      kind: job.kind === "initial_delivery" ? "delivery" : "reminder",
      orgName: snap.organization.name, orgPhone: snap.organization.phone, customerName: snap.customer.name,
      estimateNumber: snap.estimate.number, title: snap.estimate.title, totalCents: snap.totals.total_cents,
      expiresAt: snap.estimate.expiresAt, timeZone: snap.organization.timezone,
      link: `${env().NEXT_PUBLIC_SITE_URL}/e/${token}`,
    });
    const [ev] = await tx`
      insert into public.email_events (organization_id, follow_up_job_id, category, to_email, subject, provider, idempotency_key)
      values (${job.organization_id}, ${job.id}, ${job.kind === "initial_delivery" ? "estimate_delivery" : "estimate_reminder"},
              ${to}, ${content.subject}, ${transport.provider}, ${job.idempotency_key})
      on conflict (idempotency_key) do update set updated_at = now()
      returning id, status`;
    if (["sent", "delivered", "delivery_delayed"].includes(ev.status)) {
      // Crash recovery: a previous attempt already handed this email to the provider.
      await tx`update public.follow_up_jobs set status = 'sent', sent_at = coalesce(sent_at, now()), email_event_id = ${ev.id},
               locked_at = null, locked_by = null where id = ${job.id}`;
      return { skip: true as const, outcome: "sent" as Outcome };
    }
    await tx`update public.follow_up_jobs set email_event_id = ${ev.id} where id = ${job.id}`;
    return {
      skip: false as const,
      emailEventId: ev.id as string,
      message: { to, fromName: snap.organization.name, replyTo: v.org_email as string | null, ...content },
    };
  });
  if (prep.skip) return prep.outcome ?? "skipped";

  // Phase 2: send while holding a share lock on the version. A customer decision
  // (which needs FOR UPDATE) waits until this completes, and vice versa: a reminder
  // can never be sent after a decision has been recorded.
  return withService(async (tx) => {
    await tx`set local lock_timeout = '10s'`;
    const [v] = await tx`select status, expires_at from public.estimate_versions where id = ${job.estimate_version_id} for share`;
    const [decided] = await tx`select 1 from public.estimate_decisions where estimate_version_id = ${job.estimate_version_id}`;
    if (!v || v.status !== "sent" || decided || new Date(v.expires_at) <= new Date()) {
      await cancelJob(tx, job.id, decided ? "estimate_decided" : `estimate_${v?.status ?? "missing"}`);
      await tx`delete from public.email_events where id = ${prep.emailEventId} and status = 'sending'`;
      return "cancelled" as Outcome;
    }
    try {
      const res = await transport.send(prep.message, job.idempotency_key);
      await tx`update public.email_events set status = 'sent', provider_message_id = ${res.providerMessageId}, error = null
               where id = ${prep.emailEventId}`;
      await tx`update public.follow_up_jobs set status = 'sent', sent_at = now(), last_error = null, locked_at = null, locked_by = null
               where id = ${job.id}`;
      return "sent" as Outcome;
    } catch (err) {
      const retryable = err instanceof EmailSendError ? err.retryable : true;
      const message = err instanceof Error ? err.message : "Unknown email error";
      if (!(err instanceof EmailSendError)) console.error("[follow-ups] send error", err);
      return failOrRetry(tx, job, message, retryable, prep.emailEventId);
    }
  });
}

/**
 * Expire overdue estimates, then claim and process due email jobs. Safe to run
 * concurrently from several workers/cron invocations.
 */
export async function processFollowUps(opts: { limit?: number; versionId?: string; transport?: EmailTransport; workerId?: string } = {}): Promise<ProcessSummary> {
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const summary: ProcessSummary = { expired: 0, claimed: 0, sent: 0, cancelled: 0, retrying: 0, failed: 0 };
  if (!opts.versionId) {
    const expired = await withService((tx) => tx`select app.expire_overdue_estimates() as id`);
    summary.expired = expired.length;
  }
  const jobs = await withService((tx) => tx<FollowUpRow[]>`
    select * from app.claim_follow_up_jobs(${opts.limit ?? 25}, ${workerId}, ${opts.versionId ?? null})`);
  summary.claimed = jobs.length;
  if (jobs.length === 0) return summary;

  let transport: EmailTransport;
  try {
    transport = opts.transport ?? getEmailTransport();
    requireSetting("ESTIMATE_LINK_SECRET", "Email delivery");
  } catch (err) {
    // Not configured: record a clear, non-retryable failure instead of pretending to send.
    const message = err instanceof Error ? err.message : "Email delivery is not configured";
    for (const job of jobs) {
      await withService((tx) => failOrRetry(tx, job, message, false, null));
      summary.failed++;
    }
    return summary;
  }

  for (const job of jobs) {
    try {
      const outcome = await processOne(job, transport, workerId);
      if (outcome !== "skipped") summary[outcome]++;
    } catch (err) {
      console.error("[follow-ups] job crashed", job.id, err);
      await withService((tx) => failOrRetry(tx, job, "Unexpected error while processing", true, null)).catch(() => {});
      summary.retrying++;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Tenant-facing controls & queries
// ---------------------------------------------------------------------------
export interface FollowUpView {
  id: string;
  kind: FollowUpKind;
  status: FollowUpStatus;
  scheduledFor: Date;
  nextAttemptAt: Date | null;
  attempts: number;
  sentAt: Date | null;
  lastError: string | null;
  cancelReason: string | null;
  deliveryStatus: string | null;
  estimateId: string;
  estimateNumber: number;
  customerName: string;
}

function mapFollowUp(r: Record<string, unknown>): FollowUpView {
  return {
    id: r.id as string, kind: r.kind as FollowUpKind, status: r.status as FollowUpStatus, scheduledFor: r.scheduled_for as Date,
    nextAttemptAt: (r.next_attempt_at as Date) ?? null, attempts: r.attempts as number, sentAt: (r.sent_at as Date) ?? null,
    lastError: (r.last_error as string) ?? null, cancelReason: (r.cancel_reason as string) ?? null,
    deliveryStatus: (r.delivery_status as string) ?? null, estimateId: r.estimate_id as string,
    estimateNumber: r.estimate_number as number, customerName: r.customer_name as string,
  };
}

export async function listFollowUps(ctx: TenantCtx, params: { versionId?: string; status?: string } = {}): Promise<FollowUpView[]> {
  const p = z.object({
    versionId: z.uuid().optional(),
    status: z.enum(["pending", "processing", "sent", "failed", "cancelled", "upcoming", "all"]).default("all"),
  }).parse(params);
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      select f.*, e.id as estimate_id, e.estimate_number, c.name as customer_name, ev.status as delivery_status
      from public.follow_up_jobs f
      join public.estimate_versions v on v.id = f.estimate_version_id
      join public.estimates e on e.id = v.estimate_id
      join public.customers c on c.id = e.customer_id
      left join public.email_events ev on ev.id = f.email_event_id
      where f.organization_id = ${ctx.organizationId}
        ${p.versionId ? tx`and f.estimate_version_id = ${p.versionId}` : tx``}
        ${p.status === "upcoming" ? tx`and f.status in ('pending', 'processing')` : p.status === "all" ? tx`` : tx`and f.status = ${p.status}`}
      order by case when f.status in ('pending', 'processing') then 0 else 1 end, f.scheduled_for ${p.status === "upcoming" ? tx`asc` : tx`desc`}
      limit 300`;
    return rows.map(mapFollowUp);
  });
}

export async function cancelPendingFollowUps(ctx: TenantCtx, versionId: string): Promise<number> {
  assertCan(ctx, "followup.manage");
  z.uuid().parse(versionId);
  return withUser(ctx, async (tx) => {
    const res = await tx`
      update public.follow_up_jobs set status = 'cancelled', cancelled_at = now(), cancel_reason = 'cancelled_by_user'
      where estimate_version_id = ${versionId} and organization_id = ${ctx.organizationId} and status = 'pending'
        and kind <> 'initial_delivery'`;
    const [v] = await tx`select estimate_id from public.estimate_versions where id = ${versionId}`;
    if (v) await audit(tx, ctx, "follow_up.cancelled", "estimate", v.estimate_id, { version_id: versionId, count: res.count });
    return res.count;
  });
}

export async function cancelFollowUp(ctx: TenantCtx, jobId: string): Promise<void> {
  assertCan(ctx, "followup.manage");
  z.uuid().parse(jobId);
  await withUser(ctx, async (tx) => {
    const res = await tx`update public.follow_up_jobs set status = 'cancelled', cancelled_at = now(), cancel_reason = 'cancelled_by_user'
                         where id = ${jobId} and organization_id = ${ctx.organizationId} and status = 'pending' returning estimate_version_id`;
    if (res.count === 0) throw conflict("Only scheduled follow-ups can be cancelled");
    await audit(tx, ctx, "follow_up.cancelled", "follow_up_job", jobId);
  });
}

export async function retryFollowUp(ctx: TenantCtx, jobId: string): Promise<void> {
  assertCan(ctx, "followup.manage");
  z.uuid().parse(jobId);
  await withUser(ctx, async (tx) => {
    const [j] = await tx`select f.status, f.attempts, v.status as version_status, v.expires_at from public.follow_up_jobs f
                         join public.estimate_versions v on v.id = f.estimate_version_id
                         where f.id = ${jobId} and f.organization_id = ${ctx.organizationId}`;
    if (!j) throw notFound("Follow-up");
    if (j.status !== "failed") throw conflict("Only failed follow-ups can be retried");
    if (j.version_status !== "sent" || new Date(j.expires_at) <= new Date()) throw conflict("This estimate is no longer awaiting a decision");
    await tx`update public.follow_up_jobs set status = 'pending', next_attempt_at = now(), max_attempts = ${Math.min(20, j.attempts + 3)}
             where id = ${jobId}`;
    await audit(tx, ctx, "follow_up.retried", "follow_up_job", jobId);
  });
}

/** Queue an immediate reminder. Throttled: at most one manual reminder per version per hour. */
export async function queueManualReminder(ctx: TenantCtx, versionId: string): Promise<string> {
  assertCan(ctx, "followup.manage");
  z.uuid().parse(versionId);
  return withUser(ctx, async (tx) => {
    const [v] = await tx`
      select v.status, v.expires_at, v.estimate_id, v.snapshot -> 'customer' ->> 'email' as email from public.estimate_versions v
      where v.id = ${versionId} and v.organization_id = ${ctx.organizationId}
      for update`; // serializes concurrent "send reminder" clicks for the throttle check below
    if (!v) throw notFound("Estimate");
    if (v.status !== "sent" || new Date(v.expires_at) <= new Date()) throw conflict("Reminders can only be sent for estimates awaiting a decision");
    if (!v.email) throw invalid("The customer had no email address when this estimate was sent");
    const [recent] = await tx`select 1 from public.follow_up_jobs where estimate_version_id = ${versionId} and kind = 'manual_reminder'
                              and created_at > now() - interval '1 hour' and status <> 'cancelled'`;
    if (recent) throw conflict("A reminder was already sent for this estimate in the last hour");
    const [row] = await tx`
      insert into public.follow_up_jobs (organization_id, estimate_version_id, kind, sequence, scheduled_for, idempotency_key, created_by)
      values (${ctx.organizationId}, ${versionId}, 'manual_reminder', 0, now(), ${`estimate-manual:${versionId}:${randomUUID()}`}, ${ctx.userId})
      returning id`;
    await audit(tx, ctx, "follow_up.manual_queued", "estimate", v.estimate_id, { version_id: versionId });
    return row.id as string;
  });
}
