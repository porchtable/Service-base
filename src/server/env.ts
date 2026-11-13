import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Secrets are only ever read here, in modules guarded by
 * `server-only`, so they can never be bundled into client code.
 *
 * Each integration is validated lazily: the app boots without Stripe/Resend/AI
 * credentials, and the feature that needs a missing credential reports a clear
 * configuration error instead of pretending to work.
 */
const optional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: optional,
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  ANTHROPIC_API_KEY: optional,
  AI_MODEL: z.string().default("claude-opus-5-5"),
  RESEND_API_KEY: optional,
  RESEND_WEBHOOK_SECRET: optional,
  EMAIL_FROM: optional,
  EMAIL_TRANSPORT: z.enum(["resend", "capture"]).default("resend"),
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  CRON_SECRET: optional,
  /** Secret used to derive the customer link included in each queued email (stable across retries). */
  ESTIMATE_LINK_SECRET: optional,
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment configuration: ${fields}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_TRANSPORT === "capture") {
    throw new Error("EMAIL_TRANSPORT=capture is not allowed in production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.STRIPE_SECRET_KEY?.startsWith("sk_live_")
      && process.env.ALLOW_LIVE_BILLING !== "true") {
    throw new Error("Live Stripe keys require ALLOW_LIVE_BILLING=true (explicit owner approval)");
  }
  cached = parsed.data;
  return cached;
}

export class ConfigurationError extends Error {
  constructor(public readonly integration: string, message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function requireSetting<K extends keyof ServerEnv>(key: K, integration: string): NonNullable<ServerEnv[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new ConfigurationError(integration, `${integration} is not configured (missing ${String(key)})`);
  }
  return value as NonNullable<ServerEnv[K]>;
}
