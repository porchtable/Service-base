import "server-only";
import { can } from "@/lib/permissions";
import type { TenantCtx } from "@/server/auth/tenant-context";
import { listTechnicians } from "@/server/domain/members";
import { getOrganization } from "@/server/domain/organizations";
import { withUser } from "@/server/db/tenant";
import { mapCustomer, type Customer } from "@/server/domain/customers";

export async function loadJobFormOptions(ctx: TenantCtx, includeCustomerId?: string) {
  const [org, members, customers] = await Promise.all([
    getOrganization(ctx),
    listTechnicians(ctx),
    withUser(ctx, (tx) => tx`
      select * from public.customers where organization_id = ${ctx.organizationId}
        and (archived_at is null ${includeCustomerId ? tx`or id = ${includeCustomerId}` : tx``})
      order by lower(name) limit 2000`).then((rows) => rows.map(mapCustomer)),
  ]);
  return {
    org,
    customers: customers as Customer[],
    technicians: members.map((m) => ({ userId: m.userId, label: `${m.fullName ?? m.email} (${m.role})` })),
    canManage: can(ctx.role, "job.manage"),
  };
}
