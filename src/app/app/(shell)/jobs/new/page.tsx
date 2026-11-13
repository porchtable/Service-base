import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/server/auth/context";
import { loadJobFormOptions } from "@/server/domain/job-form-options";
import { PageHeader, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { JobForm } from "@/components/app/job-form";
import { createJobAction } from "@/app/app/_actions/jobs";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const opts = await loadJobFormOptions(ctx);
  const preselected = opts.customers.find((c) => c.id === sp.customerId);
  return (
    <>
      <PageHeader title="New job" back={<Link href="/app/jobs" className="text-brand-500 hover:underline">← Jobs</Link>} />
      {opts.customers.length === 0 ? (
        <EmptyState title="Add a customer first" description="Every job belongs to a customer."
          action={<LinkButton href="/app/customers/new" variant="primary">Add customer</LinkButton>} />
      ) : (
        <Card><CardBody>
          <JobForm action={createJobAction} cancelHref="/app/jobs" options={{
            customers: opts.customers.map((c) => ({ id: c.id, name: c.name })),
            technicians: opts.technicians,
            canManage: opts.canManage,
            timeZone: opts.org.timezone,
            appointmentLocal: "",
            defaultCustomerId: preselected?.id,
            defaultAddress: preselected ? { line1: preselected.addressLine1, line2: preselected.addressLine2, city: preselected.city, region: preselected.region, postal: preselected.postalCode } : undefined,
          }} />
        </CardBody></Card>
      )}
    </>
  );
}
