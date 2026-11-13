"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject } from "@/lib/schemas";
import { requireUser } from "@/server/auth/session";
import { actionContext, setActiveOrganizationCookie } from "@/server/auth/context";
import { createOrganization, listMemberships, updateFollowUpSettings, updateOrganizationSettings } from "@/server/domain/organizations";
import { acceptInvitation } from "@/server/domain/members";
import { runAction, invalid, type ActionResult } from "@/server/errors";

export async function createOrganizationAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const user = await requireUser();
  const res = await runAction(async () => {
    const orgId = await createOrganization({ userId: user.id, email: user.email }, formToObject(fd));
    await setActiveOrganizationCookie(orgId);
  });
  if (!res.ok) return res;
  redirect("/app?welcome=1");
}

export async function switchOrganizationAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = z.uuid().safeParse(fd.get("organizationId"));
  if (orgId.success) {
    const memberships = await listMemberships({ userId: user.id, email: user.email });
    if (memberships.some((m) => m.organizationId === orgId.data)) {
      await setActiveOrganizationCookie(orgId.data);
    }
  }
  redirect("/app");
}

export async function acceptInvitationAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const user = await requireUser();
  const res = await runAction(async () => {
    const token = String(fd.get("token") ?? "");
    if (!token) throw invalid("Missing invitation token");
    const orgId = await acceptInvitation({ userId: user.id, email: user.email }, token);
    await setActiveOrganizationCookie(orgId);
  });
  if (!res.ok) return res;
  redirect("/app");
}

export async function updateOrganizationSettingsAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const ctx = await actionContext();
    await updateOrganizationSettings(ctx, formToObject(fd));
    revalidatePath("/app", "layout");
  }, "Company settings saved");
}

export async function updateFollowUpSettingsAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const ctx = await actionContext();
    await updateFollowUpSettings(ctx, formToObject(fd));
    revalidatePath("/app/follow-ups");
  }, "Follow-up settings saved");
}
