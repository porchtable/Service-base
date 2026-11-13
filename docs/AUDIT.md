# Production-readiness audit — 2026-11-13

Scope: authentication, customers, scheduling (job appointments), estimates, payments
(subscription billing), admin permissions, database security, dependencies, build.
Nothing was deployed; live billing was not enabled.

## Result summary

| Check | Result |
|---|---|
| TypeScript / ESLint | pass / pass |
| Unit + database integration tests (real PostgreSQL, real migrations, RLS) | 101 / 101 |
| End-to-end, development server | 14 passed, 1 skipped (production-only check) |
| End-to-end, **production build** (`next build` + `next start`) | 9 / 9 |
| `npm audit` (production + dev) | 0 vulnerabilities |
| Secrets / server code in browser bundles (build run *with* secrets present) | none |

## Failures found and fixed during this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Any company member could set an estimate's status to "accepted" (or switch its current version / number) directly through Supabase's Data API, bypassing the app. | Column-level grants: only `title` is user-writable (migration `…600_security_hardening`). |
| 2 | High | Draft totals, approval/send stamps and snapshot were directly writable. | Trigger rejects direct writes to system-managed columns; totals re-derived from line items on approval. |
| 3 | Medium | A user could change the email teammates see for them (impersonation in the team list). | Only `full_name`, `phone` writable on profiles. |
| 4 | Medium | Admins could rewrite company counters / creator via the Data API. | Column-level grants on organizations. |
| 5 | Medium | Supabase auth cookies were readable by JavaScript (library default), so any future XSS could steal sessions. | Cookies set `HttpOnly`, `SameSite=Lax`, `Secure` in production; verified in a real production build. |
| 6 | Medium | "Close registrations" switch could be bypassed by signing up through Supabase Auth directly. | Company creation is also gated; see the Supabase setting below. |
| 7 | Low | No Content-Security-Policy. | Baseline CSP (no framing, no plugins, no off-site connections/images); verified the app still works in production mode. |
| 8 | Low | 39 foreign keys without supporting indexes (slow cascades at scale). | Indexes added; schema guard test prevents regressions. |
| 9 | Low | Dev-only dependency advisory (minimatch ReDoS via ESLint). | npm override to the patched version; lint verified. |

New tests: `test/db/audit-direct-api.test.ts` (8 attacks via direct table access, all of
which failed before the fix), `test/db/audit-app-layer.test.ts` (open redirects, brute-force
lockout, invitation expiry/revocation, concurrent numbering, DST scheduling),
`test/e2e/security.spec.ts` (cookie flags, headers, no internal details on errors),
`playwright.prod.config.ts` (production-build suite).

## Area-by-area

| Area | Status | Notes |
|---|---|---|
| Authentication | Pass | Register, verify, login/logout, reset, protected routes, rate limiting, open-redirect protection, HttpOnly sessions. Verified against a test emulator of Supabase Auth. |
| Customer management | Pass | CRUD, search, archive, history, tenant isolation (app + direct API). |
| Scheduling | Pass | Appointments stored in UTC, entered/displayed in the company time zone, DST-safe, ordered lists, technician filters. There is no calendar/dispatch board. |
| Estimates | Pass | AI pricing guarantees, approval rules, immutability, versioning, secure links, single decision under concurrency, follow-ups. |
| Payments — subscriptions | Pass (logic) | Webhook signature, exactly-once, out-of-order handling, entitlement gating. Checkout/Portal need a Stripe account. |
| Admin permissions | Pass | Owner/admin/technician matrix in app and database; platform admin is grant-only (404 otherwise). |
| Database security | Pass | RLS on every table, no anonymous access, least-privilege column grants, pinned `search_path`, append-only audit, indexed FKs. |
| **Invoices** | **Not built** | Was not in the original specification. Accepted estimates are customer approvals, not invoices. |
| **Customer payment collection** | **Not built** | Contractors cannot collect payment from their customers. Needs a product decision (e.g. Stripe Connect) — see report. |

## Cannot be tested without external credentials

* Supabase Auth, email templates and Storage against a real project (verified with a local emulator).
* Real AI drafting quality and the Anthropic API (verified with a stub; "not configured" path verified end-to-end).
* Real email delivery, bounces and delivery webhooks via Resend (verified with a capture transport).
* Stripe Checkout, Customer Portal and live webhook delivery (webhook processing verified with Stripe's signing helpers).
* HTTPS/HSTS behaviour on the real domain, cron scheduling on the host, uptime monitoring.

## Settings to apply in the Supabase dashboard

* To fully close sign-ups, also turn off **Authentication → Providers → Email → Allow new users to sign up** (the in-app switch alone cannot stop direct API sign-ups, though such accounts can no longer create companies).
* Keep **Confirm email** enabled; set minimum password length ≥ 10.
