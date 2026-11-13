/** Production-readiness audit: application-layer protections. */
import { afterAll, describe, expect, it } from "vitest";
import { adminSql } from "../support/db";
import { createCompany } from "../support/fixtures";
import { db } from "@/server/db/client";
import { safeNextPath } from "@/server/request";
import { rateLimit, LIMITS } from "@/server/ratelimit";
import { createCustomer } from "@/server/domain/customers";
import { createJob, getJob, listJobs } from "@/server/domain/jobs";
import { createEstimate } from "@/server/domain/estimates";
import { acceptInvitation, createInvitation } from "@/server/domain/members";
import { createAuthUser } from "../support/db";
import { zonedLocalToUtc, utcToZonedLocal } from "@/lib/timezone";

afterAll(async () => {
  await db().end();
  await adminSql.end();
});

describe("authentication hardening", () => {
  it("never redirects off-site after login", () => {
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "evil.test", "", null, 42]) {
      expect(safeNextPath(bad)).toBe("/app");
    }
    expect(safeNextPath("/app/estimates/123?version=4")).toBe("/app/estimates/123?version=4");
  });

  it("locks out brute-force login attempts per IP+email", async () => {
    const key = `audit-${Date.now()}:victim@example.test`;
    const results: boolean[] = [];
    for (let i = 0; i < LIMITS.login.limit + 3; i++) results.push(await rateLimit("login", key));
    expect(results.filter(Boolean)).toHaveLength(LIMITS.login.limit);
    expect(results.slice(-3)).toEqual([false, false, false]);
    // Other users are unaffected.
    expect(await rateLimit("login", `audit-${Date.now()}:other@example.test`)).toBe(true);
  });

  it("rejects expired and revoked invitations", async () => {
    const { ctx } = await createCompany("Audit Invite Co");
    const user = await createAuthUser({ email: `inv-${Date.now()}@example.test` });
    const inv = await createInvitation(ctx, { email: user.email, role: "technician" });
    await adminSql`update public.organization_invitations set expires_at = now() - interval '1 second' where id = ${inv.invitationId}`;
    await expect(acceptInvitation(user, inv.token)).rejects.toMatchObject({ code: "validation" });
    const inv2 = await createInvitation(ctx, { email: user.email, role: "technician" });
    await adminSql`update public.organization_invitations set revoked_at = now() where id = ${inv2.invitationId}`;
    await expect(acceptInvitation(user, inv2.token)).rejects.toMatchObject({ code: "validation" });
  });
});

describe("concurrency", () => {
  it("assigns unique sequential job and estimate numbers under concurrent creation", async () => {
    const { ctx } = await createCompany("Audit Concurrency Co");
    const customerId = await createCustomer(ctx, { name: "C" });
    const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => createJob(ctx, { customerId, title: `J${i}`, status: "new" })));
    const numbers = (await Promise.all(ids.map((id) => getJob(ctx, id)))).map((j) => j.jobNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => 1001 + i));
    const ests = await Promise.all(ids.slice(0, 8).map((jobId) => createEstimate(ctx, { jobId })));
    const nums = await adminSql`select estimate_number from public.estimates where id = any(${ests.map((e) => e.estimateId)}) order by 1`;
    expect(nums.map((r) => r.estimate_number)).toEqual(Array.from({ length: 8 }, (_, i) => 1001 + i));
  });
});

describe("scheduling", () => {
  it("stores appointments in UTC and round-trips across DST boundaries", () => {
    // US DST begins 2026-03-08 and ends 2026-11-01.
    const cases: Array<[string, string, string]> = [
      ["2026-03-07T09:00", "America/Chicago", "2026-03-07T15:00:00.000Z"],
      ["2026-03-09T09:00", "America/Chicago", "2026-03-09T14:00:00.000Z"],
      ["2026-11-02T09:00", "America/Los_Angeles", "2026-11-02T17:00:00.000Z"],
      ["2026-07-04T23:30", "Pacific/Honolulu", "2026-07-05T09:30:00.000Z"],
    ];
    for (const [local, tz, utc] of cases) {
      expect(zonedLocalToUtc(local, tz).toISOString()).toBe(utc);
      expect(utcToZonedLocal(new Date(utc), tz)).toBe(local);
    }
  });

  it("lists scheduled jobs in appointment order and filters by technician", async () => {
    const { ctx } = await createCompany("Audit Schedule Co");
    const customerId = await createCustomer(ctx, { name: "S" });
    await createJob(ctx, { customerId, title: "Later", status: "scheduled", appointmentLocal: "2026-12-02T08:00" });
    await createJob(ctx, { customerId, title: "Sooner", status: "scheduled", appointmentLocal: "2026-12-01T15:00" });
    await createJob(ctx, { customerId, title: "Unscheduled", status: "new" });
    expect((await listJobs(ctx, {})).map((j) => j.title)).toEqual(["Sooner", "Later", "Unscheduled"]);
    expect((await listJobs(ctx, { technician: "unassigned" })).length).toBe(3);
    await expect(createJob(ctx, { customerId, title: "Bad", status: "new", appointmentLocal: "tomorrow 9am" })).rejects.toThrow();
  });
});
