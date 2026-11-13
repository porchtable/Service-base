import type { Metadata } from "next";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireUser } from "@/server/auth/session";
import { acceptInvitationAction } from "@/app/app/_actions/organization";

export const metadata: Metadata = { title: "Join a company" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/invite/${encodeURIComponent(token)}`);
  return (
    <div className="flex min-h-screen items-start justify-center bg-brand-900 px-4 py-16">
      <main id="main" className="w-full max-w-md rounded-[var(--radius-card)] bg-surface p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-semibold text-ink">Accept invitation</h1>
        <p className="mt-2 text-sm text-ink-muted">
          You&apos;re signed in as <strong>{user.email}</strong>. The invitation must have been sent to this address.
        </p>
        <ActionForm action={acceptInvitationAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="w-full" pendingLabel="Joining…">Join company</SubmitButton>
        </ActionForm>
      </main>
    </div>
  );
}
