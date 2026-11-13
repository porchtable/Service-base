import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { EXTENSIONS, safeFileName, sniffImageType } from "@/lib/file-sniff";
import { withUser } from "@/server/db/tenant";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/errors";
import { MAX_ATTACHMENT_BYTES, createSignedUrl, putObject, removeObjects } from "@/server/storage";

export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  uploadedBy: string | null;
  uploaderName: string | null;
  createdAt: Date;
}

export async function listAttachments(ctx: TenantCtx, jobId: string): Promise<Attachment[]> {
  z.uuid().parse(jobId);
  return withUser(ctx, async (tx) => {
    const rows = await tx`
      select a.*, coalesce(p.full_name, p.email) as uploader_name
      from public.job_attachments a left join public.profiles p on p.id = a.uploaded_by
      where a.job_id = ${jobId} and a.organization_id = ${ctx.organizationId}
      order by a.created_at`;
    return rows.map((r) => ({
      id: r.id, fileName: r.file_name, contentType: r.content_type, sizeBytes: r.size_bytes, caption: r.caption,
      uploadedBy: r.uploaded_by, uploaderName: r.uploader_name, createdAt: r.created_at,
    }));
  });
}

/** Authorize, validate content, upload to private storage, then record metadata (RLS-checked). */
export async function uploadAttachment(ctx: TenantCtx, jobId: string, file: File, caption?: string): Promise<string> {
  assertCan(ctx, "job.attach");
  z.uuid().parse(jobId);
  if (!(file instanceof File) || file.size === 0) throw invalid("Choose a photo to upload", { file: ["Choose a photo"] });
  if (file.size > MAX_ATTACHMENT_BYTES) throw invalid("Photos must be 15 MB or smaller", { file: ["File too large"] });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw invalid("Only JPEG, PNG, WebP or HEIC photos are supported", { file: ["Unsupported file type"] });

  // Authorize before touching storage.
  const [job] = await withUser(ctx, (tx) => tx`
    select assigned_technician_id from public.jobs where id = ${jobId} and organization_id = ${ctx.organizationId}`);
  if (!job) throw notFound("Job");
  if (!can(ctx.role, "job.manage") && job.assigned_technician_id !== ctx.userId) {
    throw forbidden("You can only add photos to jobs assigned to you");
  }

  const path = `${ctx.organizationId}/${jobId}/${randomUUID()}.${EXTENSIONS[type]}`;
  await putObject(path, bytes, type);
  try {
    return await withUser(ctx, async (tx) => {
      const [row] = await tx`
        insert into public.job_attachments (organization_id, job_id, storage_path, file_name, content_type, size_bytes, caption, uploaded_by)
        values (${ctx.organizationId}, ${jobId}, ${path}, ${safeFileName(file.name)}, ${type}, ${bytes.length},
                ${caption?.trim().slice(0, 300) || null}, ${ctx.userId})
        returning id`;
      await audit(tx, ctx, "job.attachment_added", "job", jobId, { attachment_id: row.id });
      return row.id as string;
    });
  } catch (err) {
    await removeObjects([path]); // don't leave orphaned objects
    throw err;
  }
}

/** Returns a short-lived signed URL after RLS confirms the caller may see the attachment. */
export async function attachmentDownloadUrl(ctx: TenantCtx, attachmentId: string): Promise<string> {
  if (!z.uuid().safeParse(attachmentId).success) throw notFound("Attachment");
  const [row] = await withUser(ctx, (tx) => tx`
    select storage_path from public.job_attachments where id = ${attachmentId} and organization_id = ${ctx.organizationId}`);
  if (!row) throw notFound("Attachment");
  return createSignedUrl(row.storage_path as string);
}

export async function deleteAttachment(ctx: TenantCtx, attachmentId: string): Promise<void> {
  z.uuid().parse(attachmentId);
  const path = await withUser(ctx, async (tx) => {
    const [row] = await tx`
      delete from public.job_attachments where id = ${attachmentId} and organization_id = ${ctx.organizationId}
      returning storage_path, job_id`;
    if (!row) throw forbidden("You can only delete photos you uploaded");
    await audit(tx, ctx, "job.attachment_removed", "job", row.job_id, { attachment_id: attachmentId });
    return row.storage_path as string;
  });
  await removeObjects([path]);
}
