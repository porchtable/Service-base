import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/server/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
}

/** Verified current user (validated against Supabase Auth), memoized per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  return {
    id: u.id,
    email: u.email ?? null,
    emailVerified: Boolean(u.email_confirmed_at),
    fullName: (u.user_metadata?.full_name as string | undefined) ?? null,
  };
});

export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  if (!user.emailVerified) redirect("/verify-email");
  return user;
}
