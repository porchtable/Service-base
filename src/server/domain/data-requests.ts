import "server-only";
import { z } from "zod";
import { withUser } from "@/server/db/tenant";
import type { DbIdentity } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { conflict } from "@/server/errors";

/** Full JSON export of one organization's data, read under the caller's RLS. */
export async function exportOrganizationData(ctx: TenantCtx): Promise<Record<string, unknown>> {
  assertCan(ctx, "data.export");
  return withUser(ctx, async (tx) => {
    const org = ctx.organizationId;
    const [organization] = await tx`select * from public.organizations where id = ${org}`;
    const data = {
      exported_at: new Date().toISOString(),
      organization,
      members: await tx`select m.role, m.created_at, p.email, p.full_name from public.organization_members m join public.profiles p on p.id = m.user_id where m.organization_id = ${org}`,
      customers: await tx`select id, name, company_name, email, phone, address_line1, address_line2, city, region, postal_code, notes, archived_at, created_at, updated_at from public.customers where organization_id = ${org}`,
      jobs: await tx`select * from public.jobs where organization_id = ${org}`,
      job_attachments: await tx`select id, job_id, file_name, content_type, size_bytes, caption, created_at from public.job_attachments where organization_id = ${org}`,
      price_book_items: await tx`select * from public.price_book_items where organization_id = ${org}`,
      estimates: await tx`select * from public.estimates where organization_id = ${org}`,
      estimate_versions: await tx`select id, estimate_id, version_number, status, technician_notes, customer_summary, internal_notes, tax_rate_bps, subtotal_cents, tax_cents, total_cents, approved_at, sent_at, expires_at, decided_at, snapshot, created_at from public.estimate_versions where organization_id = ${org}`,
      estimate_line_items: await tx`select * from public.estimate_line_items where organization_id = ${org}`,
      estimate_decisions: await tx`select estimate_version_id, decision, signer_name, comment, created_at from public.estimate_decisions where organization_id = ${org}`,
      follow_ups: await tx`select id, estimate_version_id, kind, status, scheduled_for, sent_at, cancel_reason from public.follow_up_jobs where organization_id = ${org}`,
      audit_events: ctx.role === "owner" ? await tx`select created_at, action, actor_type, entity_type, entity_id from public.audit_events where organization_id = ${org} order by created_at` : [],
    };
    await audit(tx, ctx, "data.exported", "organization", org);
    return data;
  });
}

export async function requestAccountDeletion(identity: DbIdentity & { email: string | null }, reason?: string): Promise<void> {
  const r = z.string().trim().max(2000).optional().parse(reason);
  await withUser(identity, async (tx) => {
    const [existing] = await tx`select 1 from public.data_requests where user_id = ${identity.userId} and kind = 'account_deletion' and status = 'pending'`;
    if (existing) throw conflict("You already have a pending deletion request");
    await tx`insert into public.data_requests (user_id, requester_email, kind, reason) values (${identity.userId}, ${identity.email ?? ""}, 'account_deletion', ${r ?? null})`;
  });
}

export async function getPendingDeletion(identity: DbIdentity) {
  const [row] = await withUser(identity, (tx) => tx`
    select id, created_at from public.data_requests where user_id = ${identity.userId} and kind = 'account_deletion' and status = 'pending'`);
  return row ?? null;
}

export async function updateProfileName(identity: DbIdentity, fullName: string): Promise<void> {
  const n = z.string().trim().min(1, "Enter your name").max(120).parse(fullName);
  await withUser(identity, (tx) => tx`update public.profiles set full_name = ${n} where id = ${identity.userId}`);
}
