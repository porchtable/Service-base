import { Badge } from "@/components/ui/feedback";
import type { EstimateStatus } from "@/server/domain/estimates";

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft", approved: "Approved", sent: "Sent — awaiting customer", accepted: "Accepted", declined: "Declined",
  expired: "Expired", superseded: "Superseded",
};
const TONES: Record<EstimateStatus, "neutral" | "info" | "accent" | "warning" | "success" | "danger"> = {
  draft: "neutral", approved: "info", sent: "accent", accepted: "success", declined: "danger", expired: "warning", superseded: "neutral",
};

export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  return <Badge tone={TONES[status]}>{ESTIMATE_STATUS_LABELS[status]}</Badge>;
}
