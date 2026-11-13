import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { getJob } from "@/server/domain/jobs";
import { listAttachments } from "@/server/domain/attachments";
import { getOrganization } from "@/server/domain/organizations";
import { can } from "@/lib/permissions";
import { AppError } from "@/server/errors";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/schemas";
import { formatAddress, formatDateTime } from "@/lib/format";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { controlClass } from "@/components/ui/field";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { JobStatusBadge } from "@/components/app/status-badges";
import { PhotoUpload } from "@/components/app/photo-upload";
import { deleteAttachmentAction, deleteJobAction, updateJobStatusAction, uploadAttachmentAction } from "@/app/app/_actions/jobs";
import { JobEstimates } from "./job-estimates";

export const metadata: Metadata = { title: "Job" };

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-ink-subtle">{label}</dt><dd className="whitespace-pre-wrap text-ink">{value || "—"}</dd></div>;
}

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const sp = await searchParams;
  const job = await getJob(ctx, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const [attachments, org] = await Promise.all([listAttachments(ctx, id), getOrganization(ctx)]);
  const manage = can(ctx.role, "job.manage");
  const isAssigned = job.assignedTechnicianId === ctx.userId;
  const canEdit = manage || isAssigned;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><span className="text-ink-subtle">#{job.jobNumber}</span> {job.title} <JobStatusBadge status={job.status} /></span>}
        description={<Link href={`/app/customers/${job.customerId}`} className="text-brand-500 hover:underline">{job.customerName}</Link>}
        back={<Link href="/app/jobs" className="text-brand-500 hover:underline">← Jobs</Link>}
        actions={<>
          {canEdit ? <LinkButton href={`/app/jobs/${id}/edit`}>Edit job</LinkButton> : null}
          {manage ? <ConfirmAction action={deleteJobAction} fields={{ id }} label="Delete" title={`Delete job #${job.jobNumber}?`} confirmLabel="Delete job"
            description="This permanently deletes the job and its photos. Jobs with estimates cannot be deleted." /> : null}
        </>}
      />
      <div className="space-y-3">
        {sp.created ? <Alert tone="success">Job created.</Alert> : null}
        {sp.updated ? <Alert tone="success">Job updated.</Alert> : null}
        {!canEdit ? <Alert tone="info">This job is assigned to {job.assignedTechnicianName ?? "no one"}. You can view it but not change it.</Alert> : null}
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Technician observations" description="Used when drafting an estimate." />
            <CardBody><p className="whitespace-pre-wrap text-sm text-ink">{job.technicianObservations || "No observations recorded yet."}</p></CardBody>
          </Card>
          <JobEstimates ctx={ctx} job={job} />
          <Card>
            <CardHeader title={`Photos (${attachments.length})`} />
            <CardBody className="space-y-4">
              {attachments.length > 0 ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {attachments.map((a) => (
                    <li key={a.id} className="space-y-1">
                      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private signed URLs are not optimizable */}
                        <img src={`/api/attachments/${a.id}`} alt={a.caption ?? a.fileName} className="aspect-square w-full object-cover" loading="lazy" />
                      </a>
                      <p className="truncate text-xs text-ink-muted" title={a.fileName}>{a.caption ?? a.fileName}</p>
                      {manage || a.uploadedBy === ctx.userId ? (
                        <ConfirmAction action={deleteAttachmentAction} fields={{ id: a.id, jobId: id }} size="sm" variant="ghost" label="Remove"
                          title="Remove this photo?" confirmLabel="Remove" description="The photo will be permanently deleted." />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-muted">No photos yet.</p>}
              {canEdit ? <PhotoUpload jobId={id} action={uploadAttachmentAction} /> : null}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          {canEdit ? (
            <Card>
              <CardHeader title="Status" />
              <CardBody>
                <ActionForm action={updateJobStatusAction} className="flex gap-2">
                  <input type="hidden" name="id" value={id} />
                  <label htmlFor="job-status" className="sr-only">Job status</label>
                  <select id="job-status" name="status" defaultValue={job.status} className={controlClass}>
                    {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
                  </select>
                  <SubmitButton variant="secondary" pendingLabel="…">Update</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <Detail label="Appointment" value={job.appointmentAt ? formatDateTime(job.appointmentAt, org.timezone) : null} />
                <Detail label="Technician" value={job.assignedTechnicianName ?? "Unassigned"} />
                <Detail label="Service address" value={formatAddress([job.serviceAddressLine1, job.serviceAddressLine2, job.serviceCity, job.serviceRegion, job.servicePostalCode])} />
                <Detail label="Description" value={job.description} />
                {manage ? <Detail label="Internal notes" value={job.internalNotes} /> : null}
                <Detail label="Created" value={formatDateTime(job.createdAt, org.timezone)} />
                <Detail label="Last updated" value={formatDateTime(job.updatedAt, org.timezone)} />
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Equipment" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <Detail label="Type" value={job.equipmentType} />
                <Detail label="Make / model" value={[job.equipmentMake, job.equipmentModel].filter(Boolean).join(" ")} />
                <Detail label="Serial" value={job.equipmentSerial} />
                <Detail label="Age" value={job.equipmentAgeYears !== null ? `${job.equipmentAgeYears} years` : null} />
                <Detail label="Notes" value={job.equipmentNotes} />
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
