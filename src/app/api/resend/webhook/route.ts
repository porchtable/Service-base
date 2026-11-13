import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { env } from "@/server/env";
import { withService } from "@/server/db/service";

export const dynamic = "force-dynamic";

const STATUS_BY_EVENT: Record<string, string> = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "failed",
};
// Terminal outcomes may overwrite anything; "delivered"/"delayed" never overwrite a terminal failure.
const TERMINAL = ["bounced", "complained", "failed"];

/** Resend delivery-status webhook (Svix-signed). Updates email_events.status. */
export async function POST(req: NextRequest) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const payload = await req.text();
  let event: { type: string; created_at?: string; data?: { email_id?: string } };
  try {
    const headers = {
      id: req.headers.get("svix-id") ?? "",
      timestamp: req.headers.get("svix-timestamp") ?? "",
      signature: req.headers.get("svix-signature") ?? "",
    };
    event = new Resend("re_unused_for_verification").webhooks.verify({ payload, headers, webhookSecret: secret }) as typeof event;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const status = STATUS_BY_EVENT[event.type];
  const emailId = event.data?.email_id;
  if (!status || !emailId) return NextResponse.json({ ok: true, ignored: true });
  await withService((tx) => tx`
    update public.email_events
       set status = ${status}, last_event_at = ${event.created_at ? new Date(event.created_at) : new Date()},
           error = case when ${TERMINAL.includes(status)} then ${event.type} else error end
     where provider = 'resend' and provider_message_id = ${emailId}
       and (${TERMINAL.includes(status)} or status not in ('bounced', 'complained', 'failed'))`);
  return NextResponse.json({ ok: true });
}
