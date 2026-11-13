import { createAuthUser, adminSql } from "./db";
import { createOrganization, loadTenantCtx } from "@/server/domain/organizations";
import type { TenantCtx } from "@/server/auth/tenant-context";
import type { Role } from "@/lib/permissions";

export async function createCompany(name: string) {
  const owner = await createAuthUser({ fullName: `${name} Owner` });
  const orgId = await createOrganization(owner, { name, industry: "hvac" });
  const ctx = (await loadTenantCtx(owner, orgId))!;
  return { orgId, owner, ctx };
}

export async function addMember(orgId: string, role: Role): Promise<TenantCtx> {
  const u = await createAuthUser({ fullName: `${role} user` });
  await adminSql`insert into public.organization_members (organization_id, user_id, role) values (${orgId}, ${u.userId}, ${role})`;
  return (await loadTenantCtx(u, orgId))!;
}
