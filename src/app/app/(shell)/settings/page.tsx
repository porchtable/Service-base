import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { getOrganization } from "@/server/domain/organizations";
import { can } from "@/lib/permissions";
import { INDUSTRIES, INDUSTRY_LABELS } from "@/lib/schemas";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateOrganizationSettingsAction } from "@/app/app/_actions/organization";

export const metadata: Metadata = { title: "Company settings" };

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Puerto_Rico", "UTC"];

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  if (!can(ctx.role, "org.settings")) redirect("/app");
  const org = await getOrganization(ctx);
  const taxPercent = (org.defaultTaxRateBps / 100).toFixed(2).replace(/\.?0+$/, "");

  return (
    <>
      <PageHeader title="Company settings" description="This information appears on estimates your customers receive." />
      <ActionForm action={updateOrganizationSettingsAction} className="space-y-6">
        <Card>
          <CardHeader title="Company profile" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <TextField label="Company name" name="name" defaultValue={org.name} required />
            <SelectField label="Trade" name="industry" defaultValue={org.industry}>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{INDUSTRY_LABELS[i]}</option>)}
            </SelectField>
            <TextField label="Phone" name="phone" type="tel" defaultValue={org.phone ?? ""} />
            <TextField label="Email" name="email" type="email" defaultValue={org.email ?? ""} hint="Customers can reply to this address." />
            <TextField label="Website" name="website" defaultValue={org.website ?? ""} />
            <SelectField label="Time zone" name="timezone" defaultValue={org.timezone} required>
              {(TIMEZONES.includes(org.timezone) ? TIMEZONES : [org.timezone, ...TIMEZONES]).map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </SelectField>
            <TextField label="Street address" name="addressLine1" defaultValue={org.addressLine1 ?? ""} className="sm:col-span-2" />
            <TextField label="Suite / unit" name="addressLine2" defaultValue={org.addressLine2 ?? ""} className="sm:col-span-2" />
            <TextField label="City" name="city" defaultValue={org.city ?? ""} />
            <div className="grid grid-cols-2 gap-4">
              <TextField label="State / region" name="region" defaultValue={org.region ?? ""} />
              <TextField label="Postal code" name="postalCode" defaultValue={org.postalCode ?? ""} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Estimate defaults" description="Set by your company. AI never chooses tax rates, terms or warranties." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <TextField label="Sales tax rate (%)" name="defaultTaxRatePercent" inputMode="decimal" defaultValue={taxPercent}
              hint="Applied to taxable line items. Use 0 if you don't charge sales tax." />
            <TextField label="Estimates valid for (days)" name="estimateValidityDays" type="number" min={1} max={365} defaultValue={org.estimateValidityDays} required />
            <TextAreaField label="Terms shown on estimates" name="estimateTerms" defaultValue={org.estimateTerms ?? ""} className="sm:col-span-2"
              hint="Your own payment terms, warranty language or disclaimers. Shown exactly as written." />
          </CardBody>
        </Card>
        <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
      </ActionForm>
    </>
  );
}
