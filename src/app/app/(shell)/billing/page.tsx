import type { Metadata } from "next";
import { requireOrgContext } from "@/server/auth/context";
import { getSubscriptionState } from "@/server/billing/entitlements";
import { describeStripePrice, listActivePlans } from "@/server/billing/stripe";
import { env } from "@/server/env";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { checkoutAction, portalAction } from "@/app/app/_actions/billing";

export const metadata: Metadata = { title: "Billing" };

const STATUS_TEXT: Record<string, string> = {
  none: "No subscription", trialing: "Trial", active: "Active", past_due: "Payment past due", canceled: "Canceled",
  unpaid: "Unpaid", incomplete: "Incomplete", incomplete_expired: "Expired", paused: "Paused",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const sp = await searchParams;
  const state = await getSubscriptionState(ctx.organizationId);
  const owner = can(ctx.role, "billing.manage");
  const stripeConfigured = Boolean(env().STRIPE_SECRET_KEY);
  const plans = await listActivePlans();
  const prices = stripeConfigured ? await Promise.all(plans.map((p) => describeStripePrice(p.stripePriceId))) : plans.map(() => null);

  return (
    <>
      <PageHeader title="Billing" description="Your company's subscription." />
      <div className="space-y-6">
        {sp.checkout === "success" ? <Alert tone="success">Thanks! Your subscription will appear here as soon as Stripe confirms it (usually within seconds).</Alert> : null}
        {sp.checkout === "cancelled" ? <Alert tone="info">Checkout was cancelled. No charge was made.</Alert> : null}
        <Card>
          <CardHeader title="Current subscription" />
          <CardBody className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><Badge tone={state.status === "active" || state.status === "trialing" ? "success" : state.status === "none" ? "neutral" : "warning"}>{STATUS_TEXT[state.status] ?? state.status}</Badge>{state.planName ? <span className="text-ink">{state.planName}</span> : null}</p>
            {state.trialEnd && state.status === "trialing" ? <p className="text-ink-muted">Trial ends {formatDate(state.trialEnd)}.</p> : null}
            {state.currentPeriodEnd ? <p className="text-ink-muted">{state.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatDate(state.currentPeriodEnd)}.</p> : null}
            {!state.enforced ? <p className="text-ink-subtle">All features are currently available without a subscription.</p> : !state.entitled ? (
              <Alert tone="warning">AI drafting and sending estimates require an active subscription. Your existing data remains available.</Alert>
            ) : null}
            {owner && state.hasCustomer && stripeConfigured ? (
              <ActionForm action={portalAction} className="pt-2"><SubmitButton variant="secondary" pendingLabel="Opening…">Manage billing</SubmitButton></ActionForm>
            ) : null}
          </CardBody>
        </Card>
        {!owner ? <Alert tone="info">Only owners can change the subscription.</Alert> : !stripeConfigured ? (
          <Alert tone="info" title="Billing is not configured">Online subscriptions are not available yet.</Alert>
        ) : plans.length === 0 ? (
          <EmptyState title="No plans available yet" description="Subscription plans have not been published." />
        ) : state.status === "active" || state.status === "trialing" || state.status === "past_due" ? null : (
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((p, i) => (
              <Card key={p.id}>
                <CardHeader title={p.name} description={p.description ?? undefined} />
                <CardBody className="space-y-3">
                  <p className="text-lg font-semibold text-ink">{prices[i] ?? "Price shown at checkout"}</p>
                  {p.trialDays ? <p className="text-sm text-ink-muted">Includes a {p.trialDays}-day trial (first subscription only).</p> : null}
                  <ActionForm action={checkoutAction}>
                    <input type="hidden" name="planId" value={p.id} />
                    <SubmitButton variant="accent" pendingLabel="Redirecting…">Subscribe</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
