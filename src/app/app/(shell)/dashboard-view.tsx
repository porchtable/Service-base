import Link from "next/link";
import type { DashboardData } from "@/server/domain/dashboard";
import { formatCents } from "@/lib/format";

function Metric({ label, value, href, hint }: { label: string; value: string | number; href?: string; hint?: string }) {
  const body = (
    <>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-subtle">{hint}</p> : null}
    </>
  );
  const cls = "block rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm";
  return href ? <Link href={href} className={`${cls} hover:border-brand-300`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function DashboardView({ data }: { data: DashboardData }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="ops-h">
        <h2 id="ops-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Operations</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label="Total customers" value={data.totalCustomers} href="/app/customers" />
          <Metric label="Active jobs" value={data.activeJobs} href="/app/jobs" />
          <Metric label="Follow-ups due (24h)" value={data.followUpsDue} href="/app/follow-ups" />
          <Metric label="Failed follow-ups" value={data.followUpsFailed} href="/app/follow-ups?status=failed" />
        </div>
      </section>
      <section aria-labelledby="est-h">
        <h2 id="est-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Estimates</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label="Draft" value={data.draftEstimates} href="/app/estimates?status=draft" />
          <Metric label="Approved, not sent" value={data.approvedEstimates} href="/app/estimates?status=approved" />
          <Metric label="Sent" value={data.sentEstimates} hint="Ever sent to the customer" />
          <Metric label="Pending customer decision" value={data.pendingDecisions} href="/app/estimates?status=sent" />
          <Metric label="Accepted" value={data.acceptedEstimates} href="/app/estimates?status=accepted" />
          <Metric label="Declined" value={data.declinedEstimates} href="/app/estimates?status=declined" />
          <Metric label="Expired" value={data.expiredEstimates} href="/app/estimates?status=expired" />
        </div>
      </section>
      <section aria-labelledby="val-h">
        <h2 id="val-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-subtle">Estimate value</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Metric label="Total quoted" value={formatCents(data.totalQuotedCents)} hint="Sum of all sent estimates (current versions)" />
          <Metric label="Accepted estimate value" value={formatCents(data.totalAcceptedCents)} hint="Customer-approved estimates. Not collected payments." />
        </div>
      </section>
    </div>
  );
}
