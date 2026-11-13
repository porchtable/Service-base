import { listAllPlans, listConfig, requirePlatformAdmin } from "@/server/admin/platform";
import { PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { savePlanAction, setFlagAction } from "../_actions/admin";

export const metadata = { title: "Configuration" };
const FLAGS = ["billing.enforce_subscription", "features.ai_drafting", "features.signup"];

function PlanForm({ plan }: { plan?: Record<string, unknown> }) {
  const id = plan ? String(plan.id) : "new";
  return (
    <ActionForm action={savePlanAction} className="grid gap-3 sm:grid-cols-3">
      {plan ? <input type="hidden" name="id" value={id} /> : null}
      <TextField label="Key" name="key" id={`${id}-key`} defaultValue={(plan?.key as string) ?? ""} required />
      <TextField label="Name" name="name" id={`${id}-name`} defaultValue={(plan?.name as string) ?? ""} required />
      <TextField label="Stripe Price ID" name="stripePriceId" id={`${id}-price`} defaultValue={(plan?.stripe_price_id as string) ?? ""} required placeholder="price_…" />
      <TextField label="Description" name="description" id={`${id}-desc`} defaultValue={(plan?.description as string) ?? ""} className="sm:col-span-2" />
      <TextField label="Trial days (optional)" name="trialDays" id={`${id}-trial`} defaultValue={plan?.trial_days ? String(plan.trial_days) : ""} />
      <TextField label="Sort order" name="sortOrder" id={`${id}-sort`} defaultValue={String(plan?.sort_order ?? 0)} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={Boolean(plan?.is_active)} className="h-4 w-4" /> Offered to customers</label>
      <div className="flex items-end"><SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">{plan ? "Save plan" : "Add plan"}</SubmitButton></div>
    </ActionForm>
  );
}

export default async function AdminConfig() {
  await requirePlatformAdmin();
  const [config, plans] = await Promise.all([listConfig(), listAllPlans()]);
  return (
    <>
      <PageHeader title="Configuration" />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Platform switches" />
          <CardBody className="space-y-4">
            {config.filter((c) => FLAGS.includes(c.key)).map((c) => (
              <ActionForm key={c.key} action={setFlagAction} className="flex flex-wrap items-center justify-between gap-3" showSuccess={false}>
                <input type="hidden" name="key" value={c.key} />
                <input type="hidden" name="value" value={String(!c.value)} />
                <div><p className="font-mono text-sm text-ink">{c.key} = <strong>{String(c.value)}</strong></p><p className="text-xs text-ink-muted">{c.description}</p></div>
                <SubmitButton size="sm" variant={c.value ? "danger" : "primary"} pendingLabel="…">{c.value ? "Turn off" : "Turn on"}</SubmitButton>
              </ActionForm>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Subscription plans" description="Create Products and recurring Prices in Stripe first, then register each Price ID here. Prices shown to customers are read from Stripe." />
          <CardBody className="space-y-6">
            {plans.map((p) => <PlanForm key={p.id} plan={p} />)}
            <div className="border-t border-border pt-4"><p className="mb-2 text-sm font-semibold">Add a plan</p><PlanForm /></div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
