import { listOrganizationsForAdmin, requirePlatformAdmin } from "@/server/admin/platform";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";

export const metadata = { title: "Organizations" };

export default async function AdminOrganizations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const orgs = await listOrganizationsForAdmin(sp.q);
  return (
    <>
      <PageHeader title="Organizations" description="Aggregate information only — no customer records are shown here." />
      <form className="mb-4 flex gap-2"><label htmlFor="q" className="sr-only">Search</label><input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Company name" className={`${controlClass} max-w-xs`} /><Button variant="secondary">Search</Button></form>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-surface-muted text-left text-ink-muted"><tr>
            <th scope="col" className="px-4 py-2 font-medium">Company</th><th scope="col" className="px-4 py-2 font-medium">Trade</th>
            <th scope="col" className="px-4 py-2 font-medium">Created</th><th scope="col" className="px-4 py-2 text-right font-medium">Members</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Estimates</th><th scope="col" className="px-4 py-2 font-medium">Subscription</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {orgs.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-2 text-ink">{o.name}</td><td className="px-4 py-2">{o.industry}</td><td className="px-4 py-2">{formatDate(o.created_at)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{o.members}</td><td className="px-4 py-2 text-right tabular-nums">{o.estimates}</td>
                <td className="px-4 py-2">{o.subscription_status}{o.plan_name ? ` · ${o.plan_name}` : ""}{o.cancel_at_period_end ? " (cancels at period end)" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
