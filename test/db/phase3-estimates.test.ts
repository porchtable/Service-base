import { afterAll, describe, expect, it } from "vitest";
import { adminSql, asUser, expectPgError } from "../support/db";
import { addMember, createCompany } from "../support/fixtures";
import { db } from "@/server/db/client";
import { computeTotals } from "@/lib/money";
import { createCustomer } from "@/server/domain/customers";
import { createJob } from "@/server/domain/jobs";
import { createPriceBookItem } from "@/server/domain/pricebook";
import { updateOrganizationSettings } from "@/server/domain/organizations";
import {
  addLineFromPriceBook, addManualLine, approveVersion, createEstimate, createRevision, createShareLink, getEstimate,
  reopenVersion, revokeLinks, saveDraftDetails, sendVersion, updateLine, deleteLine,
} from "@/server/domain/estimates";
import { generateDraftWithAi } from "@/server/domain/estimate-ai";
import { loadCustomerEstimate, recordCustomerDecision } from "@/server/domain/customer-estimates";
import { AiGenerationError, type EstimateAiProvider, type AiProposal } from "@/server/ai/proposal";
import type { TenantCtx } from "@/server/auth/tenant-context";

afterAll(async () => {
  await db().end();
  await adminSql.end();
});

class FakeAi implements EstimateAiProvider {
  readonly model = "fake-model";
  calls = 0;
  constructor(private impl: () => unknown) {}
  async propose(): Promise<AiProposal> {
    this.calls++;
    return this.impl() as AiProposal;
  }
}

async function setup(name = "Estimate Co", taxPercent = "8.25") {
  const company = await createCompany(name);
  await updateOrganizationSettings(company.ctx, {
    name, industry: "hvac", timezone: "America/New_York", estimateValidityDays: "30", defaultTaxRatePercent: taxPercent,
  });
  const customerId = await createCustomer(company.ctx, { name: "Morgan Price", email: "morgan@example.test" });
  const jobId = await createJob(company.ctx, { customerId, title: "AC not cooling", status: "new", technicianObservations: "Capacitor bulged" });
  const capacitor = await createPriceBookItem(company.ctx, { name: "Run capacitor replacement", unitPrice: "189.50", unit: "each", taxClass: "taxable", isActive: "on" });
  const labor = await createPriceBookItem(company.ctx, { name: "Diagnostic labor", unitPrice: "125", unit: "hour", taxClass: "non_taxable", isActive: "on" });
  const inactive = await createPriceBookItem(company.ctx, { name: "Discontinued part", unitPrice: "1", unit: "each", taxClass: "taxable" });
  const { estimateId, versionId } = await createEstimate(company.ctx, { jobId });
  return { ...company, customerId, jobId, capacitor, labor, inactive, estimateId, versionId };
}

async function sentEstimate(s: Awaited<ReturnType<typeof setup>>) {
  await addLineFromPriceBook(s.ctx, s.versionId, { priceBookItemId: s.capacitor, quantity: "1" });
  await approveVersion(s.ctx, s.versionId);
  const sent = await sendVersion(s.ctx, s.versionId, { email: false });
  return { ...sent, token: sent.link.split("/e/")[1] };
}

describe("estimate totals", () => {
  it("computes line, tax and grand totals in the database from integer cents", async () => {
    const s = await setup("Totals Co", "8.25");
    await addLineFromPriceBook(s.ctx, s.versionId, { priceBookItemId: s.capacitor, quantity: "2" });
    await addLineFromPriceBook(s.ctx, s.versionId, { priceBookItemId: s.labor, quantity: "1.5" });
    await addManualLine(s.ctx, s.versionId, { description: "Condensate pump", quantity: "1", unit: "each", taxClass: "taxable", unitPrice: "64.99" });
    const e = await getEstimate(s.ctx, s.estimateId);
    const expected = computeTotals(e.version.lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxClass: l.taxClass })), 825);
    expect(e.version.lines.map((l) => l.lineTotalCents)).toEqual([37900, 18750, 6499]);
    expect(e.version.subtotalCents).toBe(37900 + 18750 + 6499);
    expect(e.version.taxableSubtotalCents).toBe(37900 + 6499);
    expect(e.version.taxCents).toBe(3663); // 44399 × 8.25% = 3662.9175 → 3663
    expect(e.version.taxCents).toBe(expected.taxCents);
    expect(e.version.totalCents).toBe(expected.totalCents);
    // Changing the tax rate on the draft re-derives totals.
    await saveDraftDetails(s.ctx, s.versionId, { title: "AC repair", taxRatePercent: "0" });
    const e2 = await getEstimate(s.ctx, s.estimateId);
    expect(e2.version.taxCents).toBe(0);
    expect(e2.version.totalCents).toBe(e2.version.subtotalCents);
  });
});

describe("AI estimate generation", () => {
  it("cannot insert unauthorized pricing", async () => {
    const s = await setup("AI Price Co");
    const ai = new FakeAi(() => ({
      summary: "The technician observed a bulging run capacitor.",
      line_items: [
        { description: "Replace run capacitor", quantity: 1, price_book_item_id: s.capacitor, confidence: "high", reason: null, unit_price_cents: 1, price: 99999 },
        { description: "Replace evaporator coil", quantity: 1, price_book_item_id: null, confidence: "medium", reason: "No coil in catalog", unit_price_cents: 250000 },
        { description: "Discontinued part", quantity: 1, price_book_item_id: s.inactive, confidence: "high", reason: null },
        { description: "Other company's item", quantity: 1, price_book_item_id: "00000000-0000-4000-8000-000000000000", confidence: "high", reason: null },
      ],
      warnings: ["Verify coil size"],
    }));
    const out = await generateDraftWithAi(s.ctx, s.versionId, "Capacitor bulging; coil iced.", ai);
    expect(out.linesAdded).toBe(4);
    expect(out.flagged).toBe(3);
    const e = await getEstimate(s.ctx, s.estimateId);
    const [cap, coil, disc, foreign] = e.version.lines;
    expect(cap).toMatchObject({ unitPriceCents: 18950, priceBookItemId: s.capacitor, needsReview: false, source: "ai" });
    for (const l of [coil, disc, foreign]) {
      expect(l.unitPriceCents).toBeNull();
      expect(l.priceBookItemId).toBeNull();
      expect(l.needsReview).toBe(true);
    }
    expect(e.version.aiStatus).toBe("succeeded");
    expect(e.version.customerSummary).toBe("The technician observed a bulging run capacitor.");
    // Every priced line's price equals its price book price.
    const rows = await adminSql`
      select l.unit_price_cents, p.unit_price_cents as book from public.estimate_line_items l
      left join public.price_book_items p on p.id = l.price_book_item_id
      where l.estimate_version_id = ${s.versionId} and l.unit_price_cents is not null`;
    for (const r of rows) expect(r.unit_price_cents).toBe(r.book);
  });

  it("does not lose technician notes or existing lines when the AI fails", async () => {
    const s = await setup("AI Fail Co");
    await addLineFromPriceBook(s.ctx, s.versionId, { priceBookItemId: s.labor, quantity: "1" });
    const failing = new FakeAi(() => { throw new AiGenerationError("The AI service is busy. Try again in a minute.", true); });
    await expect(generateDraftWithAi(s.ctx, s.versionId, "Long detailed notes about the failed blower motor.", failing))
      .rejects.toMatchObject({ message: "The AI service is busy. Try again in a minute." });
    const e = await getEstimate(s.ctx, s.estimateId);
    expect(e.version.technicianNotes).toBe("Long detailed notes about the failed blower motor.");
    expect(e.version.aiStatus).toBe("failed");
    expect(e.version.aiError).toMatch(/busy/);
    expect(e.version.lines).toHaveLength(1);

    const garbage = new FakeAi(() => ({ totally: "wrong" }));
    await expect(generateDraftWithAi(s.ctx, s.versionId, "Second attempt notes", garbage)).rejects.toThrow(/could not be used/);
    expect((await getEstimate(s.ctx, s.estimateId)).version.technicianNotes).toBe("Second attempt notes");

    const crash = new FakeAi(() => { throw new TypeError("socket hang up"); });
    await expect(generateDraftWithAi(s.ctx, s.versionId, "Third attempt", crash)).rejects.toThrow(/notes were saved/);
    expect((await getEstimate(s.ctx, s.estimateId)).version.technicianNotes).toBe("Third attempt");
  });
});

describe("approval and sending", () => {
  it("blocks approval and delivery while prices are missing or lines are flagged", async () => {
    const s = await setup("Missing Price Co");
    await addLineFromPriceBook(s.ctx, s.versionId, { priceBookItemId: s.capacitor, quantity: "1" });
    await addManualLine(s.ctx, s.versionId, { description: "Mystery part", quantity: "1", unit: "each", taxClass: "taxable" });
    await expect(approveVersion(s.ctx, s.versionId)).rejects.toThrow(/missing prices or review flags/);
    await expect(sendVersion(s.ctx, s.versionId, { email: false })).rejects.toThrow(/Approve the estimate/);
    // The database enforces it even if the app is bypassed.
    await expectPgError(asUser(s.owner.userId, (tx) => tx`update public.estimate_versions set status = 'approved' where id = ${s.versionId}`), "P0001");
    await expectPgError(adminSql`update public.estimate_versions set status = 'sent' where id = ${s.versionId}`, "P0001");
    // Resolve: admin sets a price and marks reviewed → approval succeeds.
    const line = (await getEstimate(s.ctx, s.estimateId)).version.lines.find((l) => l.unitPriceCents === null)!;
    await updateLine(s.ctx, line.id, { description: "Mystery part", quantity: "1", unitPrice: "45.00", markReviewed: "on" });
    await approveVersion(s.ctx, s.versionId);
    expect((await getEstimate(s.ctx, s.estimateId)).status).toBe("approved");
  });

  it("only owners/admins can approve and send; technicians cannot set custom prices", async () => {
    const s = await setup("Auth Co");
    const tech = await addMember(s.orgId, "technician");
    await addLineFromPriceBook(tech, s.versionId, { priceBookItemId: s.capacitor, quantity: "1" });
    await expect(addManualLine(tech, s.versionId, { description: "x", quantity: "1", unit: "each", taxClass: "taxable", unitPrice: "1" })).rejects.toMatchObject({ code: "forbidden" });
    await expectPgError(asUser(tech.userId, (tx) => tx`
      insert into public.estimate_line_items (organization_id, estimate_version_id, description, quantity, unit_price_cents, source)
      values (${s.orgId}, ${s.versionId}, 'sneaky', 1, 1, 'manual')`), "42501");
    await expect(approveVersion(tech, s.versionId)).rejects.toMatchObject({ code: "forbidden" });
    await expectPgError(asUser(tech.userId, (tx) => tx`update public.estimate_versions set status = 'approved' where id = ${s.versionId}`), "42501");
    await approveVersion(s.ctx, s.versionId);
    await expect(sendVersion(tech, s.versionId, { email: false })).rejects.toMatchObject({ code: "forbidden" });
    await expectPgError(asUser(tech.userId, (tx) => tx`update public.estimate_versions set status = 'sent', snapshot = '{}'::jsonb, expires_at = now() + interval '1 day' where id = ${s.versionId}`), "42501");
    const admin = await addMember(s.orgId, "admin");
    const res = await sendVersion(admin, s.versionId, { email: false });
    expect(res.link).toMatch(/\/e\/[A-Za-z0-9_-]{43}$/);
  });

  it("makes sent versions immutable — even for privileged database roles", async () => {
    const s = await setup("Immutable Co");
    await sentEstimate(s);
    const e = await getEstimate(s.ctx, s.estimateId);
    const line = e.version.lines[0];
    expect(e.version.snapshot?.totals.total_cents).toBe(e.version.totalCents);
    await expect(updateLine(s.ctx, line.id, { description: "changed", quantity: "5" })).rejects.toMatchObject({ code: "conflict" });
    await expect(deleteLine(s.ctx, line.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(saveDraftDetails(s.ctx, s.versionId, { title: "x" })).rejects.toMatchObject({ code: "conflict" });
    await expect(reopenVersion(s.ctx, s.versionId)).rejects.toMatchObject({ code: "conflict" });
    for (const q of [
      adminSql`update public.estimate_line_items set unit_price_cents = 1 where id = ${line.id}`,
      adminSql`delete from public.estimate_line_items where id = ${line.id}`,
      adminSql`insert into public.estimate_line_items (organization_id, estimate_version_id, description, quantity, source) values (${s.orgId}, ${s.versionId}, 'x', 1, 'manual')`,
      adminSql`update public.estimate_versions set total_cents = 1 where id = ${s.versionId}`,
      adminSql`update public.estimate_versions set snapshot = '{}'::jsonb where id = ${s.versionId}`,
      adminSql`update public.estimate_versions set customer_summary = 'edited' where id = ${s.versionId}`,
      adminSql`delete from public.estimate_versions where id = ${s.versionId}`,
    ]) {
      await expectPgError(q, "42501");
    }
    // A revision creates a new version and supersedes the sent one; the old one stays intact.
    const v2 = await createRevision(s.ctx, s.estimateId);
    const after = await getEstimate(s.ctx, s.estimateId);
    expect(after.currentVersionId).toBe(v2);
    expect(after.versions.map((v) => [v.versionNumber, v.status])).toEqual([[2, "draft"], [1, "superseded"]]);
    const old = await getEstimate(s.ctx, s.estimateId, s.versionId);
    expect(old.version.lines).toHaveLength(1);
    expect(old.version.totalCents).toBe(e.version.totalCents);
    await expectPgError(adminSql`update public.estimate_versions set status = 'sent' where id = ${s.versionId}`, "42501");
  });
});

describe("customer links and decisions", () => {
  it("applies the decision to the correct version", async () => {
    const s = await setup("Decision Co");
    const first = await sentEstimate(s);
    const v2 = await createRevision(s.ctx, s.estimateId);
    await updateLine(s.ctx, (await getEstimate(s.ctx, s.estimateId)).version.lines[0].id, { description: "Run capacitor", quantity: "2" });
    await approveVersion(s.ctx, v2);
    const second = await sendVersion(s.ctx, v2, { email: false });
    const token2 = second.link.split("/e/")[1];

    // The superseded version's link no longer works.
    expect(await loadCustomerEstimate(first.token)).toEqual({ kind: "unavailable" });
    expect(await recordCustomerDecision(first.token, { decision: "accepted", signerName: "Morgan", agree: "on" }, { ip: null, userAgent: null }))
      .toEqual({ kind: "not_available", reason: "unavailable" });

    const view = await loadCustomerEstimate(token2);
    expect(view.kind === "ok" && view.snapshot.estimate.version).toBe(2);
    const out = await recordCustomerDecision(token2, { decision: "accepted", signerName: "Morgan Price", agree: "on" }, { ip: "203.0.113.5", userAgent: "test" });
    expect(out).toEqual({ kind: "recorded", decision: "accepted" });

    const decisions = await adminSql`select estimate_version_id, decision from public.estimate_decisions where organization_id = ${s.orgId}`;
    expect(decisions).toEqual([{ estimate_version_id: v2, decision: "accepted" }]);
    const est = await getEstimate(s.ctx, s.estimateId);
    expect(est.status).toBe("accepted");
    expect(est.versions.map((v) => v.status)).toEqual(["accepted", "superseded"]);
    // Contractors cannot fake or alter decisions.
    await expectPgError(asUser(s.owner.userId, (tx) => tx`insert into public.estimate_decisions (organization_id, estimate_version_id, decision, signer_name) values (${s.orgId}, ${s.versionId}, 'accepted', 'x')`), "42501");
    await expectPgError(adminSql`update public.estimate_decisions set decision = 'declined' where estimate_version_id = ${v2}`, "42501");
  });

  it("prevents duplicate decisions under concurrent and repeated requests", async () => {
    const s = await setup("Dup Co");
    const { token } = await sentEstimate(s);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => recordCustomerDecision(token,
        i % 2 ? { decision: "declined", comment: "too expensive" } : { decision: "accepted", signerName: "Morgan", agree: "on" },
        { ip: null, userAgent: null })),
    );
    expect(results.filter((r) => r.kind === "recorded")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "already_decided")).toHaveLength(5);
    const rows = await adminSql`select count(*)::int as n from public.estimate_decisions where estimate_version_id = ${s.versionId}`;
    expect(rows[0].n).toBe(1);
    const again = await recordCustomerDecision(token, { decision: "declined" }, { ip: null, userAgent: null });
    expect(again.kind).toBe("already_decided");
  });

  it("requires a signer name and confirmation to accept", async () => {
    const s = await setup("Sign Co");
    const { token } = await sentEstimate(s);
    await expect(recordCustomerDecision(token, { decision: "accepted", signerName: " ", agree: "on" }, { ip: null, userAgent: null })).rejects.toThrow();
    await expect(recordCustomerDecision(token, { decision: "accepted", signerName: "M" }, { ip: null, userAgent: null })).rejects.toThrow();
  });

  it("fails securely for revoked, expired, malformed and unknown links", async () => {
    const s = await setup("Link Co");
    const { token } = await sentEstimate(s);
    expect((await loadCustomerEstimate(token)).kind).toBe("ok");

    // Revoked
    await revokeLinks(s.ctx, s.versionId);
    expect(await loadCustomerEstimate(token)).toEqual({ kind: "unavailable" });
    expect((await recordCustomerDecision(token, { decision: "declined" }, { ip: null, userAgent: null })).kind).toBe("not_available");

    // New link works; then the token itself expires.
    const fresh = (await createShareLink(s.ctx, s.versionId)).split("/e/")[1];
    expect((await loadCustomerEstimate(fresh)).kind).toBe("ok");
    await adminSql`update public.estimate_access_tokens set expires_at = now() - interval '1 second' where estimate_version_id = ${s.versionId} and revoked_at is null`;
    expect(await loadCustomerEstimate(fresh)).toEqual({ kind: "unavailable" });

    // The estimate itself expires (simulate time passing; triggers bypassed only for the clock change).
    const fresh2 = (await adminSql.begin(async (tx) => {
      await tx`update public.estimate_access_tokens set expires_at = now() + interval '1 day' where estimate_version_id = ${s.versionId}`;
      return "ok";
    })) && fresh;
    await adminSql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update public.estimate_versions set expires_at = now() - interval '1 minute' where id = ${s.versionId}`;
    });
    const view = await loadCustomerEstimate(fresh2);
    expect(view.kind === "ok" && view.status).toBe("expired");
    expect(view.kind === "ok" && view.canDecide).toBe(false);
    expect(await recordCustomerDecision(fresh2, { decision: "accepted", signerName: "M", agree: "on" }, { ip: null, userAgent: null }))
      .toEqual({ kind: "not_available", reason: "expired" });
    await expectPgError(adminSql`insert into public.estimate_decisions (organization_id, estimate_version_id, decision, signer_name) values (${s.orgId}, ${s.versionId}, 'accepted', 'x')`, "P0001");
    const expired = await adminSql`select app.expire_overdue_estimates() as id`;
    expect(expired.map((r) => r.id)).toContain(s.versionId);
    expect((await getEstimate(s.ctx, s.estimateId)).status).toBe("expired");

    // Malformed / unknown tokens
    for (const t of ["", "short", "x".repeat(43), "../../etc/passwd", fresh.slice(0, -1) + (fresh.endsWith("A") ? "B" : "A")]) {
      expect(await loadCustomerEstimate(t)).toEqual({ kind: "unavailable" });
    }
  });

  it("keeps estimates isolated between companies", async () => {
    const a = await setup("Iso A");
    const b = await setup("Iso B");
    await expect(getEstimate(a.ctx, b.estimateId)).rejects.toMatchObject({ code: "not_found" });
    await expect(addLineFromPriceBook(a.ctx, b.versionId, { priceBookItemId: a.capacitor, quantity: "1" })).rejects.toMatchObject({ code: "not_found" });
    // Using another company's price book item on your own estimate fails at the FK level.
    await expect(addLineFromPriceBook(a.ctx, a.versionId, { priceBookItemId: b.capacitor, quantity: "1" })).rejects.toMatchObject({ code: "validation" });
    await expectPgError(adminSql`
      insert into public.estimate_line_items (organization_id, estimate_version_id, price_book_item_id, description, quantity, source)
      values (${a.orgId}, ${a.versionId}, ${b.capacitor}, 'x', 1, 'price_book')`, "23503");
    const ctxB: TenantCtx = { ...a.ctx, organizationId: b.orgId };
    await expect(createEstimate(ctxB, { jobId: b.jobId })).rejects.toBeDefined();
  });
});
