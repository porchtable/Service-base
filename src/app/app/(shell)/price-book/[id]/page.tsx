import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { getPriceBookItem, listPriceBookCategories } from "@/server/domain/pricebook";
import { can } from "@/lib/permissions";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody } from "@/components/ui/card";
import { PriceBookForm } from "@/components/app/price-book-form";
import { updatePriceBookItemAction } from "@/app/app/_actions/pricebook";

export const metadata: Metadata = { title: "Edit price book item" };

export default async function EditPriceBookItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  if (!can(ctx.role, "pricebook.manage")) redirect("/app/price-book");
  const { id } = await params;
  const item = await getPriceBookItem(ctx, id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  return (
    <>
      <PageHeader title={`Edit ${item.name}`} description="Price changes apply to new estimate lines. Sent estimates never change."
        back={<Link href="/app/price-book" className="text-brand-500 hover:underline">← Price book</Link>} />
      <Card><CardBody><PriceBookForm action={updatePriceBookItemAction} item={item} categories={await listPriceBookCategories(ctx)} /></CardBody></Card>
    </>
  );
}
