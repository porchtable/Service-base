import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { getCustomer, getCustomerActivity } from "@/server/domain/customers";
import { AppError } from "@/server/errors";
import { can } from "@/lib/permissions";
import { formatAddress, formatDate, formatDateTime, humanize } from "@/lib/format";
import { Alert, Badge, PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { setCustomerArchivedAction } from "@/app/app/_actions/customers";
import { CustomerRelated } from "./related";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const sp = await searchParams;
  const customer = await getCustomer(ctx, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const activity = await getCustomerActivity(ctx, id);
  const address = formatAddress([customer.addressLine1, customer.addressLine2, customer.city, customer.region, customer.postalCode]);

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{customer.name}{customer.archivedAt ? <Badge>Archived</Badge> : null}</span>}
        description={customer.companyName ?? undefined}
        back={<Link href="/app/customers" className="text-brand-500 hover:underline">← Customers</Link>}
        actions={
          <>
            <LinkButton href={`/app/customers/${id}/edit`}>Edit</LinkButton>
            {can(ctx.role, "customer.archive") ? (
              customer.archivedAt ? (
                <ConfirmAction action={setCustomerArchivedAction} fields={{ id, archived: "false" }} label="Restore"
                  title="Restore this customer?" confirmLabel="Restore" confirmVariant="primary"
                  description="The customer will appear in your active customer list again." />
              ) : (
                <ConfirmAction action={setCustomerArchivedAction} fields={{ id, archived: "true" }} label="Archive"
                  title="Archive this customer?" confirmLabel="Archive"
                  description="Archived customers are hidden from lists but their jobs, estimates and history are kept. You can restore them later." />
              )
            ) : null}
          </>
        }
      />
      <div className="space-y-3">
        {sp.created ? <Alert tone="success">Customer added.</Alert> : null}
        {sp.updated ? <Alert tone="success">Customer updated.</Alert> : null}
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Contact" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-ink-subtle">Email</dt><dd className="text-ink">{customer.email ?? "—"}</dd></div>
              <div><dt className="text-ink-subtle">Phone</dt><dd className="text-ink">{customer.phone ?? "—"}</dd></div>
              <div><dt className="text-ink-subtle">Address</dt><dd className="text-ink">{address || "—"}</dd></div>
              <div><dt className="text-ink-subtle">Customer since</dt><dd className="text-ink">{formatDate(customer.createdAt)}</dd></div>
              {customer.notes ? <div><dt className="text-ink-subtle">Notes</dt><dd className="whitespace-pre-wrap text-ink">{customer.notes}</dd></div> : null}
            </dl>
          </CardBody>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <CustomerRelated ctx={ctx} customerId={id} archived={Boolean(customer.archivedAt)} />
          {can(ctx.role, "audit.view") ? (
            <Card>
              <CardHeader title="Activity" />
              <CardBody>
                {activity.length === 0 ? <p className="text-sm text-ink-muted">No activity recorded.</p> : (
                  <ol className="space-y-2 text-sm">
                    {activity.map((a, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2">
                        <span className="text-ink">{humanize(a.action)}{a.actorName ? <span className="text-ink-muted"> by {a.actorName}</span> : null}</span>
                        <time className="text-ink-subtle">{formatDateTime(a.at)}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
