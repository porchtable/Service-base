"use server";
import { revalidatePath } from "next/cache";
import { actionContext } from "@/server/auth/context";
import { cancelFollowUp, cancelPendingFollowUps, processFollowUps, queueManualReminder, retryFollowUp } from "@/server/jobs/follow-ups";
import { runAction, type ActionResult } from "@/server/errors";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
function refresh(fd: FormData) {
  revalidatePath("/app/follow-ups");
  if (fd.get("estimateId")) revalidatePath(`/app/estimates/${str(fd, "estimateId")}`);
}

export async function sendReminderNowAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const versionId = str(fd, "versionId");
    await queueManualReminder(await actionContext(), versionId);
    await processFollowUps({ versionId, limit: 2 }).catch((err) => console.error("[reminder] immediate delivery failed", err));
    refresh(fd);
  }, "Reminder queued");
}

export async function cancelRemindersAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await cancelPendingFollowUps(await actionContext(), str(fd, "versionId"));
    refresh(fd);
  });
}

export async function cancelFollowUpAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await cancelFollowUp(await actionContext(), str(fd, "id"));
    refresh(fd);
  });
}

export async function retryFollowUpAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await retryFollowUp(await actionContext(), str(fd, "id"));
    refresh(fd);
  });
}
