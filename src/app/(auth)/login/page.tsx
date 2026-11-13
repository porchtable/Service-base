import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/feedback";
import { loginAction } from "../actions";
import { safeNextPath } from "@/server/request";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Sign in</h1>
      <div className="mt-4 space-y-3">
        {sp.signed_out ? <Alert tone="success">You have been signed out.</Alert> : null}
        {sp.link === "invalid" ? <Alert tone="warning">That link is invalid or has expired. Sign in or request a new link.</Alert> : null}
      </div>
      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className="text-brand-500 hover:underline">Forgot password?</Link>
        <Link href="/register" className="text-brand-500 hover:underline">Create an account</Link>
      </div>
    </>
  );
}
