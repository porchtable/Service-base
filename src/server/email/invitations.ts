import "server-only";
import type { TenantCtx } from "@/server/auth/tenant-context";
import { withService } from "@/server/db/service";
import { getEmailTransport } from "@/server/email/transport";
import { invitationEmail } from "@/server/email/templates";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

/**
 * Emails an invitation when transactional email is configured. Returns false
 * (and records a failed email event when possible) otherwise; the inviter is
 * always shown the one-time link to share directly.
 */
export async function sendInvitationEmail(ctx: TenantCtx, args: { invitationId: string; email: string; link: string; role?: Role }): Promise<boolean> {
  let transport;
  try {
    transport = getEmailTransport();
  } catch {
    return false;
  }
  const meta = await withService(async (tx) => {
    const [r] = await tx`
      select o.name as org_name, coalesce(p.full_name, p.email) as inviter, i.role
      from public.organization_invitations i
      join public.organizations o on o.id = i.organization_id
      left join public.profiles p on p.id = ${ctx.userId}
      where i.id = ${args.invitationId} and i.organization_id = ${ctx.organizationId}`;
    return r;
  });
  if (!meta) return false;
  const content = invitationEmail({ orgName: meta.org_name, inviterName: meta.inviter ?? "A teammate", role: ROLE_LABELS[meta.role as Role].toLowerCase(), link: args.link });
  const key = `invitation:${args.invitationId}`;
  const [ev] = await withService((tx) => tx`
    insert into public.email_events (organization_id, category, to_email, subject, provider, idempotency_key)
    values (${ctx.organizationId}, 'invitation', ${args.email}, ${content.subject}, ${transport.provider}, ${key})
    on conflict (idempotency_key) do update set updated_at = now() returning id`);
  try {
    const res = await transport.send({ to: args.email, fromName: meta.org_name, ...content }, key);
    await withService((tx) => tx`update public.email_events set status = 'sent', provider_message_id = ${res.providerMessageId} where id = ${ev.id}`);
    return true;
  } catch (err) {
    await withService((tx) => tx`update public.email_events set status = 'failed', error = ${String((err as Error).message).slice(0, 1000)} where id = ${ev.id}`);
    return false;
  }
}
