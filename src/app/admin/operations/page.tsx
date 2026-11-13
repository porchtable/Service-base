import { listEmailFailures, listFailedJobs, requirePlatformAdmin } from "@/server/admin/platform";
import { formatDateTime } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Jobs & email" };

export default async function AdminOperations() {
  await requirePlatformAdmin();
  const [jobs, emails] = await Promise.all([listFailedJobs(), listEmailFailures()]);
  return (
    <>
      <PageHeader title="Background jobs & email" description="Recipient addresses are masked." />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Failed background jobs (${jobs.length})`} />
          {jobs.length === 0 ? <div className="p-4"><EmptyState title="No failed jobs" /></div> : (
            <ul className="divide-y divide-border text-sm">{jobs.map((j) => (
              <li key={j.id} className="px-5 py-3"><p className="text-ink">{j.org_name} · {j.kind} · {j.attempts} attempt(s) · {j.to_email}</p><p className="text-ink-muted">{j.last_error} — {formatDateTime(j.updated_at)}</p></li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title={`Email delivery failures (${emails.length})`} />
          {emails.length === 0 ? <div className="p-4"><EmptyState title="No email failures" /></div> : (
            <ul className="divide-y divide-border text-sm">{emails.map((e) => (
              <li key={e.id} className="px-5 py-3"><p className="text-ink">{e.org_name ?? "—"} · {e.category} · <strong>{e.status}</strong> · {e.to_email} · {e.provider}</p><p className="text-ink-muted">{e.error ?? ""} — {formatDateTime(e.updated_at)}</p></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
