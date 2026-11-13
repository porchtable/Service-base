import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { registerAction } from "../actions";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">You&apos;ll verify your email, then set up your company.</p>
      <ActionForm action={registerAction} className="mt-6 space-y-4">
        <TextField label="Your name" name="fullName" autoComplete="name" required />
        <TextField label="Work email" name="email" type="email" autoComplete="email" required />
        <TextField label="Password" name="password" type="password" autoComplete="new-password" required
          hint="At least 10 characters, including a letter and a number." />
        <SubmitButton className="w-full" pendingLabel="Creating account…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-muted">
        Already have an account? <Link href="/login" className="text-brand-500 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
