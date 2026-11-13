import { Badge } from "@/components/ui/feedback";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/schemas";

const JOB_TONES: Record<JobStatus, "neutral" | "info" | "accent" | "warning" | "success" | "danger"> = {
  new: "neutral", scheduled: "info", in_progress: "accent", on_hold: "warning", completed: "success", cancelled: "danger",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={JOB_TONES[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}
