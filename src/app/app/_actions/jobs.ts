"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formToObject } from "@/lib/schemas";
import { actionContext } from "@/server/auth/context";
import { createJob, deleteJob, updateJob, updateJobStatus } from "@/server/domain/jobs";
import { deleteAttachment, uploadAttachment } from "@/server/domain/attachments";
import { removeObjects } from "@/server/storage";
import { runAction, invalid, type ActionResult } from "@/server/errors";

export async function createJobAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  let id = "";
  const res = await runAction(async () => {
    id = await createJob(await actionContext(), formToObject(fd));
  });
  if (!res.ok) return res;
  redirect(`/app/jobs/${id}?created=1`);
}

export async function updateJobAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id") ?? "");
  const res = await runAction(async () => {
    await updateJob(await actionContext(), id, formToObject(fd));
  });
  if (!res.ok) return res;
  revalidatePath(`/app/jobs/${id}`);
  redirect(`/app/jobs/${id}?updated=1`);
}

export async function updateJobStatusAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = String(fd.get("id") ?? "");
    await updateJobStatus(await actionContext(), id, String(fd.get("status") ?? ""));
    revalidatePath(`/app/jobs/${id}`);
  }, "Status updated");
}

export async function deleteJobAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    const paths = await deleteJob(await actionContext(), String(fd.get("id") ?? ""));
    await removeObjects(paths);
  });
  if (!res.ok) {
    if (res.code === "validation" && res.error.includes("related record")) {
      return { ...res, error: "This job has estimates and cannot be deleted. Cancel it instead." };
    }
    return res;
  }
  redirect("/app/jobs?deleted=1");
}

export async function uploadAttachmentAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const jobId = String(fd.get("jobId") ?? "");
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw invalid("Choose at least one photo", { file: ["Choose a photo"] });
    if (files.length > 10) throw invalid("Upload at most 10 photos at a time", { file: ["Too many files"] });
    const ctx = await actionContext();
    for (const f of files) await uploadAttachment(ctx, jobId, f, String(fd.get("caption") ?? ""));
    revalidatePath(`/app/jobs/${jobId}`);
  }, "Photos uploaded");
}

export async function deleteAttachmentAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await deleteAttachment(await actionContext(), String(fd.get("id") ?? ""));
    revalidatePath(`/app/jobs/${String(fd.get("jobId") ?? "")}`);
  });
}
