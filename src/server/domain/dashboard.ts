import "server-only";
import { z } from "zod";
import { withUser } from "@/server/db/tenant";
import type { TenantCtx } from "@/server/auth/tenant-context";

export const DASHBOARD_PERIODS = { all: null, "30d": 30, "90d": 90, "365d": 365 } as const;
export type DashboardPeriod = keyof typeof DASHBOARD_PERIODS;

export interface DashboardData {
  period: DashboardPeriod;
  technician: string | null;
  totalCustomers: number;
  activeJobs: number;
  draftEstimates: number;
  approvedEstimates: number;
  sentEstimates: number;
  pendingDecisions: number;
  acceptedEstimates: number;
  declinedEstimates: number;
  expiredEstimates: number;
  /** Sum of the current version total for every estimate that has been sent. */
  totalQuotedCents: number;
  /** Sum of accepted estimate totals. Customer approvals — NOT collected revenue. */
  totalAcceptedCents: number;
  followUpsDue: number;
  followUpsFailed: number;
  teamMembers: number;
}

const paramsSchema = z.object({
  period: z.enum(["all", "30d", "90d", "365d"]).catch("all").default("all"),
  technician: z.uuid().optional().catch(undefined),
});

/**
 * All metrics come straight from the database (under RLS). Estimate metrics use
 * each estimate's current version and are filtered by estimate creation date and,
 * optionally, by the technician assigned to the estimate's job.
 */
export async function getDashboard(ctx: TenantCtx, params: unknown): Promise<DashboardData> {
  const p = paramsSchema.parse(params ?? {});
  const days = DASHBOARD_PERIODS[p.period];
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  return withUser(ctx, async (tx) => {
    const [r] = await tx`
      with est as (
        select e.status, v.total_cents
        from public.estimates e
        join public.estimate_versions v on v.id = e.current_version_id
        join public.jobs j on j.id = e.job_id
        where e.organization_id = ${ctx.organizationId}
          ${since ? tx`and e.created_at >= ${since}` : tx``}
          ${p.technician ? tx`and j.assigned_technician_id = ${p.technician}` : tx``}
      )
      select
        (select count(*) from public.customers where organization_id = ${ctx.organizationId} and archived_at is null) as customers,
        (select count(*) from public.jobs where organization_id = ${ctx.organizationId} and status not in ('completed', 'cancelled')
          ${p.technician ? tx`and assigned_technician_id = ${p.technician}` : tx``}) as active_jobs,
        (select count(*) from est where status = 'draft') as drafts,
        (select count(*) from est where status = 'approved') as approved,
        (select count(*) from est where status in ('sent', 'accepted', 'declined', 'expired')) as sent,
        (select count(*) from est where status = 'sent') as pending,
        (select count(*) from est where status = 'accepted') as accepted,
        (select count(*) from est where status = 'declined') as declined,
        (select count(*) from est where status = 'expired') as expired,
        (select coalesce(sum(total_cents), 0) from est where status in ('sent', 'accepted', 'declined', 'expired')) as quoted,
        (select coalesce(sum(total_cents), 0) from est where status = 'accepted') as accepted_value,
        (select count(*) from public.follow_up_jobs where organization_id = ${ctx.organizationId} and status = 'pending'
           and coalesce(next_attempt_at, scheduled_for) <= now() + interval '24 hours') as followups_due,
        (select count(*) from public.follow_up_jobs where organization_id = ${ctx.organizationId} and status = 'failed') as followups_failed,
        (select count(*) from public.organization_members where organization_id = ${ctx.organizationId}) as members`;
    return {
      period: p.period,
      technician: p.technician ?? null,
      totalCustomers: Number(r.customers),
      activeJobs: Number(r.active_jobs),
      draftEstimates: Number(r.drafts),
      approvedEstimates: Number(r.approved),
      sentEstimates: Number(r.sent),
      pendingDecisions: Number(r.pending),
      acceptedEstimates: Number(r.accepted),
      declinedEstimates: Number(r.declined),
      expiredEstimates: Number(r.expired),
      totalQuotedCents: Number(r.quoted),
      totalAcceptedCents: Number(r.accepted_value),
      followUpsDue: Number(r.followups_due),
      followUpsFailed: Number(r.followups_failed),
      teamMembers: Number(r.members),
    };
  });
}
