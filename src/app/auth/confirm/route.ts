import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { safeNextPath } from "@/server/request";

const ALLOWED: EmailOtpType[] = ["signup", "email", "recovery", "invite", "email_change"];

/**
 * Email link handler (Supabase SSR token-hash flow). Email templates must link to
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>
 * See supabase/templates and docs/SETUP.md.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/app");

  if (tokenHash && type && ALLOWED.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : next, origin));
    }
  }
  return NextResponse.redirect(new URL("/login?link=invalid", origin));
}
