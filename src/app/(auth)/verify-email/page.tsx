import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { resendVerificationAction } from "../actions";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Check your email</h1>
      <p className="mt-2 text-sm text-ink-muted">
        We sent a confirmation link to your email address. Open it to verify your account, then you can set up your company.
      </p>
      <h2 className="mt-8 text-sm font-semibold text-ink">Didn&apos;t get it?</h2>
      <ActionForm action={resendVerificationAction} className="mt-3 space-y-3" resetOnSuccess>
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        <SubmitButton variant="secondary" pendingLabel="Sending…">Resend confirmation</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm"><Link href="/login" className="text-brand-500 hover:underline">Back to sign in</Link></p>
    </>
  );
}
