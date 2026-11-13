import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/server/auth/context";
import { CUSTOMER_PAGE_SIZE, listCustomers } from "@/server/domain/customers";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Badge } from "@/components/ui/feedback";
import { LinkButton, Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { formatAddress } from "@/lib/format";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const status = sp.status === "archived" ? "archived" : sp.status === "all" ? "all" : "active";
  const { customers, total, page } = await listCustomers(ctx, { q: sp.q, status, page: sp.page });
  const pages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), status, page: String(p) })}`;

  return (
    <>
      <PageHeader title="Customers" description={`${total} ${status === "active" ? "active " : ""}customer${total === 1 ? "" : "s"}`}
        actions={<LinkButton href="/app/customers/new" variant="primary">Add customer</LinkButton>} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search customers</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Search name, email, phone, address…" className={`${controlClass} max-w-sm`} />
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className={`${controlClass} w-auto`}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {customers.length === 0 ? (
        <EmptyState
          title={sp.q ? "No customers match your search" : status === "archived" ? "No archived customers" : "No customers yet"}
          description={sp.q ? "Try a different name, email or phone number." : "Add your first customer to start creating jobs and estimates."}
          action={!sp.q && status === "active" ? <LinkButton href="/app/customers/new" variant="primary">Add customer</LinkButton> : undefined}
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {customers.map((c) => (
              <li key={c.id}>
                <Link href={`/app/customers/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-muted">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{c.name}{c.companyName ? <span className="font-normal text-ink-muted"> · {c.companyName}</span> : null}</p>
                    <p className="truncate text-sm text-ink-muted">{[c.email, c.phone, formatAddress([c.addressLine1, c.city])].filter(Boolean).join(" · ") || "No contact details"}</p>
                  </div>
                  {c.archivedAt ? <Badge>Archived</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qs(page - 1)} className="text-brand-500 hover:underline">← Previous</Link> : <span />}
          <span className="text-ink-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={qs(page + 1)} className="text-brand-500 hover:underline">Next →</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
