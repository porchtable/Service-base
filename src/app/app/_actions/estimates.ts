"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formToObject } from "@/lib/schemas";
import { actionContext } from "@/server/auth/context";
import {
  addLineFromPriceBook, addManualLine, approveVersion, createEstimate, createRevision, createShareLink,
  deleteDraftEstimate, deleteLine, reopenVersion, revokeLinks, saveDraftDetails, sendVersion, updateLine,
} from "@/server/domain/estimates";
import { generateDraftWithAi } from "@/server/domain/estimate-ai";
import { enforceRateLimit } from "@/server/ratelimit";
import { runAction, type ActionResult } from "@/server/errors";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const refresh = (fd: FormData) => revalidatePath(`/app/estimates/${str(fd, "estimateId")}`);

export async function createEstimateAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  let id = "";
  const res = await runAction(async () => {
    id = (await createEstimate(await actionContext(), formToObject(fd))).estimateId;
  });
  if (!res.ok) return res;
  redirect(`/app/estimates/${id}`);
}

export async function saveDraftDetailsAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await saveDraftDetails(await actionContext(), str(fd, "versionId"), formToObject(fd));
    refresh(fd);
  }, "Draft saved");
}

export async function generateWithAiAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    const ctx = await actionContext();
    await enforceRateLimit("aiGenerate", ctx.organizationId);
    return generateDraftWithAi(ctx, str(fd, "versionId"), str(fd, "technicianNotes"));
  });
  refresh(fd); // notes and AI status are persisted even on failure
  if (!res.ok) return res;
  const d = res.data!;
  return {
    ok: true,
    message: `AI drafted ${d.linesAdded} line${d.linesAdded === 1 ? "" : "s"}${d.flagged ? `; ${d.flagged} need${d.flagged === 1 ? "s" : ""} review` : ""}.`,
  };
}

export async function addPriceBookLineAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await addLineFromPriceBook(await actionContext(), str(fd, "versionId"), formToObject(fd));
    refresh(fd);
  });
}

export async function addManualLineAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await addManualLine(await actionContext(), str(fd, "versionId"), formToObject(fd));
    refresh(fd);
  });
}

export async function updateLineAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const obj = formToObject(fd) as Record<string, string>;
    if (obj.unitPrice === undefined || obj.unitPrice === obj.originalUnitPrice) delete obj.unitPrice;
    await updateLine(await actionContext(), str(fd, "lineId"), obj);
    refresh(fd);
  }, "Line saved");
}

export async function deleteLineAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await deleteLine(await actionContext(), str(fd, "lineId"));
    refresh(fd);
  });
}

export async function approveAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await approveVersion(await actionContext(), str(fd, "versionId"));
    refresh(fd);
  }, "Estimate approved");
}

export async function reopenAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await reopenVersion(await actionContext(), str(fd, "versionId"));
    refresh(fd);
  });
}

export async function sendAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const ctx = await actionContext();
    await enforceRateLimit("estimateSend", ctx.organizationId);
    const res = await sendVersion(ctx, str(fd, "versionId"), { email: fd.get("sendEmail") === "on" });
    // No revalidation here: the one-time link must stay on screen. The client refreshes on "Done".
    return { link: res.link, emailQueued: res.emailQueued };
  });
}

export async function createLinkAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const link = await createShareLink(await actionContext(), str(fd, "versionId"));
    return { link, emailQueued: false };
  });
}

export async function revokeLinksAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await revokeLinks(await actionContext(), str(fd, "versionId"));
    refresh(fd);
  });
}

export async function reviseAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await createRevision(await actionContext(), str(fd, "estimateId"));
    refresh(fd);
  });
}

export async function deleteEstimateAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    await deleteDraftEstimate(await actionContext(), str(fd, "estimateId"));
  });
  if (!res.ok) return res;
  redirect("/app/estimates?deleted=1");
}
