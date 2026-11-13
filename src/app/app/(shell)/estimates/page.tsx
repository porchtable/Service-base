import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/server/auth/context";
import { listEstimates } from "@/server/domain/estimates";
import { formatCents, formatDate } from "@/lib/format";
import { Alert, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { EstimateStatusBadge, ESTIMATE_STATUS_LABELS } from "@/components/app/estimate-status";

export const metadata: Metadata = { title: "Estimates" };
const FILTERS = ["all", "open", "draft", "approved", "sent", "accepted", "declined", "expired"] as const;

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const status = (FILTERS as readonly string[]).includes(sp.status ?? "") ? sp.status! : "all";
  const estimates = await listEstimates(ctx, { status, q: sp.q || undefined });
  return (
    <>
      <PageHeader title="Estimates" description="Start an estimate from a job." actions={<LinkButton href="/app/jobs" variant="primary">Go to jobs</LinkButton>} />
      {sp.deleted ? <div className="mb-4"><Alert tone="success">Draft estimate deleted.</Alert></div> : null}
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search estimates</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Search title, customer or #" className={`${controlClass} max-w-xs`} />
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className={`${controlClass} w-auto`}>
          {FILTERS.map((f) => <option key={f} value={f}>{f === "all" ? "All statuses" : f === "open" ? "Open (draft, approved, sent)" : ESTIMATE_STATUS_LABELS[f]}</option>)}
        </select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {estimates.length === 0 ? (
        <EmptyState title="No estimates found" description="Open a job and choose “Create estimate” to start one." action={<LinkButton href="/app/jobs" variant="primary">Go to jobs</LinkButton>} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {estimates.map((e) => (
              <li key={e.id}>
                <Link href={`/app/estimates/${e.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-muted">
                  <div className="min-w-0">
                    <p className="font-medium text-ink"><span className="text-ink-subtle">#{e.estimateNumber}</span> {e.title} <span className="text-ink-subtle">v{e.versionNumber}</span></p>
                    <p className="truncate text-sm text-ink-muted">{e.customerName} · Job #{e.jobNumber}{e.sentAt ? ` · sent ${formatDate(e.sentAt)}` : ""}{e.status === "sent" && e.expiresAt ? ` · expires ${formatDate(e.expiresAt)}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-sm text-ink">{formatCents(e.totalCents)}</span>
                    <EstimateStatusBadge status={e.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
