"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject } from "@/lib/schemas";
import { assertPlatformAdmin, processAccountDeletion, setConfigFlag, upsertPlan } from "@/server/admin/platform";
import { runAction, type ActionResult } from "@/server/errors";

export async function setFlagAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const admin = await assertPlatformAdmin();
    await setConfigFlag(admin, String(fd.get("key") ?? ""), fd.get("value") === "true");
    revalidatePath("/admin/config");
  }, "Setting saved");
}

export async function savePlanAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const admin = await assertPlatformAdmin();
    const id = fd.get("id") ? z.uuid().parse(fd.get("id")) : null;
    await upsertPlan(admin, id, formToObject(fd));
    revalidatePath("/admin/config");
  }, "Plan saved");
}

export async function resolveDeletionAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const admin = await assertPlatformAdmin();
    await processAccountDeletion(admin, String(fd.get("id") ?? ""), fd.get("approve") === "true", String(fd.get("note") ?? "") || undefined);
    revalidatePath("/admin/requests");
  });
}
