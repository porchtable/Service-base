"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject } from "@/lib/schemas";
import { actionContext } from "@/server/auth/context";
import { changeMemberRole, createInvitation, removeMember, revokeInvitation } from "@/server/domain/members";
import { enforceRateLimit } from "@/server/ratelimit";
import { runAction, type ActionResult } from "@/server/errors";
import { env } from "@/server/env";
import { sendInvitationEmail } from "@/server/email/invitations";

export async function inviteMemberAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const ctx = await actionContext();
    await enforceRateLimit("invite", ctx.organizationId);
    const inv = await createInvitation(ctx, formToObject(fd));
    const link = `${env().NEXT_PUBLIC_SITE_URL}/invite/${inv.token}`;
    const emailed = await sendInvitationEmail(ctx, { invitationId: inv.invitationId, email: inv.email, link });
    revalidatePath("/app/settings/team");
    return { link, emailed };
  }, "Invitation created");
}

export async function revokeInvitationAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await revokeInvitation(await actionContext(), String(fd.get("id") ?? ""));
    revalidatePath("/app/settings/team");
  });
}

export async function changeRoleAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const role = z.enum(["owner", "admin", "technician"]).parse(fd.get("role"));
    await changeMemberRole(await actionContext(), String(fd.get("id") ?? ""), role);
    revalidatePath("/app/settings/team");
  }, "Role updated");
}

export async function removeMemberAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await removeMember(await actionContext(), String(fd.get("id") ?? ""));
    revalidatePath("/app/settings/team");
  });
}
