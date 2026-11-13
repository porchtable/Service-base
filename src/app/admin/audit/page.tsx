import { listAuditEvents, requirePlatformAdmin } from "@/server/admin/platform";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";

export const metadata = { title: "Audit log" };

export default async function AdminAudit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const events = await listAuditEvents({ action: sp.action || undefined, organizationId: sp.org || undefined }).catch(() => []);
  return (
    <>
      <PageHeader title="Audit log" description="Most recent 300 events. Event details are omitted to avoid exposing customer information." />
      <form className="mb-4 flex gap-2"><label htmlFor="action" className="sr-only">Action prefix</label><input id="action" name="action" defaultValue={sp.action ?? ""} placeholder="Action prefix, e.g. estimate." className={`${controlClass} max-w-xs`} /><Button variant="secondary">Filter</Button></form>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-surface-muted text-left text-ink-muted"><tr><th scope="col" className="px-4 py-2 font-medium">When</th><th scope="col" className="px-4 py-2 font-medium">Organization</th><th scope="col" className="px-4 py-2 font-medium">Actor</th><th scope="col" className="px-4 py-2 font-medium">Action</th><th scope="col" className="px-4 py-2 font-medium">Entity</th></tr></thead>
          <tbody className="divide-y divide-border">{events.map((e) => (
            <tr key={e.id}><td className="px-4 py-2 whitespace-nowrap">{formatDateTime(e.created_at)}</td><td className="px-4 py-2">{e.org_name ?? "platform"}</td><td className="px-4 py-2">{e.actor_type}</td><td className="px-4 py-2 font-mono text-xs">{e.action}</td><td className="px-4 py-2">{e.entity_type ?? ""}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}
