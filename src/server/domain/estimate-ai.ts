import "server-only";
import { z } from "zod";
import { withUser } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { AppError, conflict, notFound } from "@/server/errors";
import { ConfigurationError } from "@/server/env";
import { buildDraftFromProposal } from "@/server/ai/draft-builder";
import { AiGenerationError, type CatalogItem, type EstimateAiProvider } from "@/server/ai/proposal";
import { saveTechnicianNotes } from "@/server/domain/estimates";
import { requireEntitlement } from "@/server/billing/entitlements";
import { CONFIG_KEYS, getConfigBool } from "@/server/platform-config";

export interface AiDraftOutcome {
  linesAdded: number;
  flagged: number;
  warnings: string[];
}

async function defaultProvider(): Promise<EstimateAiProvider> {
  const { AnthropicEstimateProvider } = await import("@/server/ai/anthropic-provider");
  return new AnthropicEstimateProvider();
}

async function markFailed(ctx: TenantCtx, versionId: string, message: string) {
  await withUser(ctx, (tx) => tx`
    update public.estimate_versions set ai_status = 'failed', ai_error = ${message.slice(0, 1000)}, ai_completed_at = now()
    where id = ${versionId} and organization_id = ${ctx.organizationId} and status = 'draft'`);
}

/**
 * 1. Saves the technician's notes (own transaction — they survive any AI failure).
 * 2. Asks the AI for a structured proposal (no prices are sent to or accepted from it).
 * 3. Converts the proposal into draft lines priced ONLY from the active price book.
 * 4. Appends the lines to the draft; existing lines are kept.
 */
export async function generateDraftWithAi(
  ctx: TenantCtx,
  versionId: string,
  notes: string,
  providerOverride?: EstimateAiProvider,
): Promise<AiDraftOutcome> {
  assertCan(ctx, "estimate.draft");
  if (!z.uuid().safeParse(versionId).success) throw notFound("Estimate");
  await saveTechnicianNotes(ctx, versionId, notes); // always persisted first
  if (!(await getConfigBool(CONFIG_KEYS.aiDrafting, true))) {
    throw new AppError("configuration", "AI drafting is temporarily disabled. Your notes were saved — add lines manually.");
  }
  await requireEntitlement(ctx.organizationId, "AI drafting");

  const context = await withUser(ctx, async (tx) => {
    const [row] = await tx`
      update public.estimate_versions v set ai_status = 'pending', ai_requested_at = now(), ai_error = null
      from public.estimates e, public.jobs j, public.organizations o
      where v.id = ${versionId} and v.organization_id = ${ctx.organizationId} and v.status = 'draft'
        and e.id = v.estimate_id and j.id = e.job_id and o.id = v.organization_id
      returning v.technician_notes, j.title, j.description, j.technician_observations, o.industry,
        concat_ws(' ', j.equipment_type, j.equipment_make, j.equipment_model,
          case when j.equipment_age_years is not null then '(' || j.equipment_age_years || ' years old)' end,
          j.equipment_notes) as equipment`;
    if (!row) throw conflict("This estimate is not an editable draft");
    const items = await tx`
      select id, name, description, category, unit, unit_price_cents, tax_class from public.price_book_items
      where organization_id = ${ctx.organizationId} and is_active order by category nulls last, name`;
    const catalog: CatalogItem[] = items.map((i) => ({
      id: i.id, name: i.name, description: i.description, category: i.category, unit: i.unit,
      unitPriceCents: Number(i.unit_price_cents), taxClass: i.tax_class,
    }));
    return { row, catalog };
  });

  let provider: EstimateAiProvider;
  let raw: unknown;
  try {
    provider = providerOverride ?? (await defaultProvider());
    raw = await provider.propose({
      trade: context.row.industry,
      job: {
        title: context.row.title,
        description: context.row.description,
        equipment: context.row.equipment || null,
        observations: context.row.technician_observations,
      },
      technicianNotes: context.row.technician_notes,
      catalog: context.catalog.map(({ id, name, description, category, unit }) => ({ id, name, description, category, unit })),
    });
  } catch (err) {
    const message =
      err instanceof ConfigurationError ? "AI drafting is not configured for this workspace. Add lines manually."
      : err instanceof AiGenerationError ? err.message
      : "AI drafting failed. Your notes were saved — try again or add lines manually.";
    if (!(err instanceof ConfigurationError) && !(err instanceof AiGenerationError)) console.error("[ai] generation failed", err);
    await markFailed(ctx, versionId, message);
    throw new AppError(err instanceof ConfigurationError ? "configuration" : "validation", message);
  }

  let draft;
  try {
    draft = buildDraftFromProposal(raw, context.catalog);
  } catch {
    const message = "The AI response could not be used. Your notes were saved — try again or add lines manually.";
    await markFailed(ctx, versionId, message);
    throw new AppError("validation", message);
  }

  return withUser(ctx, async (tx) => {
    const [v] = await tx`select estimate_id, status, customer_summary from public.estimate_versions
                         where id = ${versionId} and organization_id = ${ctx.organizationId} for update`;
    if (!v || v.status !== "draft") throw conflict("This estimate changed while the AI was working. Your notes were saved.");
    const [pos] = await tx`select coalesce(max(position), 0) as p from public.estimate_line_items where estimate_version_id = ${versionId}`;
    let position = Number(pos.p);
    for (const l of draft.lines) {
      position += 1;
      await tx`
        insert into public.estimate_line_items (organization_id, estimate_version_id, position, price_book_item_id, description,
          quantity, unit, unit_price_cents, tax_class, source, needs_review, review_reason)
        values (${ctx.organizationId}, ${versionId}, ${position}, ${l.priceBookItemId}, ${l.description}, ${l.quantity}, ${l.unit},
          ${l.unitPriceCents}, ${l.taxClass}, 'ai', ${l.needsReview}, ${l.reviewReason})`;
    }
    await tx`
      update public.estimate_versions set ai_status = 'succeeded', ai_model = ${provider.model}, ai_completed_at = now(),
        ai_warnings = ${tx.json(draft.warnings)}, ai_raw = ${tx.json(raw as never)},
        customer_summary = coalesce(nullif(customer_summary, ''), ${draft.summary})
      where id = ${versionId}`;
    const flagged = draft.lines.filter((l) => l.needsReview).length;
    await audit(tx, ctx, "estimate.ai_draft_generated", "estimate", v.estimate_id, {
      version_id: versionId, lines: draft.lines.length, flagged, model: provider.model,
    });
    return { linesAdded: draft.lines.length, flagged, warnings: draft.warnings };
  });
}
