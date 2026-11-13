import { afterAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { adminSql, asUser, createAuthUser, expectPgError } from "../support/db";
import { addMember, createCompany } from "../support/fixtures";
import { db } from "@/server/db/client";
import { handleStripeWebhook } from "@/server/billing/stripe";
import { getSubscriptionState } from "@/server/billing/entitlements";
import { isPlatformAdmin, maskEmail, processAccountDeletion } from "@/server/admin/platform";
import { exportOrganizationData, requestAccountDeletion } from "@/server/domain/data-requests";
import { createCustomer } from "@/server/domain/customers";
import { createJob } from "@/server/domain/jobs";
import { createPriceBookItem } from "@/server/domain/pricebook";
import { addLineFromPriceBook, approveVersion, createEstimate, getEstimate, sendVersion } from "@/server/domain/estimates";
import { generateDraftWithAi } from "@/server/domain/estimate-ai";

afterAll(async () => {
  await db().end();
  await adminSql.end();
});

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
let seq = 0;

function subscriptionEvent(type: string, orgId: string, opts: { status: string; created: number; customer?: string; sub?: string; price?: string; cancelAtPeriodEnd?: boolean }) {
  seq++;
  return {
    id: `evt_test${seq}${Date.now()}`,
    object: "event",
    type,
    created: opts.created,
    data: {
      object: {
        id: opts.sub ?? "sub_test123",
        object: "subscription",
        customer: opts.customer ?? "cus_test123",
        status: opts.status,
        cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
        canceled_at: opts.status === "canceled" ? opts.created : null,
        trial_end: null,
        metadata: { organization_id: orgId },
        items: { data: [{ id: "si_1", current_period_end: opts.created + 30 * 86400, price: { id: opts.price ?? "price_basic123" } }] },
      },
    },
  };
}

function sign(payload: string) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
}

describe("Stripe webhooks (16)", () => {
  it("rejects unsigned, mis-signed and tampered payloads", async () => {
    const { orgId } = await createCompany("Webhook Auth Co");
    const payload = JSON.stringify(subscriptionEvent("customer.subscription.created", orgId, { status: "active", created: 1_800_000_000 }));
    expect((await handleStripeWebhook(payload, null)).status).toBe(400);
    expect((await handleStripeWebhook(payload, "t=1,v1=deadbeef")).status).toBe(400);
    const wrongSecret = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    expect((await handleStripeWebhook(payload, wrongSecret)).status).toBe(400);
    const sig = sign(payload);
    expect((await handleStripeWebhook(payload.replace('"active"', '"trialing"'), sig)).status).toBe(400);
    const [row] = await adminSql`select count(*)::int as n from public.subscriptions where organization_id = ${orgId}`;
    expect(row.n).toBe(0);
  });

  it("processes each event exactly once and ignores out-of-order updates", async () => {
    const { orgId } = await createCompany("Webhook Idem Co");
    await adminSql`insert into public.billing_plans (key, name, stripe_price_id, is_active) values ('basic-idem', 'Basic', 'price_basic123', true)
                   on conflict (stripe_price_id) do nothing`;
    const created = 1_800_000_000;
    const first = JSON.stringify(subscriptionEvent("customer.subscription.created", orgId, { status: "trialing", created, customer: "cus_idem1", sub: "sub_idem1" }));
    expect(await handleStripeWebhook(first, sign(first))).toEqual({ status: 200, body: { received: true } });
    // Replay of the same event: acknowledged, no second application.
    expect(await handleStripeWebhook(first, sign(first))).toEqual({ status: 200, body: { received: true, duplicate: true } });
    let state = await getSubscriptionState(orgId);
    expect(state.status).toBe("trialing");
    expect(state.planName).toBe("Basic");

    const newer = JSON.stringify(subscriptionEvent("customer.subscription.updated", orgId, { status: "active", created: created + 100, customer: "cus_idem1", sub: "sub_idem1", cancelAtPeriodEnd: true }));
    await handleStripeWebhook(newer, sign(newer));
    // An older event arriving late must not roll the status back.
    const stale = JSON.stringify(subscriptionEvent("customer.subscription.updated", orgId, { status: "past_due", created: created + 50, customer: "cus_idem1", sub: "sub_idem1" }));
    expect((await handleStripeWebhook(stale, sign(stale))).status).toBe(200);
    state = await getSubscriptionState(orgId);
    expect(state.status).toBe("active");
    expect(state.cancelAtPeriodEnd).toBe(true);

    const deleted = JSON.stringify(subscriptionEvent("customer.subscription.deleted", orgId, { status: "canceled", created: created + 200, customer: "cus_idem1", sub: "sub_idem1" }));
    await handleStripeWebhook(deleted, sign(deleted));
    expect((await getSubscriptionState(orgId)).status).toBe("canceled");

    const events = await adminSql`select count(*)::int as n from public.stripe_events where organization_id = ${orgId}`;
    expect(events[0].n).toBe(4);
    const audits = await adminSql`select count(*)::int as n from public.audit_events where organization_id = ${orgId} and actor_type = 'stripe'`;
    expect(audits[0].n).toBe(4);
  });

  it("acknowledges unhandled event types and unknown customers without side effects", async () => {
    const other = JSON.stringify({ id: "evt_other1", object: "event", type: "charge.refunded", created: 1_800_000_000, data: { object: {} } });
    expect((await handleStripeWebhook(other, sign(other))).body).toMatchObject({ ignored: "charge.refunded" });
    const unknown = JSON.stringify(subscriptionEvent("customer.subscription.updated", "00000000-0000-4000-8000-000000000000", { status: "active", created: 1_800_000_000, customer: "cus_nobody" }));
    expect((await handleStripeWebhook(unknown, sign(unknown))).status).toBe(200);
  });
});

describe("subscription enforcement and platform switches", () => {
  async function readyToSend(name: string) {
    const c = await createCompany(name);
    const customerId = await createCustomer(c.ctx, { name: "X", email: "x@example.test" });
    const jobId = await createJob(c.ctx, { customerId, title: "Job", status: "new" });
    const item = await createPriceBookItem(c.ctx, { name: "Item", unitPrice: "10", unit: "each", taxClass: "taxable", isActive: "on" });
    const { estimateId, versionId } = await createEstimate(c.ctx, { jobId });
    await addLineFromPriceBook(c.ctx, versionId, { priceBookItemId: item, quantity: "1" });
    await approveVersion(c.ctx, versionId);
    return { ...c, estimateId, versionId };
  }

  it("gates sending and AI drafting only when enforcement is on, and never reads", async () => {
    const s = await readyToSend("Gate Co");
    await adminSql`update public.platform_config set value = 'true' where key = 'billing.enforce_subscription'`;
    try {
      await expect(sendVersion(s.ctx, s.versionId, { email: false })).rejects.toMatchObject({ code: "forbidden" });
      expect((await getEstimate(s.ctx, s.estimateId)).status).toBe("approved"); // reading still works
      await adminSql`insert into public.subscriptions (organization_id, status) values (${s.orgId}, 'active')`;
      await sendVersion(s.ctx, s.versionId, { email: false });
      await adminSql`update public.subscriptions set status = 'past_due' where organization_id = ${s.orgId}`;
      const second = await createEstimate(s.ctx, { jobId: (await getEstimate(s.ctx, s.estimateId)).job.id });
      await expect(generateDraftWithAi(s.ctx, second.versionId, "notes kept even when gated")).rejects.toMatchObject({ code: "forbidden" });
      expect((await getEstimate(s.ctx, second.estimateId)).version.technicianNotes).toBe("notes kept even when gated");
    } finally {
      await adminSql`update public.platform_config set value = 'false' where key = 'billing.enforce_subscription'`;
    }
  });

  it("honors the AI kill switch without losing notes", async () => {
    const s = await readyToSend("Kill Co");
    const e = await createEstimate(s.ctx, { jobId: (await getEstimate(s.ctx, s.estimateId)).job.id });
    await adminSql`update public.platform_config set value = 'false' where key = 'features.ai_drafting'`;
    try {
      await expect(generateDraftWithAi(s.ctx, e.versionId, "kill switch notes")).rejects.toThrow(/temporarily disabled/);
      expect((await getEstimate(s.ctx, e.estimateId)).version.technicianNotes).toBe("kill switch notes");
    } finally {
      await adminSql`update public.platform_config set value = 'true' where key = 'features.ai_drafting'`;
    }
  });

  it("keeps billing tables read-only for tenants", async () => {
    const { orgId, owner } = await createCompany("RO Billing Co");
    await expectPgError(asUser(owner.userId, (tx) => tx`insert into public.subscriptions (organization_id, status) values (${orgId}, 'active')`), "42501");
    await expectPgError(asUser(owner.userId, (tx) => tx`select * from public.platform_config`), "42501");
    await expectPgError(asUser(owner.userId, (tx) => tx`select * from public.stripe_events`), "42501");
    await expectPgError(asUser(owner.userId, (tx) => tx`insert into public.billing_plans (key, name, stripe_price_id) values ('x1', 'x', 'price_x')`), "42501");
  });
});

describe("platform administration (17)", () => {
  it("is granted only explicitly", async () => {
    const { owner } = await createCompany("Not Admin Co");
    expect(await isPlatformAdmin(owner.userId)).toBe(false);
    await expectPgError(asUser(owner.userId, (tx) => tx`insert into public.platform_administrators (user_id) values (${owner.userId})`), "42501");
    const operator = await createAuthUser({ email: "operator-test@example.test" });
    await adminSql`insert into public.platform_administrators (user_id) values (${operator.userId})`;
    expect(await isPlatformAdmin(operator.userId)).toBe(true);
    // Platform admins see only their own row; ordinary users see none.
    expect(await asUser(owner.userId, (tx) => tx`select * from public.platform_administrators`)).toHaveLength(0);
  });

  it("masks customer emails in admin views", () => {
    expect(maskEmail("jamie@example.test")).toBe("j***@example.test");
    expect(maskEmail(null)).toBe("—");
  });

  it("blocks account deletion that would orphan an organization with members", async () => {
    const { orgId, owner } = await createCompany("Orphan Co");
    await addMember(orgId, "technician");
    await requestAccountDeletion({ userId: owner.userId, email: owner.email }, "leaving");
    await expect(requestAccountDeletion({ userId: owner.userId, email: owner.email })).rejects.toMatchObject({ code: "conflict" });
    const [req] = await adminSql`select id from public.data_requests where user_id = ${owner.userId} and status = 'pending'`;
    await expect(processAccountDeletion({ userId: owner.userId, email: null }, req.id, true)).rejects.toThrow(/only owner of Orphan Co/);
  });
});

describe("data export", () => {
  it("exports only the organization's own data, for owners/admins", async () => {
    const a = await createCompany("Export A");
    const b = await createCompany("Export B");
    await createCustomer(a.ctx, { name: "A customer" });
    await createCustomer(b.ctx, { name: "B customer" });
    const tech = await addMember(a.orgId, "technician");
    await expect(exportOrganizationData(tech)).rejects.toMatchObject({ code: "forbidden" });
    const data = await exportOrganizationData(a.ctx);
    expect((data.customers as Array<{ name: string }>).map((c) => c.name)).toEqual(["A customer"]);
    expect(JSON.stringify(data)).not.toContain("B customer");
    const [ev] = await adminSql`select action from public.audit_events where organization_id = ${a.orgId} and action = 'data.exported'`;
    expect(ev).toBeDefined();
  });
});

describe("account erasure", () => {
  it("deleting a user keeps the audit trail but removes the actor reference", async () => {
    const { orgId, owner } = await createCompany("Erase Co");
    const other = await addMember(orgId, "owner");
    const before = await adminSql`select count(*)::int as n from public.audit_events where actor_user_id = ${owner.userId}`;
    expect(before[0].n).toBeGreaterThan(0);
    await adminSql`delete from auth.users where id = ${owner.userId}`;
    const after = await adminSql`select count(*)::int as n from public.audit_events where organization_id = ${orgId} and actor_user_id is null and action = 'organization.created'`;
    expect(after[0].n).toBe(1);
    // Other tampering is still rejected.
    await expectPgError(adminSql`update public.audit_events set action = 'x' where organization_id = ${orgId}`, "42501");
    expect(other.role).toBe("owner");
  });

  it("deleting a whole organization cascades cleanly", async () => {
    const { orgId } = await createCompany("Cascade Co");
    await adminSql`delete from public.organizations where id = ${orgId}`;
    const left = await adminSql`select count(*)::int as n from public.audit_events where organization_id = ${orgId}`;
    expect(left[0].n).toBe(0);
  });
});
