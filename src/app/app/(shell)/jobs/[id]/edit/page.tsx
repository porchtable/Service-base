import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { appointmentLocalValue, getJob } from "@/server/domain/jobs";
import { loadJobFormOptions } from "@/server/domain/job-form-options";
import { can } from "@/lib/permissions";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody } from "@/components/ui/card";
import { JobForm } from "@/components/app/job-form";
import { updateJobAction } from "@/app/app/_actions/jobs";

export const metadata: Metadata = { title: "Edit job" };

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const job = await getJob(ctx, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  if (!can(ctx.role, "job.manage") && job.assignedTechnicianId !== ctx.userId) redirect(`/app/jobs/${id}`);
  const opts = await loadJobFormOptions(ctx, job.customerId);
  return (
    <>
      <PageHeader title={`Edit job #${job.jobNumber}`} back={<Link href={`/app/jobs/${id}`} className="text-brand-500 hover:underline">← Back to job</Link>} />
      <Card><CardBody>
        <JobForm action={updateJobAction} job={job} cancelHref={`/app/jobs/${id}`} options={{
          customers: opts.customers.map((c) => ({ id: c.id, name: c.name })),
          technicians: opts.technicians,
          canManage: opts.canManage,
          timeZone: opts.org.timezone,
          appointmentLocal: appointmentLocalValue(job, opts.org.timezone),
        }} />
      </CardBody></Card>
    </>
  );
}
