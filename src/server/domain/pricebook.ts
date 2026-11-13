import "server-only";
import { z } from "zod";
import { priceBookItemSchema } from "@/lib/schemas";
import { withUser } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { notFound } from "@/server/errors";

export interface PriceBookItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sku: string | null;
  unitPriceCents: number;
  unit: string;
  taxClass: "taxable" | "non_taxable";
  isActive: boolean;
  updatedAt: Date;
}

export function mapPriceBookItem(r: Record<string, unknown>): PriceBookItem {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    category: (r.category as string) ?? null,
    sku: (r.sku as string) ?? null,
    unitPriceCents: Number(r.unit_price_cents),
    unit: r.unit as string,
    taxClass: r.tax_class as PriceBookItem["taxClass"],
    isActive: r.is_active as boolean,
    updatedAt: r.updated_at as Date,
  };
}

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
});

export async function listPriceBook(ctx: TenantCtx, params: unknown = {}): Promise<PriceBookItem[]> {
  const p = listSchema.parse(params ?? {});
  const like = p.q ? `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      select * from public.price_book_items
      where organization_id = ${ctx.organizationId}
        ${p.status === "active" ? tx`and is_active` : p.status === "inactive" ? tx`and not is_active` : tx``}
        ${p.category ? tx`and category = ${p.category}` : tx``}
        ${like ? tx`and (name ilike ${like} or description ilike ${like} or sku ilike ${like} or category ilike ${like})` : tx``}
      order by category nulls last, lower(name)
      limit 1000`;
    return rows.map(mapPriceBookItem);
  });
}

export async function listPriceBookCategories(ctx: TenantCtx): Promise<string[]> {
  const rows = await withUser(ctx, (tx) => tx`
    select distinct category from public.price_book_items
    where organization_id = ${ctx.organizationId} and category is not null order by category`);
  return rows.map((r) => r.category as string);
}

export async function getPriceBookItem(ctx: TenantCtx, id: string): Promise<PriceBookItem> {
  if (!z.uuid().safeParse(id).success) throw notFound("Price book item");
  const rows = await withUser(ctx, (tx) => tx`
    select * from public.price_book_items where id = ${id} and organization_id = ${ctx.organizationId}`);
  if (!rows[0]) throw notFound("Price book item");
  return mapPriceBookItem(rows[0]);
}

export async function createPriceBookItem(ctx: TenantCtx, input: unknown): Promise<string> {
  assertCan(ctx, "pricebook.manage");
  const d = priceBookItemSchema.parse(input);
  return withUser(ctx, async (tx) => {
    const [row] = await tx`
      insert into public.price_book_items (organization_id, name, description, category, sku, unit_price_cents, unit, tax_class, is_active, created_by)
      values (${ctx.organizationId}, ${d.name}, ${d.description ?? null}, ${d.category ?? null}, ${d.sku ?? null},
              ${d.unitPrice}, ${d.unit}, ${d.taxClass}::public.tax_class, ${d.isActive}, ${ctx.userId})
      returning id`;
    await audit(tx, ctx, "price_book.item_created", "price_book_item", row.id, { name: d.name, unit_price_cents: d.unitPrice });
    return row.id as string;
  });
}

export async function updatePriceBookItem(ctx: TenantCtx, id: string, input: unknown): Promise<void> {
  assertCan(ctx, "pricebook.manage");
  z.uuid().parse(id);
  const d = priceBookItemSchema.parse(input);
  await withUser(ctx, async (tx) => {
    const [before] = await tx`select unit_price_cents from public.price_book_items where id = ${id} and organization_id = ${ctx.organizationId}`;
    if (!before) throw notFound("Price book item");
    await tx`
      update public.price_book_items set
        name = ${d.name}, description = ${d.description ?? null}, category = ${d.category ?? null}, sku = ${d.sku ?? null},
        unit_price_cents = ${d.unitPrice}, unit = ${d.unit}, tax_class = ${d.taxClass}::public.tax_class, is_active = ${d.isActive}
      where id = ${id} and organization_id = ${ctx.organizationId}`;
    await audit(tx, ctx, "price_book.item_updated", "price_book_item", id, {
      previous_unit_price_cents: Number(before.unit_price_cents),
      unit_price_cents: d.unitPrice,
    });
  });
}

export async function setPriceBookItemActive(ctx: TenantCtx, id: string, active: boolean): Promise<void> {
  assertCan(ctx, "pricebook.manage");
  z.uuid().parse(id);
  await withUser(ctx, async (tx) => {
    const res = await tx`update public.price_book_items set is_active = ${active} where id = ${id} and organization_id = ${ctx.organizationId}`;
    if (res.count === 0) throw notFound("Price book item");
    await audit(tx, ctx, active ? "price_book.item_activated" : "price_book.item_deactivated", "price_book_item", id);
  });
}
