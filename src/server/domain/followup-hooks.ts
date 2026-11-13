import "server-only";
import type { Tx } from "@/server/db/client";

/**
 * Called inside the send transaction. Queues the initial email delivery and the
 * automatic reminders. Returns whether an email delivery was queued.
 * (Implemented with the follow-up queue in Phase 4.)
 */
export async function scheduleAfterSend(
  _tx: Tx,
  _args: { organizationId: string; userId: string | null; versionId: string; sendEmail: boolean },
): Promise<boolean> {
  return false;
}
