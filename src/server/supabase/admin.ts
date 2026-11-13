import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, requireSetting } from "@/server/env";

let client: SupabaseClient | undefined;

/**
 * PRIVILEGED Supabase client (secret/service key). Server-only. Used for private
 * Storage operations after server-side authorization, and Auth admin operations
 * (account deletion). Never use it to read tenant tables.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(env().NEXT_PUBLIC_SUPABASE_URL, requireSetting("SUPABASE_SECRET_KEY", "Supabase secret key"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
