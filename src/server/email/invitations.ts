import "server-only";
import type { TenantCtx } from "@/server/auth/tenant-context";

/**
 * Sends the invitation email when transactional email is configured.
 * Returns false when email is not available; the inviter is then shown the
 * one-time link to share directly. (Wired to the email module in Phase 4.)
 */
export async function sendInvitationEmail(_ctx: TenantCtx, _args: { invitationId: string; email: string; link: string }): Promise<boolean> {
  return false;
}
