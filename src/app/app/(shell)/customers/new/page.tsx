import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/server/auth/context";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody } from "@/components/ui/card";
import { CustomerForm } from "@/components/app/customer-form";
import { createCustomerAction } from "@/app/app/_actions/customers";

export const metadata: Metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  await requireOrgContext();
  return (
    <>
      <PageHeader title="Add customer" back={<Link href="/app/customers" className="text-brand-500 hover:underline">← Customers</Link>} />
      <Card><CardBody><CustomerForm action={createCustomerAction} cancelHref="/app/customers" /></CardBody></Card>
    </>
  );
}
