"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";
import type { ActionResult } from "@/lib/action-result";

export function InviteForm({ action }: { action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>> }) {
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  return (
    <div className="space-y-4">
      <ActionForm action={action} resetOnSuccess showSuccess={false} className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        onSuccess={(r) => setResult((r.ok ? r.data : null) as { link: string; emailed: boolean } | null)}>
        <TextField label="Email" name="email" type="email" required />
        <SelectField label="Role" name="role" defaultValue="technician">
          <option value="technician">Technician</option>
          <option value="admin">Admin</option>
        </SelectField>
        <SubmitButton pendingLabel="Inviting…">Send invite</SubmitButton>
      </ActionForm>
      {result ? (
        <Alert tone="success" title={result.emailed ? "Invitation emailed" : "Invitation created"}>
          <p>{result.emailed ? "We emailed the invitation. You can also share this one-time link:" : "Email delivery is not configured, so share this one-time link with the person directly:"}</p>
          <p className="mt-2 break-all rounded bg-surface px-2 py-1 font-mono text-xs text-ink">{result.link}</p>
          <p className="mt-1 text-xs">The link expires in 7 days and only works for the invited email address.</p>
        </Alert>
      ) : null}
    </div>
  );
}
