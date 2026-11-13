import "server-only";
import { z } from "zod";
import type { Role } from "@/lib/permissions";
import { invitationSchema } from "@/lib/schemas";
import { withUser, type DbIdentity } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { generateToken, hashToken, looksLikeToken } from "@/server/tokens";

export interface Member {
  id: string;
  userId: string;
  role: Role;
  email: string;
  fullName: string | null;
  createdAt: Date;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

const INVITATION_TTL_DAYS = 7;

export async function listMembers(ctx: TenantCtx): Promise<Member[]> {
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      select m.id, m.user_id, m.role, m.created_at, p.email, p.full_name
      from public.organization_members m
      join public.profiles p on p.id = m.user_id
      where m.organization_id = ${ctx.organizationId}
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, p.full_name nulls last, p.email`;
    return rows.map((r) => ({
      id: r.id, userId: r.user_id, role: r.role, email: r.email, fullName: r.full_name, createdAt: r.created_at,
    }));
  });
}

export async function listTechnicians(ctx: TenantCtx): Promise<Member[]> {
  // Any member can be assigned work; technicians are listed first.
  const members = await listMembers(ctx);
  return [...members].sort((a, b) => Number(b.role === "technician") - Number(a.role === "technician"));
}

export async function listPendingInvitations(ctx: TenantCtx): Promise<PendingInvitation[]> {
  assertCan(ctx, "member.invite");
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      select id, email, role, expires_at, created_at from public.organization_invitations
      where organization_id = ${ctx.organizationId} and accepted_at is null and revoked_at is null and expires_at > now()
      order by created_at desc`;
    return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: r.expires_at, createdAt: r.created_at }));
  });
}

/** Creates an invitation and returns the raw token (shown once / emailed). */
export async function createInvitation(ctx: TenantCtx, input: unknown): Promise<{ invitationId: string; token: string; email: string }> {
  assertCan(ctx, "member.invite");
  const d = invitationSchema.parse(input);
  if (d.role === "admin" && ctx.role !== "owner" && ctx.role !== "admin") throw forbidden();
  const { token, hash } = generateToken();
  return withUser(ctx, async (tx) => {
    const existing = await tx`
      select 1 from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = ${ctx.organizationId} and lower(p.email) = ${d.email}`;
    if (existing.length) throw conflict("That person is already a member of this organization");
    // Replace any pending invitation for the same address.
    await tx`
      update public.organization_invitations set revoked_at = now()
      where organization_id = ${ctx.organizationId} and email = ${d.email} and accepted_at is null and revoked_at is null`;
    const [row] = await tx`
      insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, expires_at)
      values (${ctx.organizationId}, ${d.email}, ${d.role}::public.member_role, ${hash}, ${ctx.userId},
              now() + make_interval(days => ${INVITATION_TTL_DAYS}))
      returning id`;
    await audit(tx, ctx, "member.invited", "organization_invitation", row.id, { email: d.email, role: d.role });
    return { invitationId: row.id as string, token, email: d.email };
  });
}

export async function revokeInvitation(ctx: TenantCtx, invitationId: string): Promise<void> {
  assertCan(ctx, "member.invite");
  z.uuid().parse(invitationId);
  await withUser(ctx, async (tx) => {
    const res = await tx`
      update public.organization_invitations set revoked_at = now()
      where id = ${invitationId} and organization_id = ${ctx.organizationId} and accepted_at is null and revoked_at is null`;
    if (res.count === 0) throw notFound("Invitation");
    await audit(tx, ctx, "member.invitation_revoked", "organization_invitation", invitationId);
  });
}

export async function acceptInvitation(identity: DbIdentity, token: string): Promise<string> {
  if (!looksLikeToken(token)) throw invalid("This invitation link is invalid or has expired");
  try {
    return await withUser(identity, async (tx) => {
      const [row] = await tx`select app.accept_invitation(${hashToken(token)}) as org_id`;
      return row.org_id as string;
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P0002") throw invalid("This invitation link is invalid, has expired, or was sent to a different email address");
    if (code === "42501") throw invalid("Verify your email address before accepting an invitation");
    throw err;
  }
}

export async function changeMemberRole(ctx: TenantCtx, memberId: string, role: Role): Promise<void> {
  assertCan(ctx, "member.manage_roles");
  z.uuid().parse(memberId);
  z.enum(["owner", "admin", "technician"]).parse(role);
  await withUser(ctx, async (tx) => {
    const res = await tx`
      update public.organization_members set role = ${role}::public.member_role
      where id = ${memberId} and organization_id = ${ctx.organizationId}`;
    if (res.count === 0) throw notFound("Member");
    await audit(tx, ctx, "member.role_changed", "organization_member", memberId, { role });
  });
}

export async function removeMember(ctx: TenantCtx, memberId: string): Promise<void> {
  z.uuid().parse(memberId);
  await withUser(ctx, async (tx) => {
    const [target] = await tx`
      select id, user_id, role from public.organization_members
      where id = ${memberId} and organization_id = ${ctx.organizationId}`;
    if (!target) throw notFound("Member");
    const self = target.user_id === ctx.userId;
    if (!self) {
      assertCan(ctx, "member.invite");
      if ((target.role === "owner" || target.role === "admin") && ctx.role !== "owner") throw forbidden();
    }
    // Audit first: once a user removes themselves they are no longer allowed to append.
    await audit(tx, ctx, self ? "member.left" : "member.removed", "organization_member", memberId, { role: target.role });
    await tx`delete from public.organization_members where id = ${memberId}`;
  });
}
