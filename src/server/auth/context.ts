import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/server/auth/session";
import { listMemberships, type Membership } from "@/server/domain/organizations";
import type { TenantCtx } from "@/server/auth/tenant-context";
import { AppError } from "@/server/errors";

export const ACTIVE_ORG_COOKIE = "fsa_active_org";

export interface OrgContext extends TenantCtx {
  user: SessionUser;
  organizationName: string;
  memberships: Membership[];
}

/**
 * Resolves the active organization explicitly: the cookie value is only a hint and
 * is always validated against the user's memberships in the database.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const user = await requireUser();
  const memberships = await listMemberships({ userId: user.id, email: user.email });
  if (memberships.length === 0) return null;
  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.organizationId === preferred) ?? (memberships.length === 1 ? memberships[0] : undefined);
  if (!active) return null;
  return {
    user,
    userId: user.id,
    email: user.email,
    organizationId: active.organizationId,
    organizationName: active.organizationName,
    role: active.role,
    memberships,
  };
});

/** For pages: redirect to onboarding / org selection when there is no active org. */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (ctx) return ctx;
  const user = await requireUser();
  const memberships = await listMemberships({ userId: user.id, email: user.email });
  redirect(memberships.length === 0 ? "/onboarding" : "/app/select-organization");
}

/** For server actions: same resolution, but throws instead of redirecting mid-action. */
export async function actionContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new AppError("unauthenticated", "Select an organization first");
  return ctx;
}

export async function setActiveOrganizationCookie(organizationId: string) {
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
