import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { listPriceBookCategories } from "@/server/domain/pricebook";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody } from "@/components/ui/card";
import { PriceBookForm } from "@/components/app/price-book-form";
import { createPriceBookItemAction } from "@/app/app/_actions/pricebook";

export const metadata: Metadata = { title: "Add price book item" };

export default async function NewPriceBookItemPage() {
  const ctx = await requireOrgContext();
  if (!can(ctx.role, "pricebook.manage")) redirect("/app/price-book");
  return (
    <>
      <PageHeader title="Add price book item" back={<Link href="/app/price-book" className="text-brand-500 hover:underline">← Price book</Link>} />
      <Card><CardBody><PriceBookForm action={createPriceBookItemAction} categories={await listPriceBookCategories(ctx)} /></CardBody></Card>
    </>
  );
}
