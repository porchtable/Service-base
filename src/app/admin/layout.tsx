import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/platform";
import { logoutAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: { template: "%s · Platform admin", default: "Platform admin" } };

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/operations", label: "Jobs & email" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/config", label: "Configuration" },
  { href: "/admin/requests", label: "Data requests" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b-4 border-accent-400 bg-brand-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-sm font-semibold">Platform administration</p>
          <nav aria-label="Admin" className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded px-2 py-1 text-brand-100 hover:bg-brand-800 hover:text-white">{n.label}</Link>)}
          </nav>
          <div className="flex items-center gap-3 text-xs text-brand-200">
            <span>{admin.email}</span>
            <Link href="/app" className="hover:text-white">App</Link>
            <form action={logoutAction}><button className="hover:text-white">Sign out</button></form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
