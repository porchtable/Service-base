import type { TenantCtx } from "@/server/auth/tenant-context";
import type { Job } from "@/server/domain/jobs";

/** Estimates for this job (implemented with the estimates module). */
export async function JobEstimates(_props: { ctx: TenantCtx; job: Job }) {
  return null;
}
