# Deployment preparation & monitoring

**Nothing has been deployed.** Public deployment and live billing require the owner's
explicit approval. This is the checklist to follow once approved.

## 1. Supabase (staging first, then production)

1. Create the project; note URL, publishable key, secret key, and the **transaction
   pooler** connection string (port 6543) for `DATABASE_URL`.
2. `supabase link --project-ref <ref>` → `supabase db push` (applies `supabase/migrations`).
3. Verify the app's database role can switch roles (the first migration attempts this):
   ```sql
   select pg_has_role(current_user, 'authenticated', 'member'),
          pg_has_role(current_user, 'service_role', 'member');   -- both must be true
   ```
4. Auth → URL configuration: Site URL = `NEXT_PUBLIC_SITE_URL`; redirect URL
   `<site>/auth/confirm`. Email templates: paste `supabase/templates/*.html`.
   Configure a custom SMTP (e.g. Resend) for auth emails before launch.
5. Auth → Settings: enable email confirmations; set minimum password length ≥ 10.
6. Storage: confirm bucket `job-attachments` exists and is **private**.
7. Database → Backups: enable PITR for production.

## 2. Hosting (e.g. Vercel)

1. Import the repo; framework Next.js; Node 22.
2. Set every variable from `docs/ENVIRONMENT.md` per environment (Preview vs Production).
   Generate `CRON_SECRET` and `ESTIMATE_LINK_SECRET` with `openssl rand -base64 48`.
3. Cron: `vercel.json` calls `/api/cron/process-jobs` every 5 minutes (or use pg_cron /
   `npm run worker`, see ENVIRONMENT.md).
4. Region: co-locate with the Supabase region.

## 3. Integrations

* **Resend**: verify the sending domain (SPF/DKIM/DMARC); set `EMAIL_FROM`; add webhook
  `<site>/api/resend/webhook` and copy its signing secret to `RESEND_WEBHOOK_SECRET`.
* **Anthropic**: create an API key; set a monthly spend limit in the Console.
* **Stripe (test mode)**: create Products and recurring Prices; register Price IDs in
  `/admin/config`; add webhook `<site>/api/stripe/webhook` for
  `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`,
  `invoice.payment_failed`; enable the Customer Portal. Keep
  `billing.enforce_subscription` **off** until plans are approved.
* **Platform admin**: `DATABASE_URL=… npm run grant-platform-admin -- you@yourdomain.com`.

## 4. Pre-launch verification

* Run `npm run test:e2e` against **staging** (real Supabase Auth/Storage) instead of the
  local emulator, and send one real estimate through Resend to a test inbox.
* Run one real AI draft against staging data and review the output.
* Complete a Stripe test-mode checkout, portal cancellation and webhook replay.
* Review Supabase **Security Advisor** and **Performance Advisor**.
* Confirm `/api/health` returns 200 and the admin overview shows background jobs "ok".

## 5. Monitoring

| Signal | Where |
|---|---|
| Uptime / DB reachability | `GET /api/health` (200 / 503) — point an uptime monitor at it |
| Background job health | `/admin` → "Background jobs last ran" (stale after 15 min), overdue jobs count |
| Failed jobs & email failures | `/admin/operations` (recipients masked) |
| Webhook processing | `/admin` → unprocessed Stripe events |
| Application errors | Hosting logs. Server-side errors are logged with a short reference id that users see (`ref xxxx`), never with secrets or stack traces in the UI. Add an error tracker (e.g. Sentry) before launch if desired. |
| Audit trail | `/admin/audit` (platform) and per-company audit visible to owners/admins |

## Known limitations before launch

* Verified locally against a test-only Supabase emulator, a capture email transport and a
  stubbed AI provider; must be re-verified with real services (section 4).
* Rate limiting keys on `x-forwarded-for`, which is trustworthy on Vercel; behind other
  proxies make sure the header is set by your infrastructure.
* No malware scanning of uploaded photos (content type is verified by magic bytes).
