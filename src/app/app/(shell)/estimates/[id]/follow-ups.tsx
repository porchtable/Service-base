import type { TenantCtx } from "@/server/auth/tenant-context";
import type { EstimateStatus } from "@/server/domain/estimates";

/** Follow-up schedule for a sent version (implemented with the follow-up queue). */
export async function EstimateFollowUps(_props: { ctx: TenantCtx; versionId: string; estimateId: string; status: EstimateStatus; timeZone: string }) {
  return null;
}
