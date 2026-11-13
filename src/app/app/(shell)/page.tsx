import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { getDashboard } from "@/server/domain/dashboard";
import { listTechnicians } from "@/server/domain/members";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { Button, LinkButton } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const [data, techs] = await Promise.all([getDashboard(ctx, sp), listTechnicians(ctx)]);
  return (
    <>
      <PageHeader title="Dashboard" description={ctx.organizationName}
        actions={<LinkButton href="/app/jobs/new" variant="primary">New job</LinkButton>} />
      {sp.welcome ? <div className="mb-4"><Alert tone="success" title="Your company is set up">Next: add your price book and customers, then invite your team from the Team page.</Alert></div> : null}
      {sp.password_updated ? <div className="mb-4"><Alert tone="success">Your password was updated.</Alert></div> : null}
      <form className="mb-6 flex flex-wrap items-end gap-2" aria-label="Dashboard filters">
        <div>
          <label htmlFor="period" className="block text-xs font-medium text-ink-muted">Estimates created</label>
          <select id="period" name="period" defaultValue={data.period} className={`${controlClass} w-auto`}>
            <option value="all">All time</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="365d">Last 12 months</option>
          </select>
        </div>
        <div>
          <label htmlFor="technician" className="block text-xs font-medium text-ink-muted">Technician</label>
          <select id="technician" name="technician" defaultValue={data.technician ?? ""} className={`${controlClass} w-auto`}>
            <option value="">All technicians</option>
            {techs.map((t) => <option key={t.userId} value={t.userId}>{t.fullName ?? t.email}</option>)}
          </select>
        </div>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>
      <DashboardView data={data} />
    </>
  );
}
