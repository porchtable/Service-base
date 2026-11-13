import { afterAll, describe, expect, it } from "vitest";
import { adminSql, expectPgError, asUser } from "../support/db";
import { addMember, createCompany } from "../support/fixtures";
import { db } from "@/server/db/client";
import { createCustomer, setCustomerArchived } from "@/server/domain/customers";
import { createJob, updateJobStatus } from "@/server/domain/jobs";
import { createPriceBookItem } from "@/server/domain/pricebook";
import { updateFollowUpSettings, updateOrganizationSettings } from "@/server/domain/organizations";
import { addLineFromPriceBook, approveVersion, createEstimate, createRevision, sendVersion } from "@/server/domain/estimates";
import { loadCustomerEstimate, recordCustomerDecision } from "@/server/domain/customer-estimates";
import { getDashboard } from "@/server/domain/dashboard";
import { backoffMs, cancelPendingFollowUps, listFollowUps, processFollowUps, queueManualReminder, retryFollowUp } from "@/server/jobs/follow-ups";
import { EmailSendError, type EmailTransport, type OutboundEmail } from "@/server/email/transport";
import type { TenantCtx } from "@/server/auth/tenant-context";

afterAll(async () => {
  await db().end();
  await adminSql.end();
});

class TestTransport implements EmailTransport {
  readonly provider = "capture" as const;
  sent: Array<OutboundEmail & { key: string }> = [];
  calls = 0;
  failures: Array<EmailSendError> = [];
  delayMs = 0;
  async send(m: OutboundEmail, key: string) {
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const f = this.failures.shift();
    if (f) throw f;
    this.sent.push({ ...m, key });
    return { providerMessageId: `msg-${this.calls}-${key}` };
  }
}

async function setup(name: string, opts: { email?: string | null; validity?: string } = {}) {
  const c = await createCompany(name);
  await updateOrganizationSettings(c.ctx, { name, industry: "hvac", timezone: "UTC", estimateValidityDays: opts.validity ?? "30", defaultTaxRatePercent: "0" });
  const customerId = await createCustomer(c.ctx, { name: "Casey", email: opts.email === undefined ? "casey@example.test" : opts.email ?? undefined });
  const jobId = await createJob(c.ctx, { customerId, title: "Furnace", status: "new" });
  const item = await createPriceBookItem(c.ctx, { name: "Tune-up", unitPrice: "150", unit: "each", taxClass: "taxable", isActive: "on" });
  return { ...c, customerId, jobId, item };
}

async function makeEstimate(s: Awaited<ReturnType<typeof setup>>, ctx: TenantCtx = s.ctx, opts: { send?: boolean; email?: boolean; qty?: string } = {}) {
  const { estimateId, versionId } = await createEstimate(ctx, { jobId: s.jobId });
  await addLineFromPriceBook(s.ctx, versionId, { priceBookItemId: s.item, quantity: opts.qty ?? "1" });
  let link: string | null = null;
  if (opts.send !== false) {
    await approveVersion(s.ctx, versionId);
    link = (await sendVersion(s.ctx, versionId, { email: opts.email ?? true })).link;
  }
  return { estimateId, versionId, link };
}

const jobsFor = (versionId: string) => adminSql`
  select kind, sequence, status, attempts, cancel_reason, scheduled_for, next_attempt_at, last_error
  from public.follow_up_jobs where estimate_version_id = ${versionId} order by kind, sequence`;
const makeDue = (versionId: string) => adminSql`update public.follow_up_jobs set scheduled_for = now() - interval '1 minute' where estimate_version_id = ${versionId}`;

describe("follow-up scheduling and delivery", () => {
  it("queues delivery plus reminders within the validity window and delivers a working link", async () => {
    const s = await setup("Sched Co", { validity: "7" }); // offsets 2,5,10 → 10 is after expiry
    const { versionId } = await makeEstimate(s);
    const jobs = await jobsFor(versionId);
    expect(jobs.map((j) => [j.kind, j.sequence, j.status])).toEqual([
      ["automatic_reminder", 1, "pending"], ["automatic_reminder", 2, "pending"], ["initial_delivery", 0, "pending"],
    ]);
    const t = new TestTransport();
    const sum = await processFollowUps({ transport: t, versionId });
    expect(sum).toMatchObject({ claimed: 1, sent: 1 });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toBe("casey@example.test");
    expect(t.sent[0].fromName).toBe("Sched Co");
    const token = t.sent[0].text.match(/\/e\/([A-Za-z0-9_-]{43})/)![1];
    const view = await loadCustomerEstimate(token);
    expect(view.kind).toBe("ok");
    const [ev] = await adminSql`select status, provider_message_id, category from public.email_events where idempotency_key = ${`estimate-delivery:${versionId}`}`;
    expect(ev).toMatchObject({ status: "sent", category: "estimate_delivery" });
    // Reminders are not due yet.
    expect((await processFollowUps({ transport: t, versionId })).claimed).toBe(0);
    await makeDue(versionId);
    await processFollowUps({ transport: t, versionId });
    expect(t.sent).toHaveLength(3);
    expect(t.sent[1].subject).toMatch(/^Reminder:/);
  });

  it("does not email when sending without email, and respects disabled follow-ups", async () => {
    const s = await setup("NoEmail Co");
    const a = await makeEstimate(s, s.ctx, { email: false });
    expect(await jobsFor(a.versionId)).toHaveLength(0);
    await updateFollowUpSettings(s.ctx, { followUpEnabled: "false", followUpOffsetsDays: "2,5" });
    const b = await makeEstimate(s);
    expect((await jobsFor(b.versionId)).map((j) => j.kind)).toEqual(["initial_delivery"]);
  });

  it("stops follow-ups after a customer decision (13)", async () => {
    const s = await setup("Stop Co");
    const { versionId, link } = await makeEstimate(s);
    const t = new TestTransport();
    await processFollowUps({ transport: t, versionId });
    expect(t.sent).toHaveLength(1);
    await recordCustomerDecision(link!.split("/e/")[1], { decision: "accepted", signerName: "Casey", agree: "on" }, { ip: null, userAgent: null });
    const jobs = await jobsFor(versionId);
    expect(jobs.filter((j) => j.kind === "automatic_reminder").every((j) => j.status === "cancelled" && j.cancel_reason === "estimate_accepted")).toBe(true);
    await makeDue(versionId);
    await processFollowUps({ transport: t, versionId });
    expect(t.sent).toHaveLength(1);
    // A job somehow left pending (e.g. inserted late) is still cancelled at send time.
    await adminSql`update public.follow_up_jobs set status = 'pending', cancelled_at = null where estimate_version_id = ${versionId} and sequence = 1 and kind = 'automatic_reminder'`;
    await processFollowUps({ transport: t, versionId });
    expect(t.sent).toHaveLength(1);
    expect((await jobsFor(versionId)).find((j) => j.sequence === 1)?.cancel_reason).toBe("estimate_decided");
  });

  it("stops follow-ups when an estimate is declined, revised or expires", async () => {
    const s = await setup("Stop2 Co");
    const declined = await makeEstimate(s);
    await recordCustomerDecision(declined.link!.split("/e/")[1], { decision: "declined" }, { ip: null, userAgent: null });
    expect((await jobsFor(declined.versionId)).filter((j) => j.status === "pending")).toHaveLength(0);

    const revised = await makeEstimate(s);
    await createRevision(s.ctx, revised.estimateId);
    expect((await jobsFor(revised.versionId)).every((j) => j.status === "cancelled" && j.cancel_reason === "estimate_superseded")).toBe(true);

    const expiring = await makeEstimate(s);
    await adminSql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update public.estimate_versions set expires_at = now() - interval '1 minute' where id = ${expiring.versionId}`;
    });
    const t = new TestTransport();
    const sum = await processFollowUps({ transport: t });
    expect(sum.expired).toBeGreaterThanOrEqual(1);
    expect(t.sent.filter((m) => m.key.includes(expiring.versionId))).toHaveLength(0);
    expect((await jobsFor(expiring.versionId)).every((j) => j.status === "cancelled")).toBe(true);
  });

  it("never sends duplicates when workers run concurrently or retry after a crash (14)", async () => {
    const s = await setup("Dup Co");
    const { versionId } = await makeEstimate(s);
    await makeDue(versionId);
    const t = new TestTransport();
    t.delayMs = 50;
    await Promise.all(Array.from({ length: 6 }, (_, i) => processFollowUps({ transport: t, versionId, workerId: `w${i}` })));
    const keys = t.sent.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(4); // delivery + 3 reminders, each exactly once
    // Re-running finds nothing to do.
    await processFollowUps({ transport: t, versionId });
    expect(t.sent).toHaveLength(4);

    // Crash after the provider accepted the email but before the job was marked sent:
    const [job] = await adminSql`select id from public.follow_up_jobs where estimate_version_id = ${versionId} and kind = 'initial_delivery'`;
    await adminSql`update public.follow_up_jobs set status = 'processing', locked_at = now() - interval '11 minutes', locked_by = 'dead-worker' where id = ${job.id}`;
    await processFollowUps({ transport: t, versionId });
    expect(t.sent).toHaveLength(4); // reclaimed, recognized as already sent, not re-sent
    expect((await adminSql`select status from public.follow_up_jobs where id = ${job.id}`)[0].status).toBe("sent");
    // Database-level uniqueness: the same scheduled reminder cannot be queued twice.
    await expectPgError(adminSql`insert into public.follow_up_jobs (organization_id, estimate_version_id, kind, sequence, scheduled_for, idempotency_key)
      values (${s.orgId}, ${versionId}, 'automatic_reminder', 1, now(), 'another-key-123')`, "23505");
  });

  it("retries transient failures with backoff and gives up after max attempts", async () => {
    const s = await setup("Retry Co");
    const { versionId } = await makeEstimate(s);
    const t = new TestTransport();
    t.failures.push(new EmailSendError("Resend error 503", true));
    await processFollowUps({ transport: t, versionId });
    let [d] = (await jobsFor(versionId)).filter((j) => j.kind === "initial_delivery");
    expect(d).toMatchObject({ status: "pending", attempts: 1, last_error: "Resend error 503" });
    expect(new Date(d.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(4)).toBe(480_000);
    expect(backoffMs(50)).toBe(6 * 3600_000);

    await adminSql`update public.follow_up_jobs set next_attempt_at = now() where estimate_version_id = ${versionId} and kind = 'initial_delivery'`;
    await processFollowUps({ transport: t, versionId });
    [d] = (await jobsFor(versionId)).filter((j) => j.kind === "initial_delivery");
    expect(d.status).toBe("sent");
    expect(t.sent).toHaveLength(1);

    // Permanent failure: fails immediately, recorded for admins, retry re-queues.
    const other = await makeEstimate(s);
    t.failures.push(new EmailSendError("Resend error 422 validation_error", false));
    await processFollowUps({ transport: t, versionId: other.versionId });
    const [f] = await adminSql`select id, status from public.follow_up_jobs where estimate_version_id = ${other.versionId} and kind = 'initial_delivery'`;
    expect(f.status).toBe("failed");
    const [ev] = await adminSql`select status, error from public.email_events where follow_up_job_id = ${f.id}`;
    expect(ev).toMatchObject({ status: "failed" });
    await retryFollowUp(s.ctx, f.id);
    await processFollowUps({ transport: t, versionId: other.versionId });
    expect((await adminSql`select status from public.follow_up_jobs where id = ${f.id}`)[0].status).toBe("sent");
  });

  it("records a clear failure instead of pretending to send when email is not configured", async () => {
    const s = await setup("Unconfigured Co");
    const { versionId } = await makeEstimate(s);
    const broken: EmailTransport = { provider: "resend", send: async () => { throw new Error("should not be called"); } };
    const saved = process.env.ESTIMATE_LINK_SECRET;
    delete process.env.ESTIMATE_LINK_SECRET;
    const { env } = await import("@/server/env");
    (env() as { ESTIMATE_LINK_SECRET?: string }).ESTIMATE_LINK_SECRET = undefined;
    const sum = await processFollowUps({ transport: broken, versionId });
    process.env.ESTIMATE_LINK_SECRET = saved;
    (env() as { ESTIMATE_LINK_SECRET?: string }).ESTIMATE_LINK_SECRET = saved;
    expect(sum.failed).toBe(1);
    const [d] = (await jobsFor(versionId)).filter((j) => j.kind === "initial_delivery");
    expect(d.status).toBe("failed");
    expect(d.last_error).toMatch(/not configured/);
  });

  it("supports manual reminders and cancellation with permission checks", async () => {
    const s = await setup("Manual Co");
    const tech = await addMember(s.orgId, "technician");
    const { versionId } = await makeEstimate(s);
    await expect(queueManualReminder(tech, versionId)).rejects.toMatchObject({ code: "forbidden" });
    await expectPgError(asUser(tech.userId, (tx) => tx`update public.follow_up_jobs set status = 'cancelled' where estimate_version_id = ${versionId}`).then((r) => {
      if (r.count === 0) throw Object.assign(new Error("rls"), { code: "RLS" });
    }), "RLS");
    await queueManualReminder(s.ctx, versionId);
    await expect(queueManualReminder(s.ctx, versionId)).rejects.toMatchObject({ code: "conflict" });
    expect(await cancelPendingFollowUps(s.ctx, versionId)).toBe(4); // 3 automatic + 1 manual (initial delivery is kept)
    const list = await listFollowUps(s.ctx, { versionId });
    expect(list.filter((f) => f.status === "pending").map((f) => f.kind)).toEqual(["initial_delivery"]);
    // Tenants cannot forge delivery outcomes.
    await expectPgError(asUser(s.owner.userId, (tx) => tx`update public.follow_up_jobs set status = 'sent' where estimate_version_id = ${versionId} and kind = 'initial_delivery'`), "42501");
  });
});

describe("dashboard metrics (15)", () => {
  it("matches the database exactly, with period and technician filters", async () => {
    const s = await setup("Dash Co");
    const tech = await addMember(s.orgId, "technician");
    // Customers: 2 active (+1 archived)
    await createCustomer(s.ctx, { name: "Second" });
    const archived = await createCustomer(s.ctx, { name: "Gone" });
    await setCustomerArchived(s.ctx, archived, true);
    // Jobs: s.jobId (new) + one completed + one assigned to tech
    const done = await createJob(s.ctx, { customerId: s.customerId, title: "Done", status: "new" });
    await updateJobStatus(s.ctx, done, "completed");
    const techJob = await createJob(s.ctx, { customerId: s.customerId, title: "Tech job", status: "scheduled", assignedTechnicianId: tech.userId });

    await makeEstimate(s, s.ctx, { send: false });                     // draft 150
    const approved = await createEstimate(s.ctx, { jobId: s.jobId });  // approved 150
    await addLineFromPriceBook(s.ctx, approved.versionId, { priceBookItemId: s.item, quantity: "1" });
    await approveVersion(s.ctx, approved.versionId);
    await makeEstimate(s, s.ctx, { qty: "2" });                        // sent 300 (pending)
    const acc = await makeEstimate(s, s.ctx, { qty: "3" });            // accepted 450
    await recordCustomerDecision(acc.link!.split("/e/")[1], { decision: "accepted", signerName: "C", agree: "on" }, { ip: null, userAgent: null });
    const dec = await makeEstimate(s, s.ctx, { qty: "4" });            // declined 600
    await recordCustomerDecision(dec.link!.split("/e/")[1], { decision: "declined" }, { ip: null, userAgent: null });
    // Tech-assigned job estimate, sent and accepted: 1500
    const te = await createEstimate(s.ctx, { jobId: techJob });
    await addLineFromPriceBook(s.ctx, te.versionId, { priceBookItemId: s.item, quantity: "10" });
    await approveVersion(s.ctx, te.versionId);
    const teLink = (await sendVersion(s.ctx, te.versionId, { email: true })).link;
    await recordCustomerDecision(teLink.split("/e/")[1], { decision: "accepted", signerName: "C", agree: "on" }, { ip: null, userAgent: null });

    const d = await getDashboard(s.ctx, {});
    // Independent computation straight from the tables (superuser, no app code):
    const [x] = await adminSql`
      select
        (select count(*)::int from customers where organization_id = ${s.orgId} and archived_at is null) as customers,
        (select count(*)::int from jobs where organization_id = ${s.orgId} and status not in ('completed','cancelled')) as active_jobs,
        (select count(*)::int from estimates where organization_id = ${s.orgId} and status = 'draft') as drafts,
        (select count(*)::int from estimates where organization_id = ${s.orgId} and status = 'sent') as pending,
        (select count(*)::int from estimates where organization_id = ${s.orgId} and status in ('sent','accepted','declined','expired')) as sent,
        (select count(*)::int from estimates where organization_id = ${s.orgId} and status = 'accepted') as accepted,
        (select coalesce(sum(v.total_cents),0)::bigint from estimates e join estimate_versions v on v.id = e.current_version_id
          where e.organization_id = ${s.orgId} and e.status in ('sent','accepted','declined','expired')) as quoted,
        (select coalesce(sum(v.total_cents),0)::bigint from estimates e join estimate_versions v on v.id = e.current_version_id
          where e.organization_id = ${s.orgId} and e.status = 'accepted') as accepted_value,
        (select count(*)::int from follow_up_jobs where organization_id = ${s.orgId} and status = 'pending'
          and coalesce(next_attempt_at, scheduled_for) <= now() + interval '24 hours') as due`;
    expect(d.totalCustomers).toBe(x.customers);
    expect(d.totalCustomers).toBe(2);
    expect(d.activeJobs).toBe(x.active_jobs);
    expect(d.activeJobs).toBe(2);
    expect(d.draftEstimates).toBe(x.drafts);
    expect(d.draftEstimates).toBe(1);
    expect(d.approvedEstimates).toBe(1);
    expect(d.pendingDecisions).toBe(x.pending);
    expect(d.pendingDecisions).toBe(1);
    expect(d.sentEstimates).toBe(x.sent);
    expect(d.sentEstimates).toBe(4);
    expect(d.acceptedEstimates).toBe(x.accepted);
    expect(d.acceptedEstimates).toBe(2);
    expect(d.declinedEstimates).toBe(1);
    expect(d.expiredEstimates).toBe(0);
    expect(d.totalQuotedCents).toBe(Number(x.quoted));
    expect(d.totalQuotedCents).toBe(30000 + 45000 + 60000 + 150000);
    expect(d.totalAcceptedCents).toBe(Number(x.accepted_value));
    expect(d.totalAcceptedCents).toBe(45000 + 150000);
    expect(d.followUpsDue).toBe(x.due);

    const techOnly = await getDashboard(s.ctx, { technician: tech.userId });
    expect(techOnly).toMatchObject({ activeJobs: 1, sentEstimates: 1, acceptedEstimates: 1, totalAcceptedCents: 150000, draftEstimates: 0 });

    // Period filter: back-date one accepted estimate beyond 30 days.
    await adminSql`update estimates set created_at = now() - interval '45 days' where id = ${acc.estimateId}`;
    const recent = await getDashboard(s.ctx, { period: "30d" });
    expect(recent.acceptedEstimates).toBe(1);
    expect(recent.totalAcceptedCents).toBe(150000);
    expect((await getDashboard(s.ctx, { period: "90d" })).acceptedEstimates).toBe(2);

    // Another company sees none of this.
    const other = await createCompany("Dash Other");
    const od = await getDashboard(other.ctx, {});
    expect(od).toMatchObject({ totalCustomers: 0, sentEstimates: 0, totalQuotedCents: 0 });
  });
});
