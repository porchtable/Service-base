import "server-only";
import { withService } from "@/server/db/service";
import { AppError } from "@/server/errors";
import { CONFIG_KEYS, getConfigBool } from "@/server/platform-config";

export const ENTITLED_STATUSES = ["active", "trialing"] as const;

export interface SubscriptionState {
  status: string;
  enforced: boolean;
  entitled: boolean;
  planName: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  hasCustomer: boolean;
}

export async function getSubscriptionState(organizationId: string): Promise<SubscriptionState> {
  const [enforced, rows] = await Promise.all([
    getConfigBool(CONFIG_KEYS.enforceSubscription, false),
    withService((tx) => tx`
      select s.status, s.current_period_end, s.cancel_at_period_end, s.trial_end, s.stripe_customer_id, p.name as plan_name
      from public.subscriptions s left join public.billing_plans p on p.id = s.plan_id
      where s.organization_id = ${organizationId}`),
  ]);
  const s = rows[0];
  const status = (s?.status as string) ?? "none";
  return {
    status,
    enforced,
    entitled: !enforced || (ENTITLED_STATUSES as readonly string[]).includes(status),
    planName: s?.plan_name ?? null,
    currentPeriodEnd: s?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(s?.cancel_at_period_end),
    trialEnd: s?.trial_end ?? null,
    hasCustomer: Boolean(s?.stripe_customer_id),
  };
}

/**
 * Feature gate for paid capabilities (AI drafting, sending estimates). Only
 * enforced when the platform operator turns enforcement on. Reading and
 * exporting existing data is never gated.
 */
export async function requireEntitlement(organizationId: string, feature: string): Promise<void> {
  const state = await getSubscriptionState(organizationId);
  if (!state.entitled) {
    throw new AppError("forbidden", `${feature} requires an active subscription. An owner can subscribe from the Billing page.`);
  }
}
