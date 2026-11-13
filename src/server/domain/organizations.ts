import "server-only";
import { z } from "zod";
import type { Role } from "@/lib/permissions";
import { createOrganizationSchema, followUpSettingsSchema, organizationSettingsSchema } from "@/lib/schemas";
import { withUser, type DbIdentity } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { notFound } from "@/server/errors";

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: Role;
}

export interface Organization {
  id: string;
  name: string;
  industry: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  timezone: string;
  defaultTaxRateBps: number;
  estimateValidityDays: number;
  estimateTerms: string | null;
  followUpEnabled: boolean;
  followUpOffsetsDays: number[];
  createdAt: Date;
}

export async function listMemberships(identity: DbIdentity): Promise<Membership[]> {
  return withUser(identity, async (tx) => {
    const rows = await tx`
      select m.organization_id, o.name, m.role
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = ${identity.userId}
      order by o.name`;
    return rows.map((r) => ({ organizationId: r.organization_id, organizationName: r.name, role: r.role as Role }));
  });
}

/** Resolve a verified tenant context, or null if the user is not a member of the org. */
export async function loadTenantCtx(identity: DbIdentity, organizationId: string): Promise<TenantCtx | null> {
  if (!z.uuid().safeParse(organizationId).success) return null;
  const rows = await withUser(identity, (tx) => tx`
    select role from public.organization_members
    where organization_id = ${organizationId} and user_id = ${identity.userId}`);
  if (rows.length === 0) return null;
  return { userId: identity.userId, email: identity.email ?? null, organizationId, role: rows[0].role as Role };
}

export async function createOrganization(identity: DbIdentity, input: unknown): Promise<string> {
  const data = createOrganizationSchema.parse(input);
  return withUser(identity, async (tx) => {
    const [row] = await tx`select app.create_organization(${data.name}, ${data.industry}::public.industry) as id`;
    return row.id as string;
  });
}

function mapOrg(r: Record<string, unknown>): Organization {
  return {
    id: r.id as string,
    name: r.name as string,
    industry: r.industry as string,
    phone: r.phone as string | null,
    email: r.email as string | null,
    website: r.website as string | null,
    addressLine1: r.address_line1 as string | null,
    addressLine2: r.address_line2 as string | null,
    city: r.city as string | null,
    region: r.region as string | null,
    postalCode: r.postal_code as string | null,
    timezone: r.timezone as string,
    defaultTaxRateBps: r.default_tax_rate_bps as number,
    estimateValidityDays: r.estimate_validity_days as number,
    estimateTerms: r.estimate_terms as string | null,
    followUpEnabled: r.follow_up_enabled as boolean,
    followUpOffsetsDays: r.follow_up_offsets_days as number[],
    createdAt: r.created_at as Date,
  };
}

export async function getOrganization(ctx: TenantCtx): Promise<Organization> {
  const rows = await withUser(ctx, (tx) => tx`select * from public.organizations where id = ${ctx.organizationId}`);
  if (!rows[0]) throw notFound("Organization");
  return mapOrg(rows[0]);
}

export async function updateOrganizationSettings(ctx: TenantCtx, input: unknown): Promise<void> {
  assertCan(ctx, "org.settings");
  const d = organizationSettingsSchema.parse(input);
  await withUser(ctx, async (tx) => {
    const res = await tx`
      update public.organizations set
        name = ${d.name}, industry = ${d.industry}::public.industry, phone = ${d.phone ?? null},
        email = ${d.email ?? null}, website = ${d.website ?? null},
        address_line1 = ${d.addressLine1 ?? null}, address_line2 = ${d.addressLine2 ?? null},
        city = ${d.city ?? null}, region = ${d.region ?? null}, postal_code = ${d.postalCode ?? null},
        timezone = ${d.timezone}, default_tax_rate_bps = ${d.defaultTaxRatePercent},
        estimate_validity_days = ${d.estimateValidityDays}, estimate_terms = ${d.estimateTerms ?? null}
      where id = ${ctx.organizationId}`;
    if (res.count === 0) throw notFound("Organization");
    await audit(tx, ctx, "organization.settings_updated", "organization", ctx.organizationId);
  });
}

export async function updateFollowUpSettings(ctx: TenantCtx, input: unknown): Promise<void> {
  assertCan(ctx, "followup.manage");
  const d = followUpSettingsSchema.parse(input);
  await withUser(ctx, async (tx) => {
    await tx`
      update public.organizations
      set follow_up_enabled = ${d.followUpEnabled}, follow_up_offsets_days = ${d.followUpOffsetsDays}::int[]
      where id = ${ctx.organizationId}`;
    await audit(tx, ctx, "organization.follow_up_settings_updated", "organization", ctx.organizationId, {
      enabled: d.followUpEnabled,
      offsets: d.followUpOffsetsDays,
    });
  });
}
