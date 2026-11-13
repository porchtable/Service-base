import "server-only";
import type { Tx } from "@/server/db/client";
import { scheduleFollowUps } from "@/server/jobs/follow-ups";

/** Called inside the send transaction: queues the delivery email and automatic reminders. */
export async function scheduleAfterSend(
  tx: Tx,
  args: { organizationId: string; userId: string | null; versionId: string; sendEmail: boolean },
): Promise<boolean> {
  return scheduleFollowUps(tx, args);
}
