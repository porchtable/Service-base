import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { LinkButton } from "@/components/ui/button";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/schemas";
import type { Job } from "@/server/domain/jobs";
import type { ActionResult } from "@/lib/action-result";

export interface JobFormOptions {
  customers: Array<{ id: string; name: string }>;
  technicians: Array<{ userId: string; label: string }>;
  canManage: boolean;
  timeZone: string;
  appointmentLocal: string;
  defaultCustomerId?: string;
  defaultAddress?: { line1: string | null; line2: string | null; city: string | null; region: string | null; postal: string | null };
}

export function JobForm({ action, job, options, cancelHref }: {
  action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
  job?: Job;
  options: JobFormOptions;
  cancelHref: string;
}) {
  const managerOnly = !options.canManage;
  const addr = options.defaultAddress;
  return (
    <ActionForm action={action} className="space-y-6">
      {job ? <input type="hidden" name="id" value={job.id} /> : null}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Job</legend>
        <SelectField label="Customer" name="customerId" required defaultValue={job?.customerId ?? options.defaultCustomerId ?? ""} disabled={Boolean(job) && managerOnly}>
          <option value="" disabled>Choose a customer…</option>
          {options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        {job && managerOnly ? <input type="hidden" name="customerId" value={job.customerId} /> : null}
        <TextField label="Job title" name="title" required defaultValue={job?.title} placeholder="e.g. Upstairs AC not cooling" disabled={Boolean(job) && managerOnly} />
        <SelectField label="Status" name="status" defaultValue={job?.status ?? "new"}>
          {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
        </SelectField>
        {options.canManage ? (
          <SelectField label="Assigned technician" name="assignedTechnicianId" defaultValue={job?.assignedTechnicianId ?? ""}>
            <option value="">Unassigned</option>
            {options.technicians.map((t) => <option key={t.userId} value={t.userId}>{t.label}</option>)}
          </SelectField>
        ) : null}
        {options.canManage ? (
          <TextField label={`Appointment (${options.timeZone})`} name="appointmentLocal" type="datetime-local" defaultValue={options.appointmentLocal} />
        ) : null}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Service address</legend>
        <TextField label="Street address" name="serviceAddressLine1" defaultValue={job?.serviceAddressLine1 ?? addr?.line1 ?? ""} className="sm:col-span-2" />
        <TextField label="Unit / suite" name="serviceAddressLine2" defaultValue={job?.serviceAddressLine2 ?? addr?.line2 ?? ""} className="sm:col-span-2" />
        <TextField label="City" name="serviceCity" defaultValue={job?.serviceCity ?? addr?.city ?? ""} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="State / region" name="serviceRegion" defaultValue={job?.serviceRegion ?? addr?.region ?? ""} />
          <TextField label="Postal code" name="servicePostalCode" defaultValue={job?.servicePostalCode ?? addr?.postal ?? ""} />
        </div>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Equipment</legend>
        <TextField label="Equipment type" name="equipmentType" defaultValue={job?.equipmentType ?? ""} placeholder="e.g. Split AC, gas furnace" />
        <TextField label="Make" name="equipmentMake" defaultValue={job?.equipmentMake ?? ""} />
        <TextField label="Model" name="equipmentModel" defaultValue={job?.equipmentModel ?? ""} />
        <TextField label="Serial number" name="equipmentSerial" defaultValue={job?.equipmentSerial ?? ""} />
        <TextField label="Age (years)" name="equipmentAgeYears" type="number" min={0} max={150} defaultValue={job?.equipmentAgeYears ?? ""} />
        <TextField label="Equipment notes" name="equipmentNotes" defaultValue={job?.equipmentNotes ?? ""} />
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold text-ink">Notes</legend>
        <TextAreaField label="Job description" name="description" defaultValue={job?.description ?? ""} hint="What the customer reported or requested." />
        <TextAreaField label="Technician observations" name="technicianObservations" defaultValue={job?.technicianObservations ?? ""} rows={6}
          hint="What you found on site. Used to draft estimates." />
        {options.canManage ? (
          <TextAreaField label="Internal notes" name="internalNotes" defaultValue={job?.internalNotes ?? ""} hint="Never shown to customers." />
        ) : null}
      </fieldset>
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Saving…">{job ? "Save job" : "Create job"}</SubmitButton>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}
