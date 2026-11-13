import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { forgotPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-muted">Enter your email and we&apos;ll send you a reset link.</p>
      <ActionForm action={forgotPasswordAction} className="mt-6 space-y-4" resetOnSuccess>
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        <SubmitButton className="w-full" pendingLabel="Sending…">Send reset link</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm"><Link href="/login" className="text-brand-500 hover:underline">Back to sign in</Link></p>
    </>
  );
}
