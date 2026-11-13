import "server-only";
import { supabaseAdmin } from "@/server/supabase/admin";

export const ATTACHMENTS_BUCKET = "job-attachments";
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const SIGNED_URL_TTL_SECONDS = 120;

/**
 * Private object storage (Supabase Storage). Callers MUST authorize the request
 * against the database (RLS) before calling any function here.
 */
export async function putObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
}

export async function createSignedUrl(path: string, seconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const { data, error } = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`could not sign url: ${error?.message}`);
  return data.signedUrl;
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin().storage.from(ATTACHMENTS_BUCKET).remove(paths);
  if (error) console.error("[storage] remove failed", error.message);
}
