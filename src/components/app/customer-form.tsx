import { ActionForm } from "@/components/ui/action-form";
import { TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { LinkButton } from "@/components/ui/button";
import type { Customer } from "@/server/domain/customers";
import type { ActionResult } from "@/lib/action-result";

export function CustomerForm({
  action,
  customer,
  cancelHref,
}: {
  action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
  customer?: Customer;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="space-y-6">
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Customer name" name="name" required defaultValue={customer?.name} autoComplete="off" />
        <TextField label="Company (optional)" name="companyName" defaultValue={customer?.companyName ?? ""} />
        <TextField label="Email" name="email" type="email" defaultValue={customer?.email ?? ""} hint="Used to send estimates and reminders." />
        <TextField label="Phone" name="phone" type="tel" defaultValue={customer?.phone ?? ""} />
      </div>
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Billing address</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Street address" name="addressLine1" defaultValue={customer?.addressLine1 ?? ""} className="sm:col-span-2" />
          <TextField label="Apartment, suite, etc." name="addressLine2" defaultValue={customer?.addressLine2 ?? ""} className="sm:col-span-2" />
          <TextField label="City" name="city" defaultValue={customer?.city ?? ""} />
          <div className="grid grid-cols-2 gap-4">
            <TextField label="State / region" name="region" defaultValue={customer?.region ?? ""} />
            <TextField label="Postal code" name="postalCode" defaultValue={customer?.postalCode ?? ""} />
          </div>
        </div>
      </fieldset>
      <TextAreaField label="Notes" name="notes" defaultValue={customer?.notes ?? ""} hint="Visible to your team only." />
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Saving…">{customer ? "Save changes" : "Add customer"}</SubmitButton>
        <LinkButton href={cancelHref} variant="secondary">Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}
