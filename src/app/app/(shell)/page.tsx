import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { getDashboard } from "@/server/domain/dashboard";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { LinkButton } from "@/components/ui/button";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const data = await getDashboard(ctx, sp);
  return (
    <>
      <PageHeader title="Dashboard" description={ctx.organizationName}
        actions={<LinkButton href="/app/customers/new" variant="primary">Add customer</LinkButton>} />
      {sp.welcome ? <div className="mb-4"><Alert tone="success" title="Your company is set up">Next: add customers, then invite your team from the Team page.</Alert></div> : null}
      {sp.password_updated ? <div className="mb-4"><Alert tone="success">Your password was updated.</Alert></div> : null}
      <DashboardView data={data} />
    </>
  );
}
