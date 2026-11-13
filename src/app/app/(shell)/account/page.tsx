import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { getPendingDeletion } from "@/server/domain/data-requests";
import { withUser } from "@/server/db/tenant";
import { formatDate } from "@/lib/format";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { requestDeletionAction, updateProfileAction } from "@/app/app/_actions/account";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const ctx = await requireOrgContext();
  const identity = { userId: ctx.userId, email: ctx.email };
  const [[profile], pending] = await Promise.all([
    withUser(identity, (tx) => tx`select full_name, email from public.profiles where id = ${ctx.userId}`),
    getPendingDeletion(identity),
  ]);
  return (
    <>
      <PageHeader title="Your account" description={profile?.email} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <ActionForm action={updateProfileAction} className="flex flex-wrap items-end gap-3">
              <TextField label="Your name" name="fullName" defaultValue={profile?.full_name ?? ""} required className="min-w-64 flex-1" />
              <SubmitButton variant="secondary" pendingLabel="Saving…">Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Delete your account" description="Your request is reviewed by the platform operator. Company data belongs to the company and stays with it; if you are a company's only owner and it has other members, transfer ownership first." />
          <CardBody>
            {pending ? <Alert tone="info">Deletion requested on {formatDate(pending.created_at)}. It is being reviewed.</Alert> : (
              <ConfirmAction action={requestDeletionAction} fields={{}} label="Request account deletion" title="Request account deletion?" confirmLabel="Submit request"
                description="Your sign-in and personal profile will be deleted once the request is processed. Companies where you are the only member are deleted too.">
                <TextAreaField label="Reason (optional)" name="reason" rows={2} />
              </ConfirmAction>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
