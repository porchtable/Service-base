import { Badge } from "@/components/ui/feedback";
import type { FollowUpKind, FollowUpStatus } from "@/server/jobs/follow-ups";

export const KIND_LABELS: Record<FollowUpKind, string> = {
  initial_delivery: "Estimate email",
  automatic_reminder: "Automatic reminder",
  manual_reminder: "Manual reminder",
};
const TONE: Record<FollowUpStatus, "neutral" | "info" | "success" | "danger" | "warning"> = {
  pending: "info", processing: "info", sent: "success", failed: "danger", cancelled: "neutral",
};
const LABEL: Record<FollowUpStatus, string> = { pending: "Scheduled", processing: "Sending", sent: "Sent", failed: "Failed", cancelled: "Cancelled" };

export function FollowUpStatusBadge({ status, delivery }: { status: FollowUpStatus; delivery?: string | null }) {
  if (status === "sent" && delivery && ["delivered", "bounced", "complained", "failed", "delivery_delayed"].includes(delivery)) {
    const map: Record<string, ["success" | "danger" | "warning", string]> = {
      delivered: ["success", "Delivered"], bounced: ["danger", "Bounced"], complained: ["danger", "Marked as spam"],
      failed: ["danger", "Delivery failed"], delivery_delayed: ["warning", "Delayed"],
    };
    return <Badge tone={map[delivery][0]}>{map[delivery][1]}</Badge>;
  }
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}

export function cancelReasonLabel(reason: string | null): string {
  if (!reason) return "";
  const map: Record<string, string> = {
    estimate_accepted: "customer accepted", estimate_declined: "customer declined", estimate_expired: "estimate expired",
    estimate_superseded: "estimate revised", estimate_decided: "customer responded", cancelled_by_user: "cancelled by your team",
    follow_ups_disabled: "follow-ups turned off",
  };
  return map[reason] ?? reason.replace(/_/g, " ");
}
