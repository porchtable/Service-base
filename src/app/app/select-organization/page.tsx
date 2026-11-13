import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { listMemberships } from "@/server/domain/organizations";
import { switchOrganizationAction } from "@/app/app/_actions/organization";
import { ROLE_LABELS } from "@/lib/permissions";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Choose a company" };

export default async function SelectOrganizationPage() {
  const user = await requireUser("/app/select-organization");
  const memberships = await listMemberships({ userId: user.id, email: user.email });
  if (memberships.length === 0) redirect("/onboarding");
  return (
    <div className="flex min-h-screen items-start justify-center bg-brand-900 px-4 py-16">
      <main id="main" className="w-full max-w-md rounded-[var(--radius-card)] bg-surface p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-semibold text-ink">Choose a company</h1>
        <p className="mt-1 text-sm text-ink-muted">You belong to more than one company. Pick the one to work in.</p>
        <ul className="mt-6 space-y-2">
          {memberships.map((m) => (
            <li key={m.organizationId}>
              <form action={switchOrganizationAction}>
                <input type="hidden" name="organizationId" value={m.organizationId} />
                <button className="flex w-full items-center justify-between rounded-[var(--radius-control)] border border-border px-4 py-3 text-left hover:border-brand-300 hover:bg-brand-50">
                  <span className="font-medium text-ink">{m.organizationName}</span>
                  <span className="text-xs text-ink-subtle">{ROLE_LABELS[m.role]}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <div className="mt-6"><LinkButton href="/onboarding" variant="ghost" size="sm">+ Create another company</LinkButton></div>
      </main>
    </div>
  );
}
