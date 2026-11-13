import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/server/auth/context";
import { listPriceBook, listPriceBookCategories } from "@/server/domain/pricebook";
import { can } from "@/lib/permissions";
import { formatCents } from "@/lib/format";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { setPriceBookItemActiveAction } from "@/app/app/_actions/pricebook";

export const metadata: Metadata = { title: "Price book" };

export default async function PriceBookPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const status = sp.status === "inactive" ? "inactive" : sp.status === "all" ? "all" : "active";
  const [items, categories] = await Promise.all([
    listPriceBook(ctx, { q: sp.q, category: sp.category || undefined, status }),
    listPriceBookCategories(ctx),
  ]);
  const manage = can(ctx.role, "pricebook.manage");
  return (
    <>
      <PageHeader title="Price book" description="Your company's approved services and prices. Estimates only use prices from here."
        actions={manage ? <LinkButton href="/app/price-book/new" variant="primary">Add item</LinkButton> : undefined} />
      {sp.saved ? <div className="mb-4"><Alert tone="success">Price book saved.</Alert></div> : null}
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Search services…" className={`${controlClass} max-w-xs`} />
        <label htmlFor="category" className="sr-only">Category</label>
        <select id="category" name="category" defaultValue={sp.category ?? ""} className={`${controlClass} w-auto`}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className={`${controlClass} w-auto`}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {items.length === 0 ? (
        <EmptyState title={sp.q || sp.category ? "No matching items" : "Your price book is empty"}
          description="Add the services, parts and labor rates you charge. AI estimate drafts can only use prices listed here."
          action={manage && !sp.q ? <LinkButton href="/app/price-book/new" variant="primary">Add item</LinkButton> : undefined} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Service</th>
                <th scope="col" className="px-4 py-2 font-medium">Category</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Price</th>
                <th scope="col" className="px-4 py-2 font-medium">Tax</th>
                <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{i.name} {!i.isActive ? <Badge>Inactive</Badge> : null}</p>
                    {i.description ? <p className="line-clamp-1 text-ink-muted">{i.description}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{i.category ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{formatCents(i.unitPriceCents)} <span className="text-ink-subtle">/ {i.unit}</span></td>
                  <td className="px-4 py-3 text-ink-muted">{i.taxClass === "taxable" ? "Taxable" : "Not taxable"}</td>
                  <td className="px-4 py-3">
                    {manage ? (
                      <div className="flex justify-end gap-2">
                        <Link href={`/app/price-book/${i.id}`} className="text-brand-500 hover:underline">Edit</Link>
                        <ConfirmAction action={setPriceBookItemActiveAction} fields={{ id: i.id, active: String(!i.isActive) }} size="sm" variant="ghost"
                          label={i.isActive ? "Deactivate" : "Activate"} confirmVariant={i.isActive ? "danger" : "primary"}
                          title={i.isActive ? `Deactivate "${i.name}"?` : `Activate "${i.name}"?`} confirmLabel={i.isActive ? "Deactivate" : "Activate"}
                          description={i.isActive ? "It will no longer be offered for new estimates. Existing estimates are unchanged." : "It will be available for new estimates."} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
