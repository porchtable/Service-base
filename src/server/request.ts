import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP for rate limiting/audit (first X-Forwarded-For hop set by the platform). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown").slice(0, 64);
}

export async function userAgent(): Promise<string> {
  return ((await headers()).get("user-agent") ?? "").slice(0, 300);
}

/** Only allow same-site relative redirect targets. */
export function safeNextPath(next: unknown, fallback = "/app"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
