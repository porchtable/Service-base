"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { requestAccountDeletion, updateProfileName } from "@/server/domain/data-requests";
import { runAction, type ActionResult } from "@/server/errors";

export async function updateProfileAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const user = await requireUser();
  return runAction(async () => {
    await updateProfileName({ userId: user.id, email: user.email }, String(fd.get("fullName") ?? ""));
    revalidatePath("/app/account");
  }, "Profile saved");
}

export async function requestDeletionAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const user = await requireUser();
  return runAction(async () => {
    await requestAccountDeletion({ userId: user.id, email: user.email }, String(fd.get("reason") ?? ""));
    revalidatePath("/app/account");
  });
}
