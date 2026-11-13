/**
 * Production-readiness audit: a malicious signed-in user talking to tables
 * DIRECTLY (as Supabase's Data API allows with the public key + their own JWT),
 * bypassing all application code. Each test asserts the secure outcome.
 */
import { afterAll, describe, expect, it } from "vitest";
import { adminSql, asUser, expectPgError } from "../support/db";
import { addMember, createCompany } from "../support/fixtures";
import { db } from "@/server/db/client";
import { createCustomer } from "@/server/domain/customers";
import { createJob } from "@/server/domain/jobs";
import { createPriceBookItem } from "@/server/domain/pricebook";
import { addLineFromPriceBook, approveVersion, createEstimate, getEstimate, sendVersion } from "@/server/domain/estimates";
import { loadCustomerEstimate } from "@/server/domain/customer-estimates";

afterAll(async () => {
  await db().end();
  await adminSql.end();
});

/** Run as user; succeed if Postgres rejects OR the statement affects zero rows. */
async function denied(userId: string, q: (tx: Parameters<Parameters<typeof asUser>[1]>[0]) => Promise<{ count: number }>) {
  let count: number | null = null;
  try {
    count = (await asUser(userId, q)).count;
  } catch (err) {
    expect(String((err as { code?: string }).code), "unexpected error type").toMatch(/^(42501|P0001|23514|23503)$/);
    return;
  }
  expect(count, "VULNERABLE: the statement succeeded and changed data").toBe(0);
}

async function setup(name: string) {
  const c = await createCompany(name);
  const tech = await addMember(c.orgId, "technician");
  const admin = await addMember(c.orgId, "admin");
  const customerId = await createCustomer(c.ctx, { name: "Pat", email: "pat@example.test" });
  const jobId = await createJob(c.ctx, { customerId, title: "AC", status: "new", assignedTechnicianId: tech.userId });
  const item = await createPriceBookItem(c.ctx, { name: "Service call", unitPrice: "100", unit: "each", taxClass: "taxable", isActive: "on" });
  const { estimateId, versionId } = await createEstimate(c.ctx, { jobId });
  await addLineFromPriceBook(c.ctx, versionId, { priceBookItemId: item, quantity: "1" });
  return { ...c, tech, admin, customerId, jobId, item, estimateId, versionId };
}

describe("estimate integrity via direct table access", () => {
  it("technician cannot fake an estimate status or switch its current version", async () => {
    const s = await setup("Audit Status Co");
    await denied(s.tech.userId, (tx) => tx`update public.estimates set status = 'accepted' where id = ${s.estimateId}`);
    await denied(s.admin.userId, (tx) => tx`update public.estimates set status = 'accepted' where id = ${s.estimateId}`);
    const other = await createEstimate(s.ctx, { jobId: s.jobId });
    await denied(s.tech.userId, (tx) => tx`update public.estimates set current_version_id = ${other.versionId} where id = ${s.estimateId}`);
    await denied(s.tech.userId, (tx) => tx`update public.estimates set estimate_number = 1 where id = ${s.estimateId}`);
    // Renaming a draft estimate is a legitimate edit and stays allowed.
    const ok = await asUser(s.tech.userId, (tx) => tx`update public.estimates set title = 'Renamed' where id = ${s.estimateId}`);
    expect(ok.count).toBe(1);
    expect((await getEstimate(s.ctx, s.estimateId)).status).toBe("draft");
  });

  it("nobody can tamper with draft totals, approval stamps or snapshots directly", async () => {
    const s = await setup("Audit Totals Co");
    for (const user of [s.tech.userId, s.admin.userId, s.owner.userId]) {
      await denied(user, (tx) => tx`update public.estimate_versions set total_cents = 1, subtotal_cents = 1 where id = ${s.versionId}`);
      await denied(user, (tx) => tx`update public.estimate_versions set approved_at = now(), approved_by = ${user} where id = ${s.versionId}`);
      await denied(user, (tx) => tx`update public.estimate_versions set snapshot = '{"totals":{"total_cents":1}}'::jsonb where id = ${s.versionId}`);
    }
    await approveVersion(s.ctx, s.versionId);
    const e = await getEstimate(s.ctx, s.estimateId);
    expect(e.version.totalCents).toBe(10000);
  });

  it("customer sees the true total even if a manager approves via direct SQL", async () => {
    const s = await setup("Audit Snapshot Co");
    await asUser(s.owner.userId, (tx) => tx`update public.estimate_versions set status = 'approved' where id = ${s.versionId}`);
    const sent = await sendVersion(s.ctx, s.versionId, { email: false });
    const view = await loadCustomerEstimate(sent.link.split("/e/")[1]);
    expect(view.kind === "ok" && view.snapshot.totals.total_cents).toBe(10000);
  });
});

describe("identity and tenancy fields via direct table access", () => {
  it("a user cannot change the email shown for them to teammates", async () => {
    const s = await setup("Audit Profile Co");
    await denied(s.tech.userId, (tx) => tx`update public.profiles set email = 'ceo@example.test' where id = ${s.tech.userId}`);
    const ok = await asUser(s.tech.userId, (tx) => tx`update public.profiles set full_name = 'Sam' where id = ${s.tech.userId}`);
    expect(ok.count).toBe(1);
  });

  it("admins cannot rewrite organization counters or creator", async () => {
    const s = await setup("Audit Counter Co");
    await denied(s.admin.userId, (tx) => tx`update public.organizations set next_estimate_number = 1 where id = ${s.orgId}`);
    await denied(s.admin.userId, (tx) => tx`update public.organizations set created_by = ${s.admin.userId} where id = ${s.orgId}`);
  });

  it("technicians cannot promote themselves or read secrets", async () => {
    const s = await setup("Audit Role Co");
    await denied(s.tech.userId, (tx) => tx`update public.organization_members set role = 'admin' where user_id = ${s.tech.userId}`);
    expect(await asUser(s.tech.userId, (tx) => tx`select * from public.organization_invitations`)).toHaveLength(0);
    expect(await asUser(s.tech.userId, (tx) => tx`select * from public.estimate_access_tokens`)).toHaveLength(0);
    expect(await asUser(s.tech.userId, (tx) => tx`select * from public.email_events`)).toHaveLength(0);
    expect(await asUser(s.tech.userId, (tx) => tx`select * from public.audit_events`)).toHaveLength(0);
  });

  it("members cannot forge system, customer or Stripe audit events", async () => {
    const s = await setup("Audit Forge Co");
    for (const actor of ["system", "customer", "stripe", "platform_admin"]) {
      await expectPgError(asUser(s.owner.userId, (tx) => tx`
        insert into public.audit_events (organization_id, actor_user_id, actor_type, action) values (${s.orgId}, ${s.owner.userId}, ${actor}, 'x')`), "42501");
    }
  });

  it("an outsider cannot touch anything in another company", async () => {
    const s = await setup("Audit Victim Co");
    const outsider = await createCompany("Audit Attacker Co");
    const u = outsider.owner.userId;
    for (const table of ["customers", "jobs", "job_attachments", "price_book_items", "estimates", "estimate_versions",
      "estimate_line_items", "estimate_access_tokens", "estimate_decisions", "follow_up_jobs", "email_events",
      "audit_events", "organization_members", "organization_invitations", "subscriptions"]) {
      const rows = await asUser(u, (tx) => tx`select 1 from ${tx("public." + table)} where organization_id = ${s.orgId}`.catch(() =>
        tx`select 1 from ${tx(table)} where organization_id = ${s.orgId}`));
      expect(rows, table).toHaveLength(0);
    }
    await denied(u, (tx) => tx`update public.jobs set title = 'x' where organization_id = ${s.orgId}`);
    await denied(u, (tx) => tx`delete from public.price_book_items where organization_id = ${s.orgId}`);
  });
});
