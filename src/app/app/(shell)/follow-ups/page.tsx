import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { getOrganization } from "@/server/domain/organizations";
import { listFollowUps } from "@/server/jobs/follow-ups";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { FollowUpStatusBadge, KIND_LABELS, cancelReasonLabel } from "@/components/app/follow-up-status";
import { updateFollowUpSettingsAction } from "@/app/app/_actions/organization";
import { cancelFollowUpAction, retryFollowUpAction } from "@/app/app/_actions/followups";

export const metadata: Metadata = { title: "Follow-ups" };
const FILTERS = { upcoming: "Scheduled", sent: "Sent", failed: "Failed", cancelled: "Cancelled", all: "All" } as const;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  if (!can(ctx.role, "followup.manage")) redirect("/app");
  const sp = await searchParams;
  const status = (sp.status && sp.status in FILTERS ? sp.status : "upcoming") as keyof typeof FILTERS;
  const [org, items] = await Promise.all([getOrganization(ctx), listFollowUps(ctx, { status })]);
  return (
    <>
      <PageHeader title="Follow-ups" description="Emails to customers about estimates awaiting a decision. Reminders stop automatically when the customer responds, the estimate expires, or it is revised." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Automatic reminders" />
          <CardBody>
            <ActionForm action={updateFollowUpSettingsAction} className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="followUpEnabled" defaultChecked={org.followUpEnabled} className="h-4 w-4" /> Send automatic reminders
              </label>
              <TextField label="Days after sending" name="followUpOffsetsDays" defaultValue={org.followUpOffsetsDays.join(", ")}
                hint="Comma-separated, e.g. 2, 5, 10. Reminders after the estimate expires are skipped. Applies to estimates sent from now on." />
              <SubmitButton variant="secondary" pendingLabel="Saving…">Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <form className="flex flex-wrap gap-2">
            <label htmlFor="status" className="sr-only">Show</label>
            <select id="status" name="status" defaultValue={status} className={`${controlClass} w-auto`}>
              {Object.entries(FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button type="submit" variant="secondary">Show</Button>
          </form>
          {items.length === 0 ? <EmptyState title="Nothing here" description="Follow-ups appear when you send an estimate by email." /> : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {items.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 text-sm">
                      <p className="text-ink"><Link className="text-brand-500 hover:underline" href={`/app/estimates/${f.estimateId}`}>Estimate #{f.estimateNumber}</Link> · {f.customerName}</p>
                      <p className="text-ink-muted">{KIND_LABELS[f.kind]} · {f.status === "sent" ? `sent ${formatDateTime(f.sentAt, org.timezone)}` : f.status === "cancelled" ? cancelReasonLabel(f.cancelReason) : f.status === "failed" ? (f.lastError ?? "failed") : formatDateTime(f.nextAttemptAt ?? f.scheduledFor, org.timezone)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <FollowUpStatusBadge status={f.status} delivery={f.deliveryStatus} />
                      {f.status === "pending" ? (
                        <ConfirmAction action={cancelFollowUpAction} fields={{ id: f.id }} size="sm" variant="ghost" label="Cancel"
                          title="Cancel this email?" confirmLabel="Cancel email" description="This scheduled email will not be sent." />
                      ) : null}
                      {f.status === "failed" ? (
                        <ActionForm action={retryFollowUpAction} showSuccess={false}>
                          <input type="hidden" name="id" value={f.id} />
                          <SubmitButton size="sm" variant="secondary" pendingLabel="…">Retry</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
