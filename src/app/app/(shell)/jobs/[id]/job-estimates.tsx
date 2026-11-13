import Link from "next/link";
import type { TenantCtx } from "@/server/auth/tenant-context";
import type { Job } from "@/server/domain/jobs";
import { listEstimates } from "@/server/domain/estimates";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { EstimateStatusBadge } from "@/components/app/estimate-status";
import { formatCents } from "@/lib/format";
import { createEstimateAction } from "@/app/app/_actions/estimates";

export async function JobEstimates({ ctx, job }: { ctx: TenantCtx; job: Job }) {
  const estimates = await listEstimates(ctx, { jobId: job.id });
  return (
    <Card>
      <CardHeader title={`Estimates (${estimates.length})`} actions={
        <ActionForm action={createEstimateAction} showSuccess={false}>
          <input type="hidden" name="jobId" value={job.id} />
          <SubmitButton size="sm" pendingLabel="Creating…">Create estimate</SubmitButton>
        </ActionForm>
      } />
      {estimates.length === 0 ? <p className="px-5 py-4 text-sm text-ink-muted">No estimates for this job yet. The technician observations above will be copied into the new estimate.</p> : (
        <ul className="divide-y divide-border">
          {estimates.map((e) => (
            <li key={e.id}>
              <Link href={`/app/estimates/${e.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-muted">
                <span className="text-sm text-ink">#{e.estimateNumber} {e.title} <span className="text-ink-subtle">v{e.versionNumber}</span></span>
                <span className="flex items-center gap-3"><span className="text-sm tabular-nums">{formatCents(e.totalCents)}</span><EstimateStatusBadge status={e.status} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
