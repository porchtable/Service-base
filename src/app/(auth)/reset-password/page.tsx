import type { Metadata } from "next";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";
import { getSessionUser } from "@/server/auth/session";
import { resetPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const user = await getSessionUser();
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
      {!user ? (
        <div className="mt-4"><Alert tone="warning">Your reset link has expired or was already used. Request a new one.</Alert></div>
      ) : (
        <ActionForm action={resetPasswordAction} className="mt-6 space-y-4">
          <TextField label="New password" name="password" type="password" autoComplete="new-password" required
            hint="At least 10 characters, including a letter and a number." />
          <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
          <SubmitButton className="w-full" pendingLabel="Saving…">Save password</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
