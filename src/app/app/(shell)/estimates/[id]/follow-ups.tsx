import type { TenantCtx } from "@/server/auth/tenant-context";
import type { EstimateStatus } from "@/server/domain/estimates";
import { listFollowUps } from "@/server/jobs/follow-ups";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FollowUpStatusBadge, KIND_LABELS, cancelReasonLabel } from "@/components/app/follow-up-status";
import { cancelRemindersAction, retryFollowUpAction, sendReminderNowAction } from "@/app/app/_actions/followups";

export async function EstimateFollowUps({ ctx, versionId, estimateId, status, timeZone }: {
  ctx: TenantCtx; versionId: string; estimateId: string; status: EstimateStatus; timeZone: string;
}) {
  if (status === "draft" || status === "approved") return null;
  const items = await listFollowUps(ctx, { versionId });
  const manage = can(ctx.role, "followup.manage");
  const hasPendingReminders = items.some((i) => i.status === "pending" && i.kind !== "initial_delivery");
  return (
    <Card>
      <CardHeader title="Emails & follow-ups" />
      <CardBody className="space-y-3">
        {items.length === 0 ? <p className="text-sm text-ink-muted">No emails were scheduled for this version (it was sent as a link only).</p> : (
          <ul className="space-y-2 text-sm" data-testid="follow-up-list">
            {items.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-ink">{KIND_LABELS[f.kind]}</p>
                  <p className="text-xs text-ink-subtle">
                    {f.status === "sent" ? `Sent ${formatDateTime(f.sentAt, timeZone)}`
                      : f.status === "cancelled" ? `Not sent — ${cancelReasonLabel(f.cancelReason)}`
                      : f.status === "failed" ? `Failed after ${f.attempts} attempt${f.attempts === 1 ? "" : "s"}: ${f.lastError ?? ""}`
                      : `${f.attempts > 0 ? `Retrying ${formatDateTime(f.nextAttemptAt, timeZone)} (${f.lastError ?? "error"})` : `Scheduled ${formatDateTime(f.scheduledFor, timeZone)}`}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <FollowUpStatusBadge status={f.status} delivery={f.deliveryStatus} />
                  {manage && f.status === "failed" && status === "sent" ? (
                    <ActionForm action={retryFollowUpAction} showSuccess={false}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="estimateId" value={estimateId} />
                      <SubmitButton size="sm" variant="secondary" pendingLabel="…">Retry</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {manage && status === "sent" && items.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <ActionForm action={sendReminderNowAction}>
              <input type="hidden" name="versionId" value={versionId} />
              <input type="hidden" name="estimateId" value={estimateId} />
              <SubmitButton size="sm" variant="secondary" pendingLabel="Sending…">Send reminder now</SubmitButton>
            </ActionForm>
            {hasPendingReminders ? (
              <ConfirmAction action={cancelRemindersAction} fields={{ versionId, estimateId }} size="sm" variant="ghost" label="Stop automatic reminders"
                title="Stop automatic reminders?" confirmLabel="Stop reminders" description="Scheduled reminder emails for this estimate will be cancelled. The customer link keeps working." />
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
