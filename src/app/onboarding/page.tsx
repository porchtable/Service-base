import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { INDUSTRIES, INDUSTRY_LABELS } from "@/lib/schemas";
import { requireUser } from "@/server/auth/session";
import { listMemberships } from "@/server/domain/organizations";
import { createOrganizationAction } from "@/app/app/_actions/organization";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const memberships = await listMemberships({ userId: user.id, email: user.email });
  return (
    <div className="flex min-h-screen items-start justify-center bg-brand-900 px-4 py-16">
      <main id="main" className="w-full max-w-lg rounded-[var(--radius-card)] bg-surface p-6 shadow-xl sm:p-8">
        <h1 className="text-xl font-semibold text-ink">Set up your company</h1>
        <p className="mt-1 text-sm text-ink-muted">
          You&apos;ll be the owner. You can add your team, price book and estimate settings next.
        </p>
        <ActionForm action={createOrganizationAction} className="mt-6 space-y-4">
          <TextField label="Company name" name="name" autoComplete="organization" required />
          <SelectField label="Trade" name="industry" defaultValue="hvac">
            {INDUSTRIES.map((i) => <option key={i} value={i}>{INDUSTRY_LABELS[i]}</option>)}
          </SelectField>
          <SubmitButton className="w-full" pendingLabel="Creating…">Create company</SubmitButton>
        </ActionForm>
        {memberships.length > 0 ? (
          <p className="mt-6 text-sm"><Link href="/app/select-organization" className="text-brand-500 hover:underline">Back to my companies</Link></p>
        ) : (
          <p className="mt-6 text-xs text-ink-subtle">Joining an existing company? Ask its owner or admin to send you an invitation.</p>
        )}
      </main>
    </div>
  );
}
