import type { TenantCtx } from "@/server/auth/tenant-context";

/** Jobs and estimates for this customer (populated as those modules are added). */
export async function CustomerRelated(_props: { ctx: TenantCtx; customerId: string; archived: boolean }) {
  return null;
}
