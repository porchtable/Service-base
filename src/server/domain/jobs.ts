import "server-only";
import { z } from "zod";
import { jobSchema, technicianJobUpdateSchema, JOB_STATUSES, type JobStatus } from "@/lib/schemas";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/timezone";
import { can } from "@/lib/permissions";
import { withUser } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/errors";
import type { Tx } from "@/server/db/client";

export interface Job {
  id: string;
  jobNumber: number;
  customerId: string;
  customerName: string;
  title: string;
  status: JobStatus;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceCity: string | null;
  serviceRegion: string | null;
  servicePostalCode: string | null;
  equipmentType: string | null;
  equipmentMake: string | null;
  equipmentModel: string | null;
  equipmentSerial: string | null;
  equipmentAgeYears: number | null;
  equipmentNotes: string | null;
  description: string | null;
  technicianObservations: string | null;
  internalNotes: string | null;
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  appointmentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapJob(r: Record<string, unknown>): Job {
  return {
    id: r.id as string,
    jobNumber: r.job_number as number,
    customerId: r.customer_id as string,
    customerName: r.customer_name as string,
    title: r.title as string,
    status: r.status as JobStatus,
    serviceAddressLine1: (r.service_address_line1 as string) ?? null,
    serviceAddressLine2: (r.service_address_line2 as string) ?? null,
    serviceCity: (r.service_city as string) ?? null,
    serviceRegion: (r.service_region as string) ?? null,
    servicePostalCode: (r.service_postal_code as string) ?? null,
    equipmentType: (r.equipment_type as string) ?? null,
    equipmentMake: (r.equipment_make as string) ?? null,
    equipmentModel: (r.equipment_model as string) ?? null,
    equipmentSerial: (r.equipment_serial as string) ?? null,
    equipmentAgeYears: (r.equipment_age_years as number) ?? null,
    equipmentNotes: (r.equipment_notes as string) ?? null,
    description: (r.description as string) ?? null,
    technicianObservations: (r.technician_observations as string) ?? null,
    internalNotes: (r.internal_notes as string) ?? null,
    assignedTechnicianId: (r.assigned_technician_id as string) ?? null,
    assignedTechnicianName: (r.technician_name as string) ?? null,
    appointmentAt: (r.appointment_at as Date) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

async function orgTimezone(tx: Tx, orgId: string): Promise<string> {
  const [o] = await tx`select timezone from public.organizations where id = ${orgId}`;
  return (o?.timezone as string) ?? "UTC";
}

const selectJob = (tx: Tx) => tx`
  select j.*, c.name as customer_name, coalesce(p.full_name, p.email) as technician_name
  from public.jobs j
  join public.customers c on c.id = j.customer_id
  left join public.profiles p on p.id = j.assigned_technician_id`;

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...JOB_STATUSES, "open", "all"]).default("open"),
  technician: z.union([z.uuid(), z.literal("me"), z.literal("unassigned")]).optional(),
  customerId: z.uuid().optional(),
});

export async function listJobs(ctx: TenantCtx, params: unknown = {}): Promise<Job[]> {
  const p = listSchema.parse(params ?? {});
  const like = p.q ? `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const tech = p.technician === "me" ? ctx.userId : p.technician;
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      ${selectJob(tx)}
      where j.organization_id = ${ctx.organizationId}
        ${p.status === "open" ? tx`and j.status not in ('completed', 'cancelled')` : p.status === "all" ? tx`` : tx`and j.status = ${p.status}::public.job_status`}
        ${tech === "unassigned" ? tx`and j.assigned_technician_id is null` : tech ? tx`and j.assigned_technician_id = ${tech}` : tx``}
        ${p.customerId ? tx`and j.customer_id = ${p.customerId}` : tx``}
        ${like ? tx`and (j.title ilike ${like} or c.name ilike ${like} or j.service_address_line1 ilike ${like} or j.job_number::text = ${p.q!})` : tx``}
      order by j.appointment_at asc nulls last, j.created_at desc
      limit 500`;
    return rows.map(mapJob);
  });
}

export async function getJob(ctx: TenantCtx, id: string): Promise<Job> {
  if (!z.uuid().safeParse(id).success) throw notFound("Job");
  const rows = await withUser(ctx, (tx) => tx`${selectJob(tx)} where j.id = ${id} and j.organization_id = ${ctx.organizationId}`);
  if (!rows[0]) throw notFound("Job");
  return mapJob(rows[0]);
}

/** Datetime-local value for form defaults, in the organization's time zone. */
export function appointmentLocalValue(job: Job | undefined, timeZone: string): string {
  return job?.appointmentAt ? utcToZonedLocal(job.appointmentAt, timeZone) : "";
}

export async function createJob(ctx: TenantCtx, input: unknown): Promise<string> {
  assertCan(ctx, "job.create");
  const d = jobSchema.parse(input);
  // Technicians may only create jobs assigned to themselves (so they can keep working on them).
  const assignee = can(ctx.role, "job.manage") ? d.assignedTechnicianId ?? null : ctx.userId;
  return withUser(ctx, async (tx) => {
    const tz = await orgTimezone(tx, ctx.organizationId);
    const appointment = d.appointmentLocal ? zonedLocalToUtc(d.appointmentLocal, tz) : null;
    const [customer] = await tx`select archived_at from public.customers where id = ${d.customerId} and organization_id = ${ctx.organizationId}`;
    if (!customer) throw invalid("Choose a customer", { customerId: ["Choose a customer"] });
    if (customer.archived_at) throw invalid("This customer is archived. Restore them first.", { customerId: ["Customer is archived"] });
    const [row] = await tx`
      insert into public.jobs (organization_id, customer_id, title, status,
        service_address_line1, service_address_line2, service_city, service_region, service_postal_code,
        equipment_type, equipment_make, equipment_model, equipment_serial, equipment_age_years, equipment_notes,
        description, technician_observations, internal_notes, assigned_technician_id, appointment_at, created_by, job_number)
      values (${ctx.organizationId}, ${d.customerId}, ${d.title}, ${d.status}::public.job_status,
        ${d.serviceAddressLine1 ?? null}, ${d.serviceAddressLine2 ?? null}, ${d.serviceCity ?? null}, ${d.serviceRegion ?? null}, ${d.servicePostalCode ?? null},
        ${d.equipmentType ?? null}, ${d.equipmentMake ?? null}, ${d.equipmentModel ?? null}, ${d.equipmentSerial ?? null}, ${d.equipmentAgeYears ?? null}, ${d.equipmentNotes ?? null},
        ${d.description ?? null}, ${d.technicianObservations ?? null}, ${can(ctx.role, "job.manage") ? d.internalNotes ?? null : null},
        ${assignee}, ${appointment}, ${ctx.userId}, 0)
      returning id, job_number`;
    await audit(tx, ctx, "job.created", "job", row.id, { job_number: row.job_number });
    await audit(tx, ctx, "customer.job_created", "customer", d.customerId, { job_id: row.id, job_number: row.job_number });
    return row.id as string;
  });
}

export async function updateJob(ctx: TenantCtx, id: string, input: unknown): Promise<void> {
  z.uuid().parse(id);
  await withUser(ctx, async (tx) => {
    const [current] = await tx`select assigned_technician_id from public.jobs where id = ${id} and organization_id = ${ctx.organizationId}`;
    if (!current) throw notFound("Job");
    if (can(ctx.role, "job.manage")) {
      const d = jobSchema.parse(input);
      const tz = await orgTimezone(tx, ctx.organizationId);
      const appointment = d.appointmentLocal ? zonedLocalToUtc(d.appointmentLocal, tz) : null;
      await tx`
        update public.jobs set customer_id = ${d.customerId}, title = ${d.title}, status = ${d.status}::public.job_status,
          service_address_line1 = ${d.serviceAddressLine1 ?? null}, service_address_line2 = ${d.serviceAddressLine2 ?? null},
          service_city = ${d.serviceCity ?? null}, service_region = ${d.serviceRegion ?? null}, service_postal_code = ${d.servicePostalCode ?? null},
          equipment_type = ${d.equipmentType ?? null}, equipment_make = ${d.equipmentMake ?? null}, equipment_model = ${d.equipmentModel ?? null},
          equipment_serial = ${d.equipmentSerial ?? null}, equipment_age_years = ${d.equipmentAgeYears ?? null}, equipment_notes = ${d.equipmentNotes ?? null},
          description = ${d.description ?? null}, technician_observations = ${d.technicianObservations ?? null},
          internal_notes = ${d.internalNotes ?? null}, assigned_technician_id = ${d.assignedTechnicianId ?? null}, appointment_at = ${appointment}
        where id = ${id} and organization_id = ${ctx.organizationId}`;
    } else {
      if (current.assigned_technician_id !== ctx.userId) throw forbidden("You can only update jobs assigned to you");
      const d = technicianJobUpdateSchema.parse(input);
      await tx`
        update public.jobs set status = ${d.status}::public.job_status,
          service_address_line1 = ${d.serviceAddressLine1 ?? null}, service_address_line2 = ${d.serviceAddressLine2 ?? null},
          service_city = ${d.serviceCity ?? null}, service_region = ${d.serviceRegion ?? null}, service_postal_code = ${d.servicePostalCode ?? null},
          equipment_type = ${d.equipmentType ?? null}, equipment_make = ${d.equipmentMake ?? null}, equipment_model = ${d.equipmentModel ?? null},
          equipment_serial = ${d.equipmentSerial ?? null}, equipment_age_years = ${d.equipmentAgeYears ?? null}, equipment_notes = ${d.equipmentNotes ?? null},
          description = ${d.description ?? null}, technician_observations = ${d.technicianObservations ?? null}
        where id = ${id} and organization_id = ${ctx.organizationId}`;
    }
    await audit(tx, ctx, "job.updated", "job", id);
  });
}

export async function updateJobStatus(ctx: TenantCtx, id: string, status: string): Promise<void> {
  z.uuid().parse(id);
  const s = z.enum(JOB_STATUSES).parse(status);
  await withUser(ctx, async (tx) => {
    const res = await tx`update public.jobs set status = ${s}::public.job_status where id = ${id} and organization_id = ${ctx.organizationId}`;
    if (res.count === 0) throw forbidden("You can only update jobs assigned to you");
    await audit(tx, ctx, "job.status_changed", "job", id, { status: s });
  });
}

export async function deleteJob(ctx: TenantCtx, id: string): Promise<string[]> {
  assertCan(ctx, "job.manage");
  z.uuid().parse(id);
  return withUser(ctx, async (tx) => {
    const paths = await tx`select storage_path from public.job_attachments where job_id = ${id} and organization_id = ${ctx.organizationId}`;
    await audit(tx, ctx, "job.deleted", "job", id);
    const res = await tx`delete from public.jobs where id = ${id} and organization_id = ${ctx.organizationId}`;
    if (res.count === 0) throw notFound("Job");
    return paths.map((p) => p.storage_path as string);
  });
}
