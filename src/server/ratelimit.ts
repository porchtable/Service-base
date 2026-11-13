import "server-only";
import { withService } from "@/server/db/service";
import { AppError } from "@/server/errors";

export const LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  estimateView: { limit: 60, windowSeconds: 300 },
  estimateDecision: { limit: 10, windowSeconds: 300 },
  aiGenerate: { limit: 20, windowSeconds: 3600 },
  estimateSend: { limit: 30, windowSeconds: 3600 },
  invite: { limit: 20, windowSeconds: 3600 },
  export: { limit: 5, windowSeconds: 3600 },
} as const;

export type LimitName = keyof typeof LIMITS;

/** Returns true when allowed. Fixed-window counter stored in Postgres (shared across instances). */
export async function rateLimit(name: LimitName, subject: string): Promise<boolean> {
  const { limit, windowSeconds } = LIMITS[name];
  const key = `${name}:${subject}`.slice(0, 200);
  const [row] = await withService((tx) => tx`select app.rate_limit_hit(${key}, ${limit}, ${windowSeconds}) as allowed`);
  return Boolean(row?.allowed);
}

export async function enforceRateLimit(name: LimitName, subject: string): Promise<void> {
  if (!(await rateLimit(name, subject))) {
    throw new AppError("rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  }
}
