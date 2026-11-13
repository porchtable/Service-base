import { NextResponse } from "next/server";
import { withService } from "@/server/db/service";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for uptime monitoring. Reveals no configuration details. */
export async function GET() {
  const started = Date.now();
  try {
    await withService((tx) => tx`select 1`);
    return NextResponse.json({ ok: true, db: "ok", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, db: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
