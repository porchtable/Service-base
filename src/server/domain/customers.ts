import "server-only";
import { z } from "zod";
import { customerSchema } from "@/lib/schemas";
import { withUser } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { notFound } from "@/server/errors";

export interface Customer {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string,
    name: r.name as string,
    companyName: (r.company_name as string) ?? null,
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    addressLine1: (r.address_line1 as string) ?? null,
    addressLine2: (r.address_line2 as string) ?? null,
    city: (r.city as string) ?? null,
    region: (r.region as string) ?? null,
    postalCode: (r.postal_code as string) ?? null,
    notes: (r.notes as string) ?? null,
    archivedAt: (r.archived_at as Date) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

export const CUSTOMER_PAGE_SIZE = 25;

export async function listCustomers(ctx: TenantCtx, params: unknown): Promise<{ customers: Customer[]; total: number; page: number }> {
  const p = listSchema.parse(params ?? {});
  const offset = (p.page - 1) * CUSTOMER_PAGE_SIZE;
  // Prefix full-text search over name/company/email/phone/address, plus substring fallback.
  const tsQuery = p.q
    ? p.q.split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}@._-]/gu, "")).filter(Boolean).map((t) => `${t}:*`).join(" & ")
    : "";
  const like = p.q ? `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  return withUser(ctx, async (tx) => {
    const where = tx`
      organization_id = ${ctx.organizationId}
      ${p.status === "active" ? tx`and archived_at is null` : p.status === "archived" ? tx`and archived_at is not null` : tx``}
      ${p.q ? tx`and (${tsQuery ? tx`search @@ to_tsquery('simple', ${tsQuery}) or` : tx``} name ilike ${like} or company_name ilike ${like} or email ilike ${like} or phone ilike ${like})` : tx``}`;
    const rows = await tx`
      select *, count(*) over () as total_count from public.customers
      where ${where}
      order by lower(name), id
      limit ${CUSTOMER_PAGE_SIZE} offset ${offset}`;
    return { customers: rows.map(mapCustomer), total: rows[0] ? Number(rows[0].total_count) : 0, page: p.page };
  });
}

export async function getCustomer(ctx: TenantCtx, id: string): Promise<Customer> {
  if (!z.uuid().safeParse(id).success) throw notFound("Customer");
  const rows = await withUser(ctx, (tx) => tx`
    select * from public.customers where id = ${id} and organization_id = ${ctx.organizationId}`);
  if (!rows[0]) throw notFound("Customer");
  return mapCustomer(rows[0]);
}

export async function createCustomer(ctx: TenantCtx, input: unknown): Promise<string> {
  assertCan(ctx, "customer.create");
  const d = customerSchema.parse(input);
  return withUser(ctx, async (tx) => {
    const [row] = await tx`
      insert into public.customers (organization_id, name, company_name, email, phone, address_line1, address_line2,
                                    city, region, postal_code, notes, created_by)
      values (${ctx.organizationId}, ${d.name}, ${d.companyName ?? null}, ${d.email ?? null}, ${d.phone ?? null},
              ${d.addressLine1 ?? null}, ${d.addressLine2 ?? null}, ${d.city ?? null}, ${d.region ?? null},
              ${d.postalCode ?? null}, ${d.notes ?? null}, ${ctx.userId})
      returning id`;
    await audit(tx, ctx, "customer.created", "customer", row.id);
    return row.id as string;
  });
}

export async function updateCustomer(ctx: TenantCtx, id: string, input: unknown): Promise<void> {
  assertCan(ctx, "customer.update");
  z.uuid().parse(id);
  const d = customerSchema.parse(input);
  await withUser(ctx, async (tx) => {
    const res = await tx`
      update public.customers set
        name = ${d.name}, company_name = ${d.companyName ?? null}, email = ${d.email ?? null}, phone = ${d.phone ?? null},
        address_line1 = ${d.addressLine1 ?? null}, address_line2 = ${d.addressLine2 ?? null}, city = ${d.city ?? null},
        region = ${d.region ?? null}, postal_code = ${d.postalCode ?? null}, notes = ${d.notes ?? null}
      where id = ${id} and organization_id = ${ctx.organizationId}`;
    if (res.count === 0) throw notFound("Customer");
    await audit(tx, ctx, "customer.updated", "customer", id);
  });
}

export async function setCustomerArchived(ctx: TenantCtx, id: string, archived: boolean): Promise<void> {
  assertCan(ctx, "customer.archive");
  z.uuid().parse(id);
  await withUser(ctx, async (tx) => {
    const res = await tx`
      update public.customers
      set archived_at = ${archived ? tx`now()` : null}, archived_by = ${archived ? ctx.userId : null}
      where id = ${id} and organization_id = ${ctx.organizationId}`;
    if (res.count === 0) throw notFound("Customer");
    await audit(tx, ctx, archived ? "customer.archived" : "customer.restored", "customer", id);
  });
}

export interface CustomerHistoryEntry {
  at: Date;
  kind: "audit";
  action: string;
  actorName: string | null;
}

/** Activity for a customer drawn from the audit log (jobs & estimates are listed separately). */
export async function getCustomerActivity(ctx: TenantCtx, id: string): Promise<CustomerHistoryEntry[]> {
  z.uuid().parse(id);
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      select a.created_at, a.action, p.full_name, p.email
      from public.audit_events a
      left join public.profiles p on p.id = a.actor_user_id
      where a.organization_id = ${ctx.organizationId} and a.entity_type = 'customer' and a.entity_id = ${id}
      order by a.created_at desc limit 50`;
    return rows.map((r) => ({ at: r.created_at, kind: "audit" as const, action: r.action, actorName: r.full_name ?? r.email ?? null }));
  });
}
