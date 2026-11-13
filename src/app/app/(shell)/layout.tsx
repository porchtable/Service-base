import { requireOrgContext } from "@/server/auth/context";
import { AppNav } from "@/components/app/nav";
import { OrgSwitcher } from "@/components/app/org-switcher";
import { NAV } from "@/config/navigation";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { logoutAction } from "@/app/(auth)/actions";

export default async function AppShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();
  const items = NAV.filter((i) => !i.requires || can(ctx.role, i.requires)).map(({ href, label }) => ({ href, label }));
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="relative bg-brand-900 text-white lg:min-h-screen">
        <div className="flex h-14 items-center justify-between gap-2 px-4 lg:h-auto lg:flex-col lg:items-stretch lg:py-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={ctx.organizationName}>{ctx.organizationName}</p>
            <p className="hidden text-xs text-brand-200 lg:block">{ROLE_LABELS[ctx.role]}</p>
          </div>
          <AppNav items={items} />
        </div>
        <div className="hidden space-y-3 border-t border-brand-800 px-4 py-4 lg:block">
          <OrgSwitcher memberships={ctx.memberships} activeId={ctx.organizationId} />
          <p className="truncate text-xs text-brand-200" title={ctx.user.email ?? ""}>{ctx.user.email}</p>
          <form action={logoutAction}>
            <button className="text-sm text-brand-100 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 lg:hidden">
          <OrgSwitcher memberships={ctx.memberships} activeId={ctx.organizationId} />
          <form action={logoutAction} className="ml-auto"><button className="text-sm text-ink-muted">Sign out</button></form>
        </div>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
