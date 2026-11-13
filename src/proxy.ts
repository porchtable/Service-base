import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "@/lib/auth-cookies";

const PROTECTED_PREFIXES = ["/app", "/admin", "/onboarding", "/account"];

/**
 * Refreshes the Supabase session cookie on every matched request and redirects
 * unauthenticated visitors away from protected areas. Pages and actions still
 * re-verify the user and their organization role server-side (defense in depth).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  if (!url || !key) {
    return isProtected ? new NextResponse("Authentication is not configured", { status: 503 }) : response;
  }

  const supabase = createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  // getUser() validates the session with Supabase Auth (not just the cookie contents).
  const { data } = await supabase.auth.getUser();

  if (isProtected && !data.user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  if (path.startsWith("/e/")) {
    // Customer estimate links carry a secret token in the URL.
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  } else {
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/resend/webhook|api/cron|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)"],
};
