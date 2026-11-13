"use client";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult } from "@/lib/action-result";

export function PhotoUpload({ jobId, action }: { jobId: string; action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>> }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3" encType="multipart/form-data">
      <input type="hidden" name="jobId" value={jobId} />
      <div className="space-y-1">
        <label htmlFor="file" className="block text-sm font-medium text-ink">Photos</label>
        <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple
          className="block w-full text-sm text-ink file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700" />
        <p className="text-xs text-ink-subtle">JPEG, PNG, WebP or HEIC, up to 15 MB each. Stored privately — only your team can view them.</p>
      </div>
      <TextField label="Caption (optional)" name="caption" maxLength={300} />
      <SubmitButton variant="secondary" pendingLabel="Uploading…">Upload photos</SubmitButton>
    </ActionForm>
  );
}
