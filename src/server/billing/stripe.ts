import "server-only";
import Stripe from "stripe";
import { z } from "zod";
import { env, requireSetting } from "@/server/env";
import { withService } from "@/server/db/service";
import type { Tx } from "@/server/db/client";
import { assertCan, type TenantCtx } from "@/server/auth/tenant-context";
import { auditSystem } from "@/server/audit";
import { conflict, invalid } from "@/server/errors";

let client: Stripe | undefined;

export function stripe(): Stripe {
  if (!client) {
    const key = requireSetting("STRIPE_SECRET_KEY", "Billing");
    // env() already refuses live keys unless ALLOW_LIVE_BILLING=true.
    client = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "field-service-app" } });
  }
  return client;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  stripePriceId: string;
  trialDays: number | null;
  isActive: boolean;
}

export async function listActivePlans(): Promise<Plan[]> {
  const rows = await withService((tx) => tx`select * from public.billing_plans where is_active order by sort_order, name`);
  return rows.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, stripePriceId: r.stripe_price_id, trialDays: r.trial_days, isActive: r.is_active }));
}

/** Price shown to customers comes from Stripe itself — never hardcoded. */
export async function describeStripePrice(priceId: string): Promise<string | null> {
  try {
    const price = await stripe().prices.retrieve(priceId);
    if (price.unit_amount === null) return null;
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency.toUpperCase() }).format(price.unit_amount / 100);
    return price.recurring ? `${amount} / ${price.recurring.interval_count > 1 ? `${price.recurring.interval_count} ` : ""}${price.recurring.interval}` : amount;
  } catch {
    return null;
  }
}

async function ensureCustomer(ctx: TenantCtx): Promise<string> {
  const existing = await withService((tx) => tx`select stripe_customer_id from public.subscriptions where organization_id = ${ctx.organizationId}`);
  if (existing[0]?.stripe_customer_id) return existing[0].stripe_customer_id as string;
  const [org] = await withService((tx) => tx`select name, email from public.organizations where id = ${ctx.organizationId}`);
  const customer = await stripe().customers.create(
    { name: org.name, email: org.email ?? ctx.email ?? undefined, metadata: { organization_id: ctx.organizationId } },
    { idempotencyKey: `customer-create:${ctx.organizationId}` },
  );
  await withService((tx) => tx`
    insert into public.subscriptions (organization_id, stripe_customer_id) values (${ctx.organizationId}, ${customer.id})
    on conflict (organization_id) do update set stripe_customer_id = coalesce(public.subscriptions.stripe_customer_id, excluded.stripe_customer_id)`);
  return customer.id;
}

export async function createCheckoutSession(ctx: TenantCtx, planId: string): Promise<string> {
  assertCan(ctx, "billing.manage");
  z.uuid().parse(planId);
  const [plan] = await withService((tx) => tx`select * from public.billing_plans where id = ${planId} and is_active`);
  if (!plan) throw invalid("That plan is not available");
  const [sub] = await withService((tx) => tx`select status, trial_used from public.subscriptions where organization_id = ${ctx.organizationId}`);
  if (sub && ["active", "trialing", "past_due"].includes(sub.status)) {
    throw conflict("This company already has a subscription. Use “Manage billing” to change it.");
  }
  const customer = await ensureCustomer(ctx);
  const site = env().NEXT_PUBLIC_SITE_URL;
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: ctx.organizationId,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    subscription_data: {
      metadata: { organization_id: ctx.organizationId, plan_id: plan.id },
      ...(plan.trial_days && !sub?.trial_used ? { trial_period_days: plan.trial_days } : {}),
    },
    metadata: { organization_id: ctx.organizationId },
    success_url: `${site}/app/billing?checkout=success`,
    cancel_url: `${site}/app/billing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(ctx: TenantCtx): Promise<string> {
  assertCan(ctx, "billing.manage");
  const [sub] = await withService((tx) => tx`select stripe_customer_id from public.subscriptions where organization_id = ${ctx.organizationId}`);
  if (!sub?.stripe_customer_id) throw conflict("There is no billing account yet. Choose a plan first.");
  const session = await stripe().billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${env().NEXT_PUBLIC_SITE_URL}/app/billing`,
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.payment_failed",
]);

function toDate(sec: number | null | undefined): Date | null {
  return typeof sec === "number" ? new Date(sec * 1000) : null;
}

async function orgForCustomer(tx: Tx, customerId: string | null, metadataOrg?: string | null): Promise<string | null> {
  if (metadataOrg && z.uuid().safeParse(metadataOrg).success) {
    const [o] = await tx`select id from public.organizations where id = ${metadataOrg}`;
    if (o) return o.id as string;
  }
  if (!customerId) return null;
  const [s] = await tx`select organization_id from public.subscriptions where stripe_customer_id = ${customerId}`;
  return (s?.organization_id as string) ?? null;
}

async function applySubscription(tx: Tx, sub: Stripe.Subscription, eventCreated: Date): Promise<string | null> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const orgId = await orgForCustomer(tx, customerId, sub.metadata?.organization_id);
  if (!orgId) return null;
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const [plan] = priceId ? await tx`select id from public.billing_plans where stripe_price_id = ${priceId}` : [];
  // Out-of-order protection: ignore events older than the last one applied.
  await tx`
    insert into public.subscriptions as s (organization_id, stripe_customer_id, stripe_subscription_id, plan_id, stripe_price_id, status,
      current_period_end, cancel_at_period_end, canceled_at, trial_end, trial_used, last_event_created)
    values (${orgId}, ${customerId}, ${sub.id}, ${plan?.id ?? null}, ${priceId}, ${sub.status},
      ${toDate(item?.current_period_end)}, ${sub.cancel_at_period_end}, ${toDate(sub.canceled_at)}, ${toDate(sub.trial_end)},
      ${sub.trial_end !== null}, ${eventCreated})
    on conflict (organization_id) do update set
      stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
      plan_id = excluded.plan_id, stripe_price_id = excluded.stripe_price_id, status = excluded.status,
      current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
      canceled_at = excluded.canceled_at, trial_end = excluded.trial_end, trial_used = s.trial_used or excluded.trial_used,
      last_event_created = excluded.last_event_created
    where s.last_event_created is null or s.last_event_created <= excluded.last_event_created`;
  return orgId;
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

/**
 * Verifies the Stripe signature, then processes each event exactly once. The
 * event id is recorded in the same transaction as its effects, so a failure
 * rolls both back and Stripe's retry is processed normally; a replay of an
 * already-processed event is acknowledged without side effects.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret) return { status: 503, body: { error: "Stripe webhooks are not configured" } };
  if (!signature) return { status: 400, body: { error: "missing signature" } };
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return { status: 400, body: { error: "invalid signature" } };
  }
  if (!HANDLED.has(event.type)) return { status: 200, body: { received: true, ignored: event.type } };

  return withService(async (tx) => {
    const inserted = await tx`
      insert into public.stripe_events (id, type, stripe_created_at) values (${event.id}, ${event.type}, ${toDate(event.created)})
      on conflict (id) do nothing returning id`;
    if (inserted.length === 0) return { status: 200, body: { received: true, duplicate: true } };

    const created = toDate(event.created)!;
    let orgId: string | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
        orgId = await orgForCustomer(tx, customerId, s.client_reference_id ?? s.metadata?.organization_id);
        if (orgId && customerId) {
          await tx`
            insert into public.subscriptions (organization_id, stripe_customer_id) values (${orgId}, ${customerId})
            on conflict (organization_id) do update set stripe_customer_id = excluded.stripe_customer_id`;
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        orgId = await applySubscription(tx, event.data.object as Stripe.Subscription, created);
        break;
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null;
        orgId = await orgForCustomer(tx, customerId);
        break;
      }
    }
    await tx`update public.stripe_events set processed_at = now(), organization_id = ${orgId} where id = ${event.id}`;
    if (orgId) {
      await auditSystem(tx, { organizationId: orgId, actorType: "stripe", action: `billing.${event.type}`, entityType: "subscription", metadata: { event_id: event.id } });
    }
    return { status: 200, body: { received: true } };
  });
}
