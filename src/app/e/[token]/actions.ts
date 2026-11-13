"use server";
import { revalidatePath } from "next/cache";
import { formToObject } from "@/lib/schemas";
import { recordCustomerDecision } from "@/server/domain/customer-estimates";
import { enforceRateLimit } from "@/server/ratelimit";
import { clientIp, userAgent } from "@/server/request";
import { runAction, invalid, type ActionResult } from "@/server/errors";

export async function decideAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const token = String(fd.get("token") ?? "");
  const res = await runAction(async () => {
    const ip = await clientIp();
    await enforceRateLimit("estimateDecision", ip);
    const outcome = await recordCustomerDecision(token, formToObject(fd), { ip, userAgent: await userAgent() });
    if (outcome.kind === "not_available") {
      throw invalid(outcome.reason === "expired" ? "This estimate has expired and can no longer be accepted or declined." : "This estimate link is no longer available.");
    }
    if (outcome.kind === "already_decided" && !outcome.sameAsRequested) {
      throw invalid(`A response was already recorded for this estimate (${outcome.decision}).`);
    }
    return outcome.decision;
  });
  revalidatePath(`/e/${token}`);
  if (!res.ok) return res;
  return { ok: true, message: res.data === "accepted" ? "Thank you — your acceptance has been recorded." : "Your response has been recorded." };
}
