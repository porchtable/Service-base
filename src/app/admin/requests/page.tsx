import { listDataRequests, maskEmail, requirePlatformAdmin } from "@/server/admin/platform";
import { formatDateTime } from "@/lib/format";
import { Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { resolveDeletionAction } from "../_actions/admin";

export const metadata = { title: "Data requests" };

export default async function AdminRequests() {
  await requirePlatformAdmin();
  const reqs = await listDataRequests();
  return (
    <>
      <PageHeader title="Data requests" description="Account deletion requests. Approving permanently deletes the user's sign-in and profile." />
      {reqs.length === 0 ? <EmptyState title="No requests" /> : (
        <Card>
          <ul className="divide-y divide-border text-sm">{reqs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-ink">{r.kind} · {maskEmail(r.requester_email)} · {formatDateTime(r.created_at)} <Badge tone={r.status === "pending" ? "warning" : "neutral"}>{r.status}</Badge></p>
                {r.reason ? <p className="text-ink-muted">Reason: {r.reason}</p> : null}
                {r.resolution_note ? <p className="text-ink-muted">Resolution: {r.resolution_note}</p> : null}
              </div>
              {r.status === "pending" && r.kind === "account_deletion" ? (
                <div className="flex gap-2">
                  <ConfirmAction action={resolveDeletionAction} fields={{ id: r.id, approve: "true" }} size="sm" label="Approve & delete" title="Delete this account permanently?" confirmLabel="Delete account" description="This cannot be undone." />
                  <ConfirmAction action={resolveDeletionAction} fields={{ id: r.id, approve: "false" }} size="sm" variant="ghost" confirmVariant="primary" label="Reject" title="Reject this request?" confirmLabel="Reject" />
                </div>
              ) : null}
            </li>
          ))}</ul>
        </Card>
      )}
    </>
  );
}
