# External accounts and environment variables

Nothing below has been provisioned for you. No credentials exist in this repository.
Provide values through your hosting provider's encrypted environment settings
(e.g. Vercel → Project → Settings → Environment Variables) or a local `.env.local`
that is never committed. `.env.example` lists every variable.

## Accounts you need to create

| Service | Needed for | Notes |
|---|---|---|
| **Supabase** project | Postgres, Auth, private Storage | Any plan. Apply migrations with `supabase db push`. Configure Auth email templates (see SETUP.md). |
| **Anthropic** API account | AI estimate drafts | Create an API key in the Claude Console. Without it, the AI button reports "AI drafting is not configured"; manual estimates still work. |
| **Resend** account + verified sending domain | Estimate emails, reminders, invitations | Without it, emails are recorded as failed and visible in admin; nothing is reported as sent. |
| **Stripe** account (test mode) | Subscriptions | Create Products/Prices yourself, then register their Price IDs in Platform admin → Plans. Live mode requires your explicit approval (`ALLOW_LIVE_BILLING=true`). |
| **Hosting** (e.g. Vercel) | Running the app + cron | Not deployed. Requires your approval before any public deployment. |

## Variables

| Variable | Exposed to browser? | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | yes | yes | Absolute base URL used in emailed links |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | yes | Supabase publishable (or legacy anon) key. Safe for browsers; RLS protects data. |
| `SUPABASE_SECRET_KEY` | **no** | yes | Supabase secret (service-role) key — private Storage + Auth admin (account deletion). |
| `DATABASE_URL` | **no** | yes | Postgres connection string. Use the Supabase **transaction pooler** URL (port 6543) in serverless. |
| `DATABASE_POOL_MAX` | no | no | Pool size per server instance (default 5). |
| `ANTHROPIC_API_KEY` | **no** | for AI | Claude API key. |
| `AI_MODEL` | no | no | Defaults to `claude-opus-5-5`. |
| `RESEND_API_KEY` | **no** | for email | Resend API key. |
| `RESEND_WEBHOOK_SECRET` | **no** | for delivery tracking | Signing secret of the Resend webhook pointing at `/api/resend/webhook`. |
| `EMAIL_FROM` | no | for email | e.g. `Estimates <estimates@yourdomain.com>` (verified domain). |
| `EMAIL_TRANSPORT` | no | no | `resend` (default). `capture` is for automated tests and is refused in production. |
| `STRIPE_SECRET_KEY` | **no** | for billing | `sk_test_…` during development. |
| `STRIPE_WEBHOOK_SECRET` | **no** | for billing | Signing secret of the endpoint `/api/stripe/webhook`. |
| `ALLOW_LIVE_BILLING` | no | no | Must be `true` before a `sk_live_` key is accepted. Set only with owner approval. |
| `CRON_SECRET` | **no** | for reminders | Random ≥32 chars. The scheduler calls `/api/cron/process-jobs` with `Authorization: Bearer <CRON_SECRET>`. |

Only the three `NEXT_PUBLIC_*` values are ever bundled into browser code. All other
values are read exclusively in `src/server/env.ts`, which is guarded by `server-only`.
