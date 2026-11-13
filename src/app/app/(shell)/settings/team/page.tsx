import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { listMembers, listPendingInvitations } from "@/server/domain/members";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { PageHeader, Badge } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { InviteForm } from "@/components/app/invite-form";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { controlClass } from "@/components/ui/field";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "@/app/app/_actions/members";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireOrgContext();
  const members = await listMembers(ctx);
  const canInvite = can(ctx.role, "member.invite");
  const canManageRoles = can(ctx.role, "member.manage_roles");
  const invitations = canInvite ? await listPendingInvitations(ctx) : [];

  return (
    <>
      <PageHeader title="Team" description="People who can access this company's data." />
      <div className="space-y-6">
        {canInvite ? (
          <Card>
            <CardHeader title="Invite a team member" description="Technicians can create jobs and draft estimates. Admins can also approve and send estimates and manage settings." />
            <CardBody><InviteForm action={inviteMemberAction} /></CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={`Members (${members.length})`} />
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const isSelf = m.userId === ctx.userId;
              const canRemove = isSelf || (canInvite && (m.role === "technician" || ctx.role === "owner"));
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{m.fullName ?? m.email}{isSelf ? <span className="text-ink-subtle"> (you)</span> : null}</p>
                    <p className="text-sm text-ink-muted">{m.email} · joined {formatDate(m.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canManageRoles && !isSelf ? (
                      <ActionForm action={changeRoleAction} className="flex items-center gap-2" showSuccess={false}>
                        <input type="hidden" name="id" value={m.id} />
                        <label htmlFor={`role-${m.id}`} className="sr-only">Role for {m.email}</label>
                        <select id={`role-${m.id}`} name="role" defaultValue={m.role} className={`${controlClass} w-auto py-1`}>
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="technician">Technician</option>
                        </select>
                        <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">Update</SubmitButton>
                      </ActionForm>
                    ) : (
                      <Badge tone={m.role === "owner" ? "accent" : m.role === "admin" ? "info" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                    )}
                    {canRemove ? (
                      <ConfirmAction action={removeMemberAction} fields={{ id: m.id }} size="sm" label={isSelf ? "Leave" : "Remove"}
                        title={isSelf ? "Leave this company?" : `Remove ${m.fullName ?? m.email}?`} confirmLabel={isSelf ? "Leave" : "Remove"}
                        description={isSelf ? "You will lose access to this company's data." : "They will immediately lose access to this company's data. Records they created are kept."} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        {canInvite && invitations.length > 0 ? (
          <Card>
            <CardHeader title="Pending invitations" />
            <ul className="divide-y divide-border">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium text-ink">{i.email}</p>
                    <p className="text-sm text-ink-muted">{ROLE_LABELS[i.role]} · expires {formatDate(i.expiresAt)}</p>
                  </div>
                  <ConfirmAction action={revokeInvitationAction} fields={{ id: i.id }} size="sm" label="Revoke"
                    title={`Revoke the invitation for ${i.email}?`} confirmLabel="Revoke" description="The invitation link will stop working." />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
