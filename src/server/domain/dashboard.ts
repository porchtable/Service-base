import "server-only";
import { withUser } from "@/server/db/tenant";
import type { TenantCtx } from "@/server/auth/tenant-context";

export interface DashboardData {
  totalCustomers: number;
  teamMembers: number;
}

/** Real database counts only (extended as jobs/estimates/follow-ups are added). */
export async function getDashboard(ctx: TenantCtx, _params: unknown): Promise<DashboardData> {
  return withUser(ctx, async (tx) => {
    const [row] = await tx`
      select
        (select count(*) from public.customers where organization_id = ${ctx.organizationId} and archived_at is null) as customers,
        (select count(*) from public.organization_members where organization_id = ${ctx.organizationId}) as members`;
    return { totalCustomers: Number(row.customers), teamMembers: Number(row.members) };
  });
}
