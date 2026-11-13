import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { safeEqual } from "@/server/tokens";
import { processFollowUps } from "@/server/jobs/follow-ups";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background job entry point. Call every few minutes from a scheduler
 * (Vercel Cron, Supabase pg_cron + pg_net, or any external cron) with
 *   Authorization: Bearer <CRON_SECRET>
 * Safe to call concurrently; jobs are claimed with SKIP LOCKED.
 */
async function handle(req: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  let total = { expired: 0, claimed: 0, sent: 0, cancelled: 0, retrying: 0, failed: 0 };
  // Drain in batches while time allows.
  for (let i = 0; i < 10 && Date.now() - started < 45_000; i++) {
    const s = await processFollowUps({ limit: 25 });
    total = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, v + s[k as keyof typeof s]])) as typeof total;
    if (s.claimed < 25) break;
  }
  return NextResponse.json({ ok: true, ...total, ms: Date.now() - started });
}

export const GET = handle;
export const POST = handle;
