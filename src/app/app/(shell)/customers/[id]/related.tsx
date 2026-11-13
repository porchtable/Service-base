import Link from "next/link";
import type { TenantCtx } from "@/server/auth/tenant-context";
import { listJobs } from "@/server/domain/jobs";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { JobStatusBadge } from "@/components/app/status-badges";
import { formatDate } from "@/lib/format";

/** Jobs (and, once available, estimates) for this customer. */
export async function CustomerRelated({ ctx, customerId, archived }: { ctx: TenantCtx; customerId: string; archived: boolean }) {
  const jobs = await listJobs(ctx, { customerId, status: "all" });
  return (
    <Card>
      <CardHeader title={`Jobs (${jobs.length})`} actions={!archived ? <LinkButton href={`/app/jobs/new?customerId=${customerId}`} size="sm">New job</LinkButton> : undefined} />
      {jobs.length === 0 ? <p className="px-5 py-4 text-sm text-ink-muted">No jobs for this customer yet.</p> : (
        <ul className="divide-y divide-border">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/app/jobs/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-muted">
                <span className="text-sm text-ink"><span className="text-ink-subtle">#{j.jobNumber}</span> {j.title} <span className="text-ink-subtle">· {formatDate(j.createdAt)}</span></span>
                <JobStatusBadge status={j.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
