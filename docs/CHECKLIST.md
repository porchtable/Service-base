# Implementation checklist

Legend: ✅ implemented and verified by automated tests · 🟡 implemented, verification
limited (reason given) · ⬜ not started · ⛔ blocked on an external account/credential

## Phase 0 — Planning
- ✅ Architecture, security/RLS design, folder structure — `docs/ARCHITECTURE.md`
- ✅ Database schema — `docs/DATABASE.md`
- ✅ External accounts & environment variables — `docs/ENVIRONMENT.md`, `.env.example`

## Phase 1 — Foundation
- ✅ Next.js 16 / TypeScript / Tailwind 4 project, centralized design tokens, no brand
- ✅ Versioned migration `20261113000100_foundation.sql` + migration runner
- ✅ RLS on all tables; `anon` has no table access; helper functions in private `app` schema
- ✅ Registration, email verification (token-hash SSR flow), login, logout, password reset
- ✅ Protected routes (proxy + server-side re-verification)
- ✅ Organization onboarding; owner/admin/technician roles; permission matrix
- ✅ Multiple organizations per user with explicit, server-validated active organization
- ✅ Invitations (hashed single-use tokens, 7-day expiry, verified matching email)
- ✅ Role changes / removal with last-owner protection (DB trigger)
- ✅ Company profile & estimate defaults (tax in basis points, validity, company terms)
- ✅ Customers: add, edit, search, archive/restore, activity history
- ✅ Append-only audit log
- ✅ Postgres-backed rate limiting (login, registration, reset, invitations)
- ✅ Tests: 15 DB integration tests (tenant isolation, RLS, roles, invitations, audit) and
  6 Playwright e2e tests (auth lifecycle, password reset, protected routes, persistence,
  cross-company access)
- 🟡 Auth verified against a **test-only Supabase Auth emulator** (Supabase Docker images
  unavailable in the build environment). Must be re-run against a real Supabase project.
- 🟡 Invitation emails: link is shown to the inviter to share; email delivery is wired up
  in Phase 4.

## Phase 2 — Jobs, technicians, attachments, price book
- ✅ Migration `20261113000200_jobs_pricebook.sql`: jobs, job_attachments, price_book_items,
  private `job-attachments` bucket (no browser storage policies), RLS
- ✅ Cross-organization references impossible: composite FKs for customer, technician
  (membership), attachments (+ storage path CHECK) — verified even as superuser
- ✅ Jobs: create/edit/delete, statuses, per-company job numbers, time-zone-aware
  appointments, equipment details, description, technician observations, internal notes
- ✅ Technician assignment; technicians limited to field-work columns on their own jobs
  (DB trigger + app checks); internal notes hidden from technicians
- ✅ Private photos: magic-byte content validation, 15 MB limit, server-side authorization,
  2-minute signed URLs via an authorized redirect route, orphan cleanup
- ✅ Price book: integer-cent prices, units, categories, tax class, active/inactive,
  owner/admin-only edits, price-change audit trail
- ✅ Exact money math module (BigInt scaled quantities, half-away-from-zero rounding)
- ✅ Tests: +20 unit/DB tests (money, time zones, cross-org FKs, technician guard, price book
  RLS) and +1 e2e (invite technician → assignment → observations → photo upload/view,
  content-sniff rejection, cross-company/anonymous photo access denied)
- 🟡 Storage verified against the test-only emulator; re-verify on real Supabase Storage.

## Phase 3 — Estimates
- ⬜ AI draft generation (structured output, price-book matching, flags), notes preserved on failure
- ⬜ Editor, approval, server totals, versioning, immutability, secure customer links, decisions

## Phase 4 — Email, follow-ups, dashboard
- ⬜ Resend transport, email events, retry, idempotency, delivery webhooks
- ⬜ Follow-up queue/worker/cron, auto-cancel, manual controls
- ⬜ Full business dashboard with filters

## Phase 5 — Billing, admin, deployment
- ⬜ Stripe Checkout/portal/webhooks, plan config, enforcement
- ⬜ Platform administration
- ⬜ Data export / account deletion workflows
- ⬜ Deployment preparation & monitoring

## Blockers requiring the owner
- ⛔ Supabase project (URL, publishable key, secret key, DB URL)
- ⛔ Anthropic API key
- ⛔ Resend API key + verified sending domain
- ⛔ Stripe test-mode account, Products/Prices you define, webhook secret
- ⛔ Hosting account and approval to deploy
