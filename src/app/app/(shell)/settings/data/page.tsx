import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Data export" };

export default async function DataPage() {
  const ctx = await requireOrgContext();
  if (!can(ctx.role, "data.export")) redirect("/app");
  return (
    <>
      <PageHeader title="Data export" />
      <Card>
        <CardHeader title="Export all company data" description="Customers, jobs, price book, estimates (every version), decisions, follow-ups and team, as JSON. Photos are listed by name; download them from each job." />
        <CardBody>
          <a href="/api/export" className={buttonClass("primary")} download>Download export</a>
          <p className="mt-3 text-xs text-ink-subtle">Exports are logged in the audit history. Limited to 5 per hour.</p>
        </CardBody>
      </Card>
    </>
  );
}
