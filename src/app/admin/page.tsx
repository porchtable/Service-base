import { platformOverview, requirePlatformAdmin } from "@/server/admin/platform";
import { formatDateTime } from "@/lib/format";
import { Badge, PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Overview" };

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className={`rounded-[var(--radius-card)] border bg-surface p-4 ${warn ? "border-danger-600/50" : "border-border"}`}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-danger-700" : "text-ink"}`}>{value}</p>
    </div>
  );
}

export default async function AdminOverview() {
  await requirePlatformAdmin();
  const o = await platformOverview();
  const c = o.counts;
  const workerStale = o.health.workerStale;
  return (
    <>
      <PageHeader title="Overview" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Organizations" value={c.organizations} />
        <Stat label="Users" value={c.users} />
        <Stat label="Memberships" value={c.memberships} />
        <Stat label="Estimates sent" value={c.estimates_sent} />
        <Stat label="Estimates accepted" value={c.estimates_accepted} />
        <Stat label="Failed jobs" value={c.failed_jobs} warn={c.failed_jobs > 0} />
        <Stat label="Overdue jobs (>15 min)" value={c.overdue_jobs} warn={c.overdue_jobs > 0} />
        <Stat label="Email failures (7 days)" value={c.email_failures_7d} warn={c.email_failures_7d > 0} />
        <Stat label="Pending data requests" value={c.pending_requests} warn={c.pending_requests > 0} />
        <Stat label="Unprocessed Stripe events" value={c.stuck_stripe_events} warn={c.stuck_stripe_events > 0} />
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Application health" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>Database</dt><dd>reachable · {o.health.databaseLatencyMs} ms</dd></div>
              <div className="flex justify-between"><dt>Background jobs last ran</dt><dd>{o.health.workerLastRun ? formatDateTime(o.health.workerLastRun) : "never"} {workerStale ? <Badge tone="warning">stale</Badge> : <Badge tone="success">ok</Badge>}</dd></div>
              {Object.entries(o.health.integrations).map(([k, v]) => (
                <div key={k} className="flex justify-between"><dt>{k}</dt><dd>{v === false ? <Badge tone="warning">not configured</Badge> : <Badge tone="success">{v === true ? "configured" : String(v)}</Badge>}</dd></div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Subscriptions" />
          <CardBody>
            <ul className="space-y-1 text-sm">{o.subscriptions.map((s) => <li key={s.status} className="flex justify-between"><span>{s.status}</span><span className="tabular-nums">{s.count}</span></li>)}</ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
