import "server-only";
import { can, type Permission, type Role } from "@/lib/permissions";
import { forbidden } from "@/server/errors";

/** Resolved, verified caller context for tenant-scoped operations. */
export interface TenantCtx {
  userId: string;
  email: string | null;
  organizationId: string;
  role: Role;
}

export function assertCan(ctx: TenantCtx, permission: Permission): void {
  if (!can(ctx.role, permission)) throw forbidden();
}
