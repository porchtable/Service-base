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
- ✅ Migration `20261113000300_estimates.sql`: estimates, versions, line items, access tokens,
  decisions; state machine, immutability and approval rules enforced by triggers
- ✅ AI drafting via Claude structured outputs (`claude-opus-5-5`, refusal fallback enabled).
  The model never receives or returns prices; a validated builder prices lines only from
  the active price book and flags unmatched, low-confidence, or pricing/warranty language
- ✅ Technician notes committed before the AI call; failures are recorded, never lose data
- ✅ Editor: price-book lines, custom lines (only owners/admins may price them), quantity
  edits, review flags, scope of work, internal notes, per-estimate tax rate
- ✅ Line and version totals computed in the database; re-verified independently on approval
- ✅ Approval blocked while any line is unpriced or flagged (DB-enforced); owner/admin only
- ✅ Send freezes a snapshot (company, customer, lines, totals, terms) whose total must match
- ✅ Sent versions immutable for every role, including superuser; revisions create new
  versions and supersede/revoke the previous one
- ✅ Customer links: 256-bit random tokens, SHA-256 stored, expiring, revocable, generic
  failure page, `no-referrer`, `noindex`, rate limited
- ✅ Customer accept (typed name + confirmation) / decline; exactly one decision per version
  under concurrency; decisions immutable and applied to the token's version only
- ✅ Schema guard tests: RLS on every table, no anon grants, least-privilege grants,
  pinned `search_path` on SECURITY DEFINER functions (found and fixed two over-broad defaults)
- ✅ Tests: +11 DB tests, +8 AI builder unit tests, +1 e2e (full estimate lifecycle)
- 🟡 Real Anthropic API not exercised (no key provided). AI path verified with a test
  provider; the "not configured" failure path verified end-to-end.

## Phase 4 — Email, follow-ups, dashboard
- ✅ Migration `20261113000400_followups_email.sql`: follow_up_jobs queue, email_events log,
  SKIP LOCKED claim function, stale-lock reclaim, trigger cancelling reminders when a
  version leaves `sent`
- ✅ Resend transport with Idempotency-Key per job; customer-facing emails show the
  contractor's name; HTML-escaped templates; 15 s send timeout
- ✅ Estimate email sent immediately on "Send"; automatic reminders at company-configured
  offsets (skipped past expiry); manual "send reminder now" (throttled 1/hour)
- ✅ Reminders cannot be sent after a decision: the send holds a share lock on the version
  that customer decisions must wait for; decision/expiry/revision cancel pending reminders
- ✅ Duplicate prevention: unique keys per scheduled reminder, SKIP LOCKED claiming,
  deterministic per-job link token, crash recovery that never re-sends
- ✅ Retries with exponential backoff (1 min → 6 h cap), max attempts, permanent-failure
  handling, manual retry; "not configured" recorded as a failure, never as sent
- ✅ Background execution via authenticated cron endpoint, `vercel.json`, or `npm run worker`
- ✅ Resend delivery webhooks (signature-verified) update delivery status
- ✅ Invitation emails sent when email is configured (link still shown to the inviter)
- ✅ Dashboard: customers, active jobs, draft/approved/sent/pending/accepted/declined/expired,
  total quoted, accepted value (labelled as not collected revenue), follow-ups due/failed,
  with period and technician filters
- ✅ Tests: +9 DB tests (scheduling, stop-on-decision, concurrent workers, crash recovery,
  retries, unconfigured email, manual controls, dashboard vs independent SQL), +1 unit,
  +1 e2e
- 🟡 Resend not exercised against the real API (no key). Verified with a capture transport.

## Phase 5 — Billing, admin, deployment
- ✅ Migration `20261113000500_billing_admin.sql`: billing_plans (none seeded), subscriptions,
  stripe_events, platform_config; tenants can read but never write billing data
- ✅ Stripe Checkout (subscription mode, optional first-time trial), Customer Portal,
  plan prices read live from Stripe (never hardcoded); live keys refused without
  `ALLOW_LIVE_BILLING=true`
- ✅ Webhooks: signature-verified, exactly-once (event id recorded in the same transaction
  as its effects), out-of-order protection, cancellation handling, audit trail
- ✅ Feature enforcement (AI drafting, sending) when `billing.enforce_subscription` is on;
  default **off** until plans are approved; reading/exporting never gated
- ✅ Platform admin (explicit CLI grant only, 404 for everyone else): overview counts,
  subscription breakdown, health (DB latency, worker heartbeat, integration status),
  organizations, failed jobs, email failures (masked recipients), audit log (no payloads),
  platform switches (signup, AI kill switch, billing enforcement), plan configuration,
  account-deletion request processing
- ✅ Data export (JSON, owner/admin, rate-limited, audited); account deletion requests with
  orphan-protection; erasure keeps the audit trail but removes the actor reference
- ✅ Health endpoint, error boundary, not-found page, deployment & monitoring guide
- ✅ Tests: +12 DB tests, +3 e2e (admin access, webhook auth/idempotency, export &
  deletion lifecycle), +1 mobile responsive e2e. Found & fixed: account deletion was
  blocked by the append-only audit trigger.
- 🟡 Stripe Checkout/Portal not exercised against Stripe (no account provided); webhook
  processing verified with Stripe's own signature helpers.

## Final verification (this environment)
- TypeScript: pass · ESLint: pass · Unit + DB integration: 86/86 · Playwright e2e:
  13/13 (12 desktop + 1 mobile) · `next build`: pass · client bundles contain no secret
  names or server-only modules
- Acceptance-criteria traceability: `docs/ACCEPTANCE.md`
- **Not production-ready yet**: see `docs/DEPLOYMENT.md` §4 (real-service verification)

## Blockers requiring the owner (provide via secure environment configuration)
- ⛔ Supabase project (URL, publishable key, secret key, DB URL)
- ⛔ Anthropic API key
- ⛔ Resend API key + verified sending domain
- ⛔ Stripe test-mode account, Products/Prices you define, webhook secret
- ⛔ Hosting account and approval to deploy
- ⛔ Approval of subscription plans/prices (none have been created or enabled)
- ⛔ Generated secrets: `CRON_SECRET`, `ESTIMATE_LINK_SECRET`

## Production-readiness audit (2026-11-13)
- ✅ 9 findings fixed (2 high, 4 medium, 3 low) — details in `docs/AUDIT.md`
- ✅ Migration `20261113000600_security_hardening.sql` (column-level grants, system-column
  guard, totals re-derivation, FK indexes)
- ✅ HttpOnly/Secure session cookies, baseline CSP, production-build e2e suite
- ✅ 101/101 unit+DB, 14+1 skipped dev e2e, 9/9 production-build e2e, 0 npm vulnerabilities
- ⬜ Invoices and customer payment collection are not built (not in original spec)
