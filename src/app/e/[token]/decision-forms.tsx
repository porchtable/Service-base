"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

export function DecisionForms({ token, total, action }: {
  token: string;
  total: string;
  action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
}) {
  const [mode, setMode] = useState<"accept" | "decline" | null>(null);
  return (
    <div className="space-y-4">
      {mode === null ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="accent" onClick={() => setMode("accept")}>Accept estimate</Button>
          <Button variant="secondary" onClick={() => setMode("decline")}>Decline</Button>
        </div>
      ) : null}
      {mode === "accept" ? (
        <ActionForm action={action} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="accepted" />
          <TextField label="Your full name" name="signerName" autoComplete="name" required />
          <TextAreaField label="Comments (optional)" name="comment" rows={3} />
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="agree" className="mt-0.5 h-4 w-4" required />
            <span>I accept this estimate for a total of <strong>{total}</strong> and authorize the work described.</span>
          </label>
          <div className="flex gap-2">
            <SubmitButton variant="accent" pendingLabel="Submitting…">Confirm acceptance</SubmitButton>
            <Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
          </div>
        </ActionForm>
      ) : null}
      {mode === "decline" ? (
        <ActionForm action={action} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="declined" />
          <TextField label="Your name (optional)" name="signerName" autoComplete="name" />
          <TextAreaField label="Anything you'd like the company to know? (optional)" name="comment" rows={3} />
          <div className="flex gap-2">
            <SubmitButton variant="danger" pendingLabel="Submitting…">Confirm decline</SubmitButton>
            <Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
