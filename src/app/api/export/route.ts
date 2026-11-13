import { NextResponse } from "next/server";
import { getOrgContext } from "@/server/auth/context";
import { exportOrganizationData } from "@/server/domain/data-requests";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getOrgContext().catch(() => null);
  if (!ctx) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await rateLimit("export", ctx.organizationId))) return NextResponse.json({ error: "Too many exports. Try again later." }, { status: 429 });
  try {
    const data = await exportOrganizationData(ctx);
    const name = `export-${ctx.organizationId}-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw err;
  }
}
