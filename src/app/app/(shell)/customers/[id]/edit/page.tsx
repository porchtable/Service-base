import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody } from "@/components/ui/card";
import { CustomerForm } from "@/components/app/customer-form";
import { updateCustomerAction } from "@/app/app/_actions/customers";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const customer = await getCustomer(ctx, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  return (
    <>
      <PageHeader title={`Edit ${customer.name}`} back={<Link href={`/app/customers/${id}`} className="text-brand-500 hover:underline">← Back to customer</Link>} />
      <Card><CardBody><CustomerForm action={updateCustomerAction} customer={customer} cancelHref={`/app/customers/${id}`} /></CardBody></Card>
    </>
  );
}
