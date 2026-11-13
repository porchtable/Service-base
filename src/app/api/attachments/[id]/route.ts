import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/server/auth/context";
import { attachmentDownloadUrl } from "@/server/domain/attachments";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";

/** Authorizes via the user's session + RLS, then redirects to a 2-minute signed URL. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext().catch(() => null);
  if (!ctx) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  try {
    const signed = await attachmentDownloadUrl(ctx, id);
    const target = new URL(signed, env().NEXT_PUBLIC_SUPABASE_URL);
    return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return new NextResponse("Not found", { status: 404 });
    console.error("[attachments] signing failed", err);
    return new NextResponse("Unavailable", { status: 503 });
  }
}
