import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/server/auth/context";
import { listJobs } from "@/server/domain/jobs";
import { listTechnicians } from "@/server/domain/members";
import { getOrganization } from "@/server/domain/organizations";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/schemas";
import { formatDateTime } from "@/lib/format";
import { Alert, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { JobStatusBadge } from "@/components/app/status-badges";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const status = (sp.status && ([...JOB_STATUSES, "open", "all"] as string[]).includes(sp.status) ? sp.status : "open") as string;
  const [jobs, techs, org] = await Promise.all([
    listJobs(ctx, { q: sp.q || undefined, status, technician: sp.technician || undefined }),
    listTechnicians(ctx),
    getOrganization(ctx),
  ]);
  return (
    <>
      <PageHeader title="Jobs" actions={<LinkButton href="/app/jobs/new" variant="primary">New job</LinkButton>} />
      {sp.deleted ? <div className="mb-4"><Alert tone="success">Job deleted.</Alert></div> : null}
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search jobs</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Search title, customer, address or job #" className={`${controlClass} max-w-xs`} />
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className={`${controlClass} w-auto`}>
          <option value="open">Open jobs</option>
          {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
          <option value="all">All</option>
        </select>
        <label htmlFor="technician" className="sr-only">Technician</label>
        <select id="technician" name="technician" defaultValue={sp.technician ?? ""} className={`${controlClass} w-auto`}>
          <option value="">Any technician</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {techs.map((t) => <option key={t.userId} value={t.userId}>{t.fullName ?? t.email}</option>)}
        </select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {jobs.length === 0 ? (
        <EmptyState title="No jobs found" description="Create a job to record a service visit, equipment details and technician notes."
          action={<LinkButton href="/app/jobs/new" variant="primary">New job</LinkButton>} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/app/jobs/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-muted">
                  <div className="min-w-0">
                    <p className="font-medium text-ink"><span className="text-ink-subtle">#{j.jobNumber}</span> {j.title}</p>
                    <p className="truncate text-sm text-ink-muted">
                      {j.customerName}
                      {j.appointmentAt ? ` · ${formatDateTime(j.appointmentAt, org.timezone)}` : ""}
                      {` · ${j.assignedTechnicianName ?? "Unassigned"}`}
                    </p>
                  </div>
                  <JobStatusBadge status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
