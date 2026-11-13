import { afterAll, describe, expect, it } from "vitest";
import { adminSql, asUser, expectPgError } from "../support/db";
import { addMember, createCompany } from "../support/fixtures";
import { db } from "@/server/db/client";
import { createCustomer } from "@/server/domain/customers";
import { createJob, getJob, listJobs, updateJob, updateJobStatus } from "@/server/domain/jobs";
import { createPriceBookItem, getPriceBookItem, listPriceBook, updatePriceBookItem } from "@/server/domain/pricebook";

afterAll(async () => {
  await db().end();
  await adminSql.end();
});

const baseJob = (customerId: string, extra: Record<string, unknown> = {}) => ({
  customerId, title: "No cooling", status: "new", ...extra,
});

describe("jobs", () => {
  it("persists jobs with per-organization numbering and time-zone aware appointments", async () => {
    const { ctx } = await createCompany("Jobs Co");
    const cust = await createCustomer(ctx, { name: "Lee" });
    const j1 = await createJob(ctx, baseJob(cust, { appointmentLocal: "2026-07-01T09:00", equipmentType: "Split AC", equipmentAgeYears: "12" }));
    const j2 = await createJob(ctx, baseJob(cust));
    const a = await getJob(ctx, j1);
    const b = await getJob(ctx, j2);
    expect(b.jobNumber).toBe(a.jobNumber + 1);
    expect(a.appointmentAt?.toISOString()).toBe("2026-07-01T13:00:00.000Z"); // America/New_York default
    expect(a.equipmentAgeYears).toBe(12);
    expect(a.customerName).toBe("Lee");
    const other = await createCompany("Jobs Co 2");
    const c2 = await createCustomer(other.ctx, { name: "X" });
    const o = await getJob(other.ctx, await createJob(other.ctx, baseJob(c2)));
    expect(o.jobNumber).toBe(1001); // independent sequence
  });

  it("prevents cross-organization relationships at the database level", async () => {
    const a = await createCompany("FK A");
    const b = await createCompany("FK B");
    const bCustomer = await createCustomer(b.ctx, { name: "B customer" });
    // App path
    await expect(createJob(a.ctx, baseJob(bCustomer))).rejects.toMatchObject({ code: "validation" });
    // Even as superuser (bypassing RLS) the composite FK rejects it.
    await expectPgError(adminSql`
      insert into public.jobs (organization_id, customer_id, title, created_by, job_number)
      values (${a.orgId}, ${bCustomer}, 'x', ${a.owner.userId}, 0)`, "23503");
    // Assigning a technician who is not a member of the job's organization.
    const aCustomer = await createCustomer(a.ctx, { name: "A customer" });
    await expect(createJob(a.ctx, baseJob(aCustomer, { assignedTechnicianId: b.owner.userId }))).rejects.toMatchObject({ code: "23503" });
    // Attachment rows must point at a job in the same org and a matching storage path.
    const aJob = await createJob(a.ctx, baseJob(aCustomer));
    await expectPgError(adminSql`
      insert into public.job_attachments (organization_id, job_id, storage_path, file_name, content_type, size_bytes)
      values (${b.orgId}, ${aJob}, ${`${b.orgId}/${aJob}/x.jpg`}, 'x.jpg', 'image/jpeg', 10)`, "23503");
    await expectPgError(adminSql`
      insert into public.job_attachments (organization_id, job_id, storage_path, file_name, content_type, size_bytes)
      values (${a.orgId}, ${aJob}, ${`${b.orgId}/${aJob}/x.jpg`}, 'x.jpg', 'image/jpeg', 10)`, "23514");
  });

  it("limits technicians to field-work fields on jobs assigned to them", async () => {
    const { orgId, ctx } = await createCompany("Tech Co");
    const tech = await addMember(orgId, "technician");
    const otherTech = await addMember(orgId, "technician");
    const cust = await createCustomer(ctx, { name: "Pat" });
    const assigned = await createJob(ctx, baseJob(cust, { assignedTechnicianId: tech.userId, internalNotes: "gate code 1234" }));
    const notAssigned = await createJob(ctx, baseJob(cust, { assignedTechnicianId: otherTech.userId }));

    await updateJob(tech, assigned, { status: "in_progress", technicianObservations: "Capacitor bulging", equipmentMake: "Carrier" });
    const j = await getJob(ctx, assigned);
    expect(j.technicianObservations).toBe("Capacitor bulging");
    expect(j.status).toBe("in_progress");
    expect(j.internalNotes).toBe("gate code 1234"); // untouched

    await expect(updateJob(tech, notAssigned, { status: "completed" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateJobStatus(tech, notAssigned, "completed")).rejects.toMatchObject({ code: "forbidden" });
    // Direct SQL attempts to reassign or change restricted columns are blocked by the trigger.
    await expectPgError(asUser(tech.userId, (tx) => tx`update public.jobs set assigned_technician_id = null where id = ${assigned}`), "42501");
    await expectPgError(asUser(tech.userId, (tx) => tx`update public.jobs set internal_notes = 'x' where id = ${assigned}`), "42501");
    expect((await asUser(tech.userId, (tx) => tx`update public.jobs set status = 'completed' where id = ${notAssigned}`)).count).toBe(0);
    // Technicians cannot delete jobs.
    expect((await asUser(tech.userId, (tx) => tx`delete from public.jobs where id = ${assigned}`)).count).toBe(0);

    // A technician's own new job is assigned to themselves.
    const own = await createJob(tech, baseJob(cust, { assignedTechnicianId: otherTech.userId }));
    expect((await getJob(ctx, own)).assignedTechnicianId).toBe(tech.userId);
    expect((await listJobs(tech, { technician: "me" })).map((x) => x.id).sort()).toEqual([assigned, own].sort());
  });
});

describe("price book", () => {
  it("stores integer cents and is editable only by owners/admins", async () => {
    const { orgId, ctx } = await createCompany("Price Co");
    const tech = await addMember(orgId, "technician");
    const id = await createPriceBookItem(ctx, {
      name: "Capacitor replacement", unitPrice: "189.99", unit: "each", taxClass: "taxable", isActive: "on", category: "Electrical",
    });
    const item = await getPriceBookItem(ctx, id);
    expect(item.unitPriceCents).toBe(18999);
    const [raw] = await adminSql`select unit_price_cents, pg_typeof(unit_price_cents)::text as t from public.price_book_items where id = ${id}`;
    expect(raw.t).toBe("bigint");

    await updatePriceBookItem(ctx, id, { name: "Capacitor replacement", unitPrice: "$1,205.10", unit: "each", taxClass: "non_taxable" });
    const updated = await getPriceBookItem(ctx, id);
    expect(updated.unitPriceCents).toBe(120510);
    expect(updated.isActive).toBe(false); // unchecked checkbox → inactive

    await expect(createPriceBookItem(tech, { name: "x", unitPrice: "1", unit: "each", taxClass: "taxable" })).rejects.toMatchObject({ code: "forbidden" });
    await expectPgError(asUser(tech.userId, (tx) => tx`
      insert into public.price_book_items (organization_id, name, unit_price_cents) values (${orgId}, 'sneaky', 1)`), "42501");
    expect((await asUser(tech.userId, (tx) => tx`update public.price_book_items set unit_price_cents = 1 where id = ${id}`)).count).toBe(0);
    expect((await listPriceBook(tech, { status: "all" })).map((i) => i.id)).toEqual([id]); // technicians can read

    await expect(createPriceBookItem(ctx, { name: "Bad", unitPrice: "12.345", unit: "each", taxClass: "taxable" })).rejects.toThrow();
    await expect(createPriceBookItem(ctx, { name: "Neg", unitPrice: "-5", unit: "each", taxClass: "taxable" })).rejects.toThrow();
    await expectPgError(adminSql`insert into public.price_book_items (organization_id, name, unit_price_cents) values (${orgId}, 'neg', -1)`, "23514");
    await expect(createPriceBookItem(ctx, { name: "capacitor REPLACEMENT", unitPrice: "1", unit: "each", taxClass: "taxable" })).rejects.toMatchObject({ code: "23505" });
  });

  it("is isolated between organizations", async () => {
    const a = await createCompany("PB A");
    const b = await createCompany("PB B");
    const bItem = await createPriceBookItem(b.ctx, { name: "Secret rate", unitPrice: "99", unit: "hour", taxClass: "non_taxable", isActive: "on" });
    expect(await listPriceBook(a.ctx, { status: "all" })).toHaveLength(0);
    await expect(getPriceBookItem(a.ctx, bItem)).rejects.toMatchObject({ code: "not_found" });
  });
});
