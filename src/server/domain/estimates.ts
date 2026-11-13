import "server-only";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { computeTotals, parseMoneyToCents, parseQuantity, formatQuantity } from "@/lib/money";
import { joinAddress, type EstimateSnapshot } from "@/lib/estimate-snapshot";
import { optText, reqText } from "@/lib/schemas";
import { withUser } from "@/server/db/tenant";
import type { Tx } from "@/server/db/client";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { generateToken } from "@/server/tokens";
import { env } from "@/server/env";
import { scheduleAfterSend } from "@/server/domain/followup-hooks";
import { requireEntitlement } from "@/server/billing/entitlements";

export type EstimateStatus = "draft" | "approved" | "sent" | "accepted" | "declined" | "expired" | "superseded";
export const ESTIMATE_STATUSES: EstimateStatus[] = ["draft", "approved", "sent", "accepted", "declined", "expired", "superseded"];

export interface EstimateListItem {
  id: string;
  estimateNumber: number;
  title: string;
  status: EstimateStatus;
  customerId: string;
  customerName: string;
  jobId: string;
  jobNumber: number;
  versionNumber: number;
  totalCents: number;
  sentAt: Date | null;
  expiresAt: Date | null;
  updatedAt: Date;
}

export interface EstimateLine {
  id: string;
  position: number;
  priceBookItemId: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  taxClass: "taxable" | "non_taxable";
  source: "ai" | "manual" | "price_book";
  needsReview: boolean;
  reviewReason: string | null;
}

export interface EstimateVersionDetail {
  id: string;
  versionNumber: number;
  status: EstimateStatus;
  technicianNotes: string | null;
  customerSummary: string | null;
  internalNotes: string | null;
  taxRateBps: number;
  subtotalCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  totalCents: number;
  aiStatus: "none" | "pending" | "succeeded" | "failed";
  aiModel: string | null;
  aiError: string | null;
  aiWarnings: string[];
  aiCompletedAt: Date | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  sentAt: Date | null;
  sentByName: string | null;
  expiresAt: Date | null;
  decidedAt: Date | null;
  snapshot: EstimateSnapshot | null;
  createdAt: Date;
  lines: EstimateLine[];
  decision: { decision: "accepted" | "declined"; signerName: string | null; comment: string | null; createdAt: Date } | null;
  links: Array<{ id: string; purpose: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null; lastUsedAt: Date | null }>;
}

export interface EstimateDetail {
  id: string;
  estimateNumber: number;
  title: string;
  status: EstimateStatus;
  currentVersionId: string;
  customer: { id: string; name: string; email: string | null };
  job: { id: string; number: number; title: string };
  versions: Array<{ id: string; versionNumber: number; status: EstimateStatus; totalCents: number; sentAt: Date | null; createdAt: Date }>;
  version: EstimateVersionDetail;
}

function mapLine(r: Record<string, unknown>): EstimateLine {
  const qty = parseQuantity(String(r.quantity));
  return {
    id: r.id as string,
    position: r.position as number,
    priceBookItemId: (r.price_book_item_id as string) ?? null,
    description: r.description as string,
    quantity: qty ? formatQuantity(qty) : String(r.quantity),
    unit: r.unit as string,
    unitPriceCents: r.unit_price_cents === null ? null : Number(r.unit_price_cents),
    lineTotalCents: r.line_total_cents === null ? null : Number(r.line_total_cents),
    taxClass: r.tax_class as EstimateLine["taxClass"],
    source: r.source as EstimateLine["source"],
    needsReview: r.needs_review as boolean,
    reviewReason: (r.review_reason as string) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
const listSchema = z.object({
  status: z.enum(["draft", "approved", "sent", "accepted", "declined", "expired", "superseded", "all", "open"]).default("all"),
  q: z.string().trim().max(100).optional(),
  customerId: z.uuid().optional(),
  jobId: z.uuid().optional(),
});

export async function listEstimates(ctx: TenantCtx, params: unknown = {}): Promise<EstimateListItem[]> {
  const p = listSchema.parse(params ?? {});
  const like = p.q ? `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      select e.id, e.estimate_number, e.title, e.status, e.customer_id, c.name as customer_name, e.job_id, j.job_number,
             v.version_number, v.total_cents, v.sent_at, v.expires_at, e.updated_at
      from public.estimates e
      join public.customers c on c.id = e.customer_id
      join public.jobs j on j.id = e.job_id
      join public.estimate_versions v on v.id = e.current_version_id
      where e.organization_id = ${ctx.organizationId}
        ${p.status === "all" ? tx`` : p.status === "open" ? tx`and e.status in ('draft', 'approved', 'sent')` : tx`and e.status = ${p.status}::public.estimate_status`}
        ${p.customerId ? tx`and e.customer_id = ${p.customerId}` : tx``}
        ${p.jobId ? tx`and e.job_id = ${p.jobId}` : tx``}
        ${like ? tx`and (e.title ilike ${like} or c.name ilike ${like} or e.estimate_number::text = ${p.q!})` : tx``}
      order by e.updated_at desc
      limit 500`;
    return rows.map((r) => ({
      id: r.id, estimateNumber: r.estimate_number, title: r.title, status: r.status, customerId: r.customer_id,
      customerName: r.customer_name, jobId: r.job_id, jobNumber: r.job_number, versionNumber: r.version_number,
      totalCents: Number(r.total_cents), sentAt: r.sent_at, expiresAt: r.expires_at, updatedAt: r.updated_at,
    }));
  });
}

export async function getEstimate(ctx: TenantCtx, estimateId: string, versionId?: string): Promise<EstimateDetail> {
  if (!z.uuid().safeParse(estimateId).success || (versionId && !z.uuid().safeParse(versionId).success)) throw notFound("Estimate");
  const managers = can(ctx.role, "estimate.send");
  return withUser(ctx, async (tx) => {
    const [e] = await tx`
      select e.*, c.name as customer_name, c.email as customer_email, j.job_number, j.title as job_title
      from public.estimates e
      join public.customers c on c.id = e.customer_id
      join public.jobs j on j.id = e.job_id
      where e.id = ${estimateId} and e.organization_id = ${ctx.organizationId}`;
    if (!e) throw notFound("Estimate");
    const versions = await tx`
      select id, version_number, status, total_cents, sent_at, created_at from public.estimate_versions
      where estimate_id = ${estimateId} order by version_number desc`;
    const selectedId = versionId ?? e.current_version_id;
    const [v] = await tx`
      select v.*, coalesce(pa.full_name, pa.email) as approved_by_name, coalesce(ps.full_name, ps.email) as sent_by_name
      from public.estimate_versions v
      left join public.profiles pa on pa.id = v.approved_by
      left join public.profiles ps on ps.id = v.sent_by
      where v.id = ${selectedId} and v.estimate_id = ${estimateId}`;
    if (!v) throw notFound("Estimate version");
    const lines = await tx`select * from public.estimate_line_items where estimate_version_id = ${v.id} order by position, created_at`;
    const [d] = await tx`select decision, signer_name, comment, created_at from public.estimate_decisions where estimate_version_id = ${v.id}`;
    const links = managers
      ? await tx`select id, purpose, created_at, expires_at, revoked_at, last_used_at from public.estimate_access_tokens
                 where estimate_version_id = ${v.id} order by created_at desc`
      : [];
    return {
      id: e.id, estimateNumber: e.estimate_number, title: e.title, status: e.status, currentVersionId: e.current_version_id,
      customer: { id: e.customer_id, name: e.customer_name, email: e.customer_email },
      job: { id: e.job_id, number: e.job_number, title: e.job_title },
      versions: versions.map((x) => ({ id: x.id, versionNumber: x.version_number, status: x.status, totalCents: Number(x.total_cents), sentAt: x.sent_at, createdAt: x.created_at })),
      version: {
        id: v.id, versionNumber: v.version_number, status: v.status, technicianNotes: v.technician_notes,
        customerSummary: v.customer_summary, internalNotes: v.internal_notes, taxRateBps: v.tax_rate_bps,
        subtotalCents: Number(v.subtotal_cents), taxableSubtotalCents: Number(v.taxable_subtotal_cents),
        taxCents: Number(v.tax_cents), totalCents: Number(v.total_cents),
        aiStatus: v.ai_status, aiModel: v.ai_model, aiError: v.ai_error, aiWarnings: (v.ai_warnings as string[]) ?? [],
        aiCompletedAt: v.ai_completed_at, approvedAt: v.approved_at, approvedByName: v.approved_by_name,
        sentAt: v.sent_at, sentByName: v.sent_by_name, expiresAt: v.expires_at, decidedAt: v.decided_at,
        snapshot: v.snapshot as EstimateSnapshot | null, createdAt: v.created_at,
        lines: lines.map(mapLine),
        decision: d ? { decision: d.decision, signerName: d.signer_name, comment: d.comment, createdAt: d.created_at } : null,
        links: links.map((l) => ({ id: l.id, purpose: l.purpose, createdAt: l.created_at, expiresAt: l.expires_at, revokedAt: l.revoked_at, lastUsedAt: l.last_used_at })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------
async function loadDraftVersion(tx: Tx, ctx: TenantCtx, versionId: string) {
  if (!z.uuid().safeParse(versionId).success) throw notFound("Estimate");
  const [v] = await tx`
    select v.*, e.title as estimate_title from public.estimate_versions v join public.estimates e on e.id = v.estimate_id
    where v.id = ${versionId} and v.organization_id = ${ctx.organizationId} for update of v`;
  if (!v) throw notFound("Estimate");
  if (v.status !== "draft") throw conflict("This estimate version is no longer a draft. Create a revision to make changes.");
  return v;
}

export async function createEstimate(ctx: TenantCtx, input: unknown): Promise<{ estimateId: string; versionId: string }> {
  assertCan(ctx, "estimate.draft");
  const d = z.object({ jobId: z.uuid("Choose a job"), title: optText(160) }).parse(input);
  return withUser(ctx, async (tx) => {
    const [job] = await tx`
      select j.id, j.customer_id, j.title, j.technician_observations, o.default_tax_rate_bps
      from public.jobs j join public.organizations o on o.id = j.organization_id
      where j.id = ${d.jobId} and j.organization_id = ${ctx.organizationId}`;
    if (!job) throw notFound("Job");
    const [est] = await tx`
      insert into public.estimates (organization_id, job_id, customer_id, title, created_by, estimate_number)
      values (${ctx.organizationId}, ${job.id}, ${job.customer_id}, ${d.title ?? job.title}, ${ctx.userId}, 0)
      returning id, estimate_number`;
    const [ver] = await tx`
      insert into public.estimate_versions (organization_id, estimate_id, version_number, tax_rate_bps, technician_notes, created_by)
      values (${ctx.organizationId}, ${est.id}, 0, ${job.default_tax_rate_bps}, ${job.technician_observations}, ${ctx.userId})
      returning id`;
    await audit(tx, ctx, "estimate.created", "estimate", est.id, { estimate_number: est.estimate_number, job_id: job.id });
    await audit(tx, ctx, "customer.estimate_created", "customer", job.customer_id, { estimate_id: est.id, estimate_number: est.estimate_number });
    return { estimateId: est.id as string, versionId: ver.id as string };
  });
}

const draftDetailsSchema = z.object({
  title: reqText(160, "Title"),
  customerSummary: optText(5000),
  internalNotes: optText(5000),
  technicianNotes: optText(20000),
  taxRatePercent: z
    .string()
    .trim()
    .optional()
    .transform((v, c) => {
      if (v === undefined || v === "") return undefined;
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) {
        c.addIssue({ code: "custom", message: "Enter a percentage like 8.25" });
        return z.NEVER;
      }
      const [w, f = ""] = v.split(".");
      const bps = Number(w) * 100 + Number(f.padEnd(2, "0"));
      if (bps > 10000) {
        c.addIssue({ code: "custom", message: "At most 100%" });
        return z.NEVER;
      }
      return bps;
    }),
});

export async function saveDraftDetails(ctx: TenantCtx, versionId: string, input: unknown): Promise<void> {
  assertCan(ctx, "estimate.draft");
  const d = draftDetailsSchema.parse(input);
  await withUser(ctx, async (tx) => {
    const v = await loadDraftVersion(tx, ctx, versionId);
    const taxBps = d.taxRatePercent !== undefined && can(ctx.role, "estimate.approve") ? d.taxRatePercent : v.tax_rate_bps;
    await tx`
      update public.estimate_versions set customer_summary = ${d.customerSummary ?? null}, internal_notes = ${d.internalNotes ?? null},
        technician_notes = ${d.technicianNotes ?? null}, tax_rate_bps = ${taxBps}
      where id = ${versionId}`;
    await tx`update public.estimates set title = ${d.title} where id = ${v.estimate_id}`;
    await audit(tx, ctx, "estimate.draft_saved", "estimate", v.estimate_id, { version_id: versionId });
  });
}

/** Persist technician notes in their own committed transaction (used before AI runs). */
export async function saveTechnicianNotes(ctx: TenantCtx, versionId: string, notes: string): Promise<void> {
  assertCan(ctx, "estimate.draft");
  const n = z.string().trim().min(1, "Enter what the technician found").max(20000).parse(notes);
  await withUser(ctx, async (tx) => {
    await loadDraftVersion(tx, ctx, versionId);
    await tx`update public.estimate_versions set technician_notes = ${n} where id = ${versionId}`;
  });
}

async function nextPosition(tx: Tx, versionId: string): Promise<number> {
  const [r] = await tx`select coalesce(max(position), 0) + 1 as p from public.estimate_line_items where estimate_version_id = ${versionId}`;
  return Number(r.p);
}

const quantitySchema = z
  .union([z.string(), z.number()])
  .transform((v, c) => {
    const q = parseQuantity(String(v).trim() || "1");
    if (q === null) {
      c.addIssue({ code: "custom", message: "Enter a quantity greater than 0 (up to 3 decimals)" });
      return z.NEVER;
    }
    return formatQuantity(q);
  });

export async function addLineFromPriceBook(ctx: TenantCtx, versionId: string, input: unknown): Promise<void> {
  assertCan(ctx, "estimate.draft");
  const d = z.object({ priceBookItemId: z.uuid("Choose a price book item"), quantity: quantitySchema }).parse(input);
  await withUser(ctx, async (tx) => {
    const v = await loadDraftVersion(tx, ctx, versionId);
    const [item] = await tx`
      select * from public.price_book_items where id = ${d.priceBookItemId} and organization_id = ${ctx.organizationId} and is_active`;
    if (!item) throw invalid("That price book item is not available", { priceBookItemId: ["Choose an active item"] });
    await tx`
      insert into public.estimate_line_items (organization_id, estimate_version_id, position, price_book_item_id, description,
        quantity, unit, unit_price_cents, tax_class, source)
      values (${ctx.organizationId}, ${versionId}, ${await nextPosition(tx, versionId)}, ${item.id},
        ${item.description ? `${item.name} — ${item.description}`.slice(0, 2000) : item.name},
        ${d.quantity}, ${item.unit}, ${item.unit_price_cents}, ${item.tax_class}, 'price_book')`;
    await audit(tx, ctx, "estimate.line_added", "estimate", v.estimate_id, { version_id: versionId, price_book_item_id: item.id });
  });
}

export async function addManualLine(ctx: TenantCtx, versionId: string, input: unknown): Promise<void> {
  assertCan(ctx, "estimate.draft");
  const d = z.object({
    description: reqText(2000, "Description"),
    quantity: quantitySchema,
    unit: reqText(30, "Unit"),
    taxClass: z.enum(["taxable", "non_taxable"]),
    unitPrice: optText(20),
  }).parse(input);
  const manager = can(ctx.role, "estimate.approve");
  let price: number | null = null;
  if (d.unitPrice) {
    if (!manager) throw forbidden("Only owners and admins can set custom prices. Use a price book item instead.");
    price = parseMoneyToCents(d.unitPrice);
    if (price === null) throw invalid("Enter a price like 129.00", { unitPrice: ["Enter a price like 129.00"] });
  }
  await withUser(ctx, async (tx) => {
    const v = await loadDraftVersion(tx, ctx, versionId);
    await tx`
      insert into public.estimate_line_items (organization_id, estimate_version_id, position, description, quantity, unit,
        unit_price_cents, tax_class, source, needs_review, review_reason)
      values (${ctx.organizationId}, ${versionId}, ${await nextPosition(tx, versionId)}, ${d.description}, ${d.quantity}, ${d.unit},
        ${price}, ${d.taxClass}, 'manual', ${price === null},
        ${price === null ? "No approved price — choose a price book item or have an admin set the price" : null})`;
    await audit(tx, ctx, "estimate.line_added", "estimate", v.estimate_id, { version_id: versionId, manual: true, custom_price: price !== null });
  });
}

export async function updateLine(ctx: TenantCtx, lineId: string, input: unknown): Promise<void> {
  assertCan(ctx, "estimate.draft");
  z.uuid().parse(lineId);
  const d = z.object({
    description: reqText(2000, "Description"),
    quantity: quantitySchema,
    priceBookItemId: z.string().trim().optional().transform((v) => (v ? v : undefined)).pipe(z.uuid().optional()),
    unitPrice: optText(20),
    markReviewed: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).optional(),
  }).parse(input);
  const manager = can(ctx.role, "estimate.approve");
  await withUser(ctx, async (tx) => {
    const [line] = await tx`select * from public.estimate_line_items where id = ${lineId} and organization_id = ${ctx.organizationId}`;
    if (!line) throw notFound("Line item");
    const v = await loadDraftVersion(tx, ctx, line.estimate_version_id);
    let priceBookItemId: string | null = line.price_book_item_id;
    let unitPrice: number | null = line.unit_price_cents === null ? null : Number(line.unit_price_cents);
    let unit: string = line.unit;
    let taxClass: string = line.tax_class;
    let needsReview: boolean = line.needs_review;
    let reviewReason: string | null = line.review_reason;

    if (d.priceBookItemId && d.priceBookItemId !== line.price_book_item_id) {
      const [item] = await tx`select * from public.price_book_items where id = ${d.priceBookItemId}
                              and organization_id = ${ctx.organizationId} and is_active`;
      if (!item) throw invalid("That price book item is not available");
      priceBookItemId = item.id;
      unitPrice = Number(item.unit_price_cents);
      unit = item.unit;
      taxClass = item.tax_class;
      needsReview = false; // price now comes from an approved company record
      reviewReason = null;
    }
    if (d.unitPrice !== undefined) {
      if (!manager) throw forbidden("Only owners and admins can set custom prices");
      const cents = parseMoneyToCents(d.unitPrice);
      if (cents === null) throw invalid("Enter a price like 129.00", { unitPrice: ["Enter a price like 129.00"] });
      if (cents !== unitPrice) {
        unitPrice = cents;
        priceBookItemId = null; // custom price is no longer the price-book price
      }
    }
    if (d.markReviewed) {
      if (!manager) throw forbidden("Only owners and admins can mark lines as reviewed");
      if (unitPrice === null) throw invalid("Set a price before marking this line as reviewed");
      needsReview = false;
      reviewReason = null;
    }
    await tx`
      update public.estimate_line_items set description = ${d.description}, quantity = ${d.quantity}, price_book_item_id = ${priceBookItemId},
        unit_price_cents = ${unitPrice}, unit = ${unit}, tax_class = ${taxClass}::public.tax_class,
        needs_review = ${needsReview}, review_reason = ${reviewReason}
      where id = ${lineId}`;
    await audit(tx, ctx, "estimate.line_updated", "estimate", v.estimate_id, { version_id: v.id, line_id: lineId });
  });
}

export async function deleteLine(ctx: TenantCtx, lineId: string): Promise<void> {
  assertCan(ctx, "estimate.draft");
  z.uuid().parse(lineId);
  await withUser(ctx, async (tx) => {
    const [line] = await tx`select estimate_version_id from public.estimate_line_items where id = ${lineId} and organization_id = ${ctx.organizationId}`;
    if (!line) throw notFound("Line item");
    const v = await loadDraftVersion(tx, ctx, line.estimate_version_id);
    await tx`delete from public.estimate_line_items where id = ${lineId}`;
    await audit(tx, ctx, "estimate.line_removed", "estimate", v.estimate_id, { version_id: v.id });
  });
}

// ---------------------------------------------------------------------------
// Approval, sending, links, revisions
// ---------------------------------------------------------------------------
export async function approveVersion(ctx: TenantCtx, versionId: string): Promise<void> {
  assertCan(ctx, "estimate.approve");
  await withUser(ctx, async (tx) => {
    const v = await loadDraftVersion(tx, ctx, versionId);
    // Server-side recalculation check: DB totals must equal an independent computation.
    const lines = await tx`select quantity, unit_price_cents, tax_class, needs_review from public.estimate_line_items where estimate_version_id = ${versionId}`;
    if (lines.length === 0) throw invalid("Add at least one line item before approving");
    const unresolved = lines.filter((l) => l.unit_price_cents === null || l.needs_review).length;
    if (unresolved > 0) throw invalid(`Resolve ${unresolved} line item${unresolved === 1 ? "" : "s"} with missing prices or review flags before approving`);
    const totals = computeTotals(
      lines.map((l) => ({ quantity: String(l.quantity), unitPriceCents: Number(l.unit_price_cents), taxClass: l.tax_class })),
      v.tax_rate_bps,
    );
    if (totals.totalCents !== Number(v.total_cents) || totals.taxCents !== Number(v.tax_cents)) {
      throw new Error(`totals mismatch for version ${versionId}`);
    }
    await tx`update public.estimate_versions set status = 'approved' where id = ${versionId}`;
    await audit(tx, ctx, "estimate.approved", "estimate", v.estimate_id, { version_id: versionId, total_cents: totals.totalCents });
  });
}

export async function reopenVersion(ctx: TenantCtx, versionId: string): Promise<void> {
  assertCan(ctx, "estimate.approve");
  z.uuid().parse(versionId);
  await withUser(ctx, async (tx) => {
    const [v] = await tx`select estimate_id, status from public.estimate_versions where id = ${versionId} and organization_id = ${ctx.organizationId} for update`;
    if (!v) throw notFound("Estimate");
    if (v.status !== "approved") throw conflict("Only approved, unsent estimates can be reopened");
    await tx`update public.estimate_versions set status = 'draft' where id = ${versionId}`;
    await audit(tx, ctx, "estimate.reopened", "estimate", v.estimate_id, { version_id: versionId });
  });
}

function customerLink(token: string) {
  return `${env().NEXT_PUBLIC_SITE_URL}/e/${token}`;
}

async function buildSnapshot(tx: Tx, versionId: string, expiresAt: Date): Promise<EstimateSnapshot> {
  const [r] = await tx`
    select v.*, e.estimate_number, e.title, o.name as org_name, o.phone as org_phone, o.email as org_email, o.website as org_website,
      o.address_line1 as o1, o.address_line2 as o2, o.city as oc, o.region as orr, o.postal_code as op, o.timezone, o.estimate_terms,
      c.name as c_name, c.company_name as c_company, c.email as c_email, c.address_line1 as c1, c.address_line2 as c2, c.city as cc,
      c.region as cr, c.postal_code as cp, j.job_number, j.title as job_title, j.service_address_line1 as s1, j.service_address_line2 as s2,
      j.service_city as sc, j.service_region as sr, j.service_postal_code as sp
    from public.estimate_versions v
    join public.estimates e on e.id = v.estimate_id
    join public.organizations o on o.id = v.organization_id
    join public.customers c on c.id = e.customer_id
    join public.jobs j on j.id = e.job_id
    where v.id = ${versionId}`;
  const lines = await tx`select * from public.estimate_line_items where estimate_version_id = ${versionId} order by position, created_at`;
  return {
    schema: 1,
    organization: {
      name: r.org_name, phone: r.org_phone, email: r.org_email, website: r.org_website,
      address: joinAddress([r.o1, r.o2, r.oc, r.orr, r.op]), timezone: r.timezone,
    },
    customer: { name: r.c_name, companyName: r.c_company, email: r.c_email, address: joinAddress([r.c1, r.c2, r.cc, r.cr, r.cp]) },
    job: { number: r.job_number, title: r.job_title, serviceAddress: joinAddress([r.s1, r.s2, r.sc, r.sr, r.sp]) },
    estimate: {
      number: r.estimate_number, version: r.version_number, title: r.title, summary: r.customer_summary,
      issuedAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(),
    },
    lines: lines.map((l) => {
      const m = mapLine(l);
      return {
        description: m.description, quantity: m.quantity, unit: m.unit, unit_price_cents: m.unitPriceCents!,
        line_total_cents: m.lineTotalCents!, tax_class: m.taxClass,
      };
    }),
    totals: {
      subtotal_cents: Number(r.subtotal_cents), taxable_subtotal_cents: Number(r.taxable_subtotal_cents),
      tax_rate_bps: r.tax_rate_bps, tax_cents: Number(r.tax_cents), total_cents: Number(r.total_cents),
    },
    terms: r.estimate_terms ?? null,
  };
}

async function insertToken(tx: Tx, ctx: { organizationId: string; userId: string | null }, versionId: string, expiresAt: Date, purpose: "link" | "email" | "reminder") {
  const { token, hash } = generateToken();
  await tx`
    insert into public.estimate_access_tokens (organization_id, estimate_version_id, token_hash, purpose, expires_at, created_by)
    values (${ctx.organizationId}, ${versionId}, ${hash}, ${purpose}, ${expiresAt}, ${ctx.userId})`;
  return token;
}

export interface SendResult {
  link: string;
  emailQueued: boolean;
  expiresAt: Date;
}

/** Freeze the approved version, create a customer link, and queue delivery + follow-ups. */
export async function sendVersion(ctx: TenantCtx, versionId: string, opts: { email: boolean }): Promise<SendResult> {
  assertCan(ctx, "estimate.send");
  if (!z.uuid().safeParse(versionId).success) throw notFound("Estimate");
  await requireEntitlement(ctx.organizationId, "Sending estimates");
  return withUser(ctx, async (tx) => {
    const [v] = await tx`
      select v.*, o.estimate_validity_days, c.email as customer_email
      from public.estimate_versions v
      join public.estimates e on e.id = v.estimate_id
      join public.organizations o on o.id = v.organization_id
      join public.customers c on c.id = e.customer_id
      where v.id = ${versionId} and v.organization_id = ${ctx.organizationId}
      for update of v`;
    if (!v) throw notFound("Estimate");
    if (v.status !== "approved") throw conflict(v.status === "draft" ? "Approve the estimate before sending it" : "This version has already been sent");
    if (opts.email && !v.customer_email) throw invalid("This customer has no email address. Add one, or send without email and share the link.");
    const expiresAt = new Date(Date.now() + Number(v.estimate_validity_days) * 86_400_000);
    const snapshot = await buildSnapshot(tx, versionId, expiresAt);
    await tx`update public.estimate_versions set status = 'sent', snapshot = ${tx.json(snapshot as never)}, expires_at = ${expiresAt}
             where id = ${versionId}`;
    const token = await insertToken(tx, ctx, versionId, expiresAt, "link");
    const emailQueued = await scheduleAfterSend(tx, { organizationId: ctx.organizationId, userId: ctx.userId, versionId, sendEmail: opts.email && Boolean(v.customer_email) });
    await audit(tx, ctx, "estimate.sent", "estimate", v.estimate_id, {
      version_id: versionId, total_cents: Number(v.total_cents), email: emailQueued, expires_at: expiresAt.toISOString(),
    });
    return { link: customerLink(token), emailQueued, expiresAt };
  });
}

export async function createShareLink(ctx: TenantCtx, versionId: string): Promise<string> {
  assertCan(ctx, "estimate.send");
  z.uuid().parse(versionId);
  return withUser(ctx, async (tx) => {
    const [v] = await tx`select estimate_id, status, expires_at from public.estimate_versions where id = ${versionId} and organization_id = ${ctx.organizationId}`;
    if (!v) throw notFound("Estimate");
    if (v.status !== "sent" || new Date(v.expires_at) <= new Date()) throw conflict("Links can only be created for sent, unexpired estimates");
    const token = await insertToken(tx, ctx, versionId, new Date(v.expires_at), "link");
    await audit(tx, ctx, "estimate.link_created", "estimate", v.estimate_id, { version_id: versionId });
    return customerLink(token);
  });
}

export async function revokeLinks(ctx: TenantCtx, versionId: string): Promise<number> {
  assertCan(ctx, "estimate.revoke");
  z.uuid().parse(versionId);
  return withUser(ctx, async (tx) => {
    const [v] = await tx`select estimate_id from public.estimate_versions where id = ${versionId} and organization_id = ${ctx.organizationId}`;
    if (!v) throw notFound("Estimate");
    const res = await tx`update public.estimate_access_tokens set revoked_at = now()
                         where estimate_version_id = ${versionId} and revoked_at is null`;
    await audit(tx, ctx, "estimate.links_revoked", "estimate", v.estimate_id, { version_id: versionId, count: res.count });
    return res.count;
  });
}

/** Start a new draft version from the current one. A sent version is superseded and its links revoked. */
export async function createRevision(ctx: TenantCtx, estimateId: string): Promise<string> {
  assertCan(ctx, "estimate.draft");
  z.uuid().parse(estimateId);
  return withUser(ctx, async (tx) => {
    const [e] = await tx`select id, current_version_id from public.estimates where id = ${estimateId} and organization_id = ${ctx.organizationId} for update`;
    if (!e) throw notFound("Estimate");
    const [cur] = await tx`select * from public.estimate_versions where id = ${e.current_version_id}`;
    if (cur.status === "draft" || cur.status === "approved") throw conflict("This estimate already has an editable version");
    if (cur.status === "accepted") throw conflict("Accepted estimates cannot be revised. Create a new estimate for additional work.");
    if (cur.status === "sent") {
      assertCan(ctx, "estimate.send");
      await tx`update public.estimate_versions set status = 'superseded' where id = ${cur.id}`;
      await tx`update public.estimate_access_tokens set revoked_at = now() where estimate_version_id = ${cur.id} and revoked_at is null`;
    }
    const [nv] = await tx`
      insert into public.estimate_versions (organization_id, estimate_id, version_number, tax_rate_bps, technician_notes,
        customer_summary, internal_notes, created_by)
      values (${ctx.organizationId}, ${estimateId}, 0, ${cur.tax_rate_bps}, ${cur.technician_notes}, ${cur.customer_summary},
        ${cur.internal_notes}, ${ctx.userId})
      returning id`;
    await tx`
      insert into public.estimate_line_items (organization_id, estimate_version_id, position, price_book_item_id, description,
        quantity, unit, unit_price_cents, tax_class, source, needs_review, review_reason)
      select organization_id, ${nv.id}, position, price_book_item_id, description, quantity, unit, unit_price_cents, tax_class,
        source, needs_review, review_reason
      from public.estimate_line_items where estimate_version_id = ${cur.id}`;
    await audit(tx, ctx, "estimate.revision_created", "estimate", estimateId, { from_version_id: cur.id, version_id: nv.id, previous_status: cur.status });
    return nv.id as string;
  });
}

export async function deleteDraftEstimate(ctx: TenantCtx, estimateId: string): Promise<void> {
  assertCan(ctx, "estimate.approve");
  z.uuid().parse(estimateId);
  await withUser(ctx, async (tx) => {
    const [sent] = await tx`select count(*) filter (where status <> 'draft') as n from public.estimate_versions where estimate_id = ${estimateId}`;
    if (Number(sent?.n ?? 0) > 0) throw conflict("Only estimates that were never approved or sent can be deleted");
    await audit(tx, ctx, "estimate.deleted", "estimate", estimateId);
    const res = await tx`delete from public.estimates where id = ${estimateId} and organization_id = ${ctx.organizationId}`;
    if (res.count === 0) throw notFound("Estimate");
  });
}
