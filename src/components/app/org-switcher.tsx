import { switchOrganizationAction } from "@/app/app/_actions/organization";
import type { Membership } from "@/server/domain/organizations";

export function OrgSwitcher({ memberships, activeId }: { memberships: Membership[]; activeId: string }) {
  if (memberships.length < 2) return null;
  return (
    <form action={switchOrganizationAction} className="flex items-center gap-2">
      <label htmlFor="org-switch" className="sr-only">Active company</label>
      <select id="org-switch" name="organizationId" defaultValue={activeId}
        className="max-w-40 rounded-[var(--radius-control)] border border-brand-700 bg-brand-800 px-2 py-1 text-sm text-white">
        {memberships.map((m) => <option key={m.organizationId} value={m.organizationId}>{m.organizationName}</option>)}
      </select>
      <button className="rounded-[var(--radius-control)] border border-brand-700 px-2 py-1 text-xs text-brand-100 hover:text-white">Switch</button>
    </form>
  );
}
