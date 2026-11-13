/**
 * Auth cookie options. The app never uses Supabase's browser client, so session
 * cookies are HttpOnly (unreadable by JavaScript, mitigating token theft via XSS)
 * and Secure in production.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
