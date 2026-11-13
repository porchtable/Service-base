import "server-only";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { ConfigurationError, env, requireSetting } from "@/server/env";

export interface OutboundEmail {
  to: string;
  fromName: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
}

export class EmailSendError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "EmailSendError";
  }
}

export interface EmailTransport {
  readonly provider: "resend" | "capture";
  send(message: OutboundEmail, idempotencyKey: string): Promise<{ providerMessageId: string }>;
}

/** Extract the bare address from EMAIL_FROM ("Name <addr@x>" or "addr@x"). */
function fromAddress(): string {
  const raw = requireSetting("EMAIL_FROM", "Email delivery");
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}

function displayName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").slice(0, 70).trim() || "Estimates";
}

const SEND_TIMEOUT_MS = 15_000;

export class ResendTransport implements EmailTransport {
  readonly provider = "resend" as const;
  private client = new Resend(requireSetting("RESEND_API_KEY", "Email delivery"));
  private from = fromAddress();

  async send(m: OutboundEmail, idempotencyKey: string) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new EmailSendError("Email provider timed out", true)), SEND_TIMEOUT_MS));
    const { data, error } = await Promise.race([
      this.client.emails.send(
        {
          from: `"${displayName(m.fromName)}" <${this.from}>`,
          to: [m.to],
          replyTo: m.replyTo ?? undefined,
          subject: m.subject,
          html: m.html,
          text: m.text,
        },
        { idempotencyKey },
      ),
      timeout,
    ]);
    if (error || !data) {
      const status = (error as { statusCode?: number } | null)?.statusCode ?? 0;
      const name = (error as { name?: string } | null)?.name ?? "";
      // Same key already used: the original request was accepted — treat as delivered to provider.
      if (status === 409 && /idempoten/i.test(name)) return { providerMessageId: `idempotent:${idempotencyKey}` };
      const retryable = status === 0 || status === 429 || status >= 500;
      throw new EmailSendError(`Resend error ${status || ""} ${name}`.trim(), retryable);
    }
    return { providerMessageId: data.id };
  }
}

export interface CapturedEmail extends OutboundEmail {
  id: string;
  idempotencyKey: string;
}

/**
 * TEST-ONLY transport: records messages in memory instead of sending them.
 * Refused in production by src/server/env.ts.
 */
export class CaptureTransport implements EmailTransport {
  readonly provider = "capture" as const;
  static outbox: CapturedEmail[] = [];
  private seen = new Map<string, string>();
  async send(m: OutboundEmail, idempotencyKey: string) {
    const existing = this.seen.get(idempotencyKey);
    if (existing) return { providerMessageId: existing };
    const id = `capture_${randomUUID()}`;
    this.seen.set(idempotencyKey, id);
    CaptureTransport.outbox.push({ ...m, id, idempotencyKey });
    return { providerMessageId: id };
  }
}

let shared: EmailTransport | undefined;

export function getEmailTransport(): EmailTransport {
  if (shared) return shared;
  const e = env();
  if (e.EMAIL_TRANSPORT === "capture") {
    if (e.NODE_ENV === "production") throw new ConfigurationError("Email delivery", "capture transport is not allowed in production");
    shared = new CaptureTransport();
  } else {
    shared = new ResendTransport();
  }
  return shared;
}

export function emailConfigured(): boolean {
  try {
    getEmailTransport();
    return true;
  } catch {
    return false;
  }
}
