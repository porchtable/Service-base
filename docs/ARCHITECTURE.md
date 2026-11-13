# Architecture

Internal repository identifier: `field-service-app`. No product name, logo or tagline
has been chosen; the UI is deliberately neutral and all brand values live in
`src/app/globals.css` (`@theme` tokens) and `src/config/brand.ts`.

## 1. System overview

```
 Browser (contractor staff)          Browser (homeowner / customer)
        │  Supabase SSR cookies               │  /e/<token>  (no account)
        ▼                                     ▼
 ┌──────────────────────── Next.js App Router (Node runtime) ───────────────────────┐
 │ src/proxy.ts           refreshes Supabase session cookies, gates /app & /admin   │
 │ Server Components      read data through the Data Access Layer (src/server/*)    │
 │ Server Actions         validate input (Zod) → authorize → transactional writes   │
 │ Route Handlers         /api/stripe/webhook, /api/cron/*, /api/export, files      │
 └───────────────┬──────────────────────┬───────────────────────┬────────────────────┘
                 │ postgres.js (pooler) │ supabase-js (server)  │ HTTPS (server only)
                 ▼                      ▼                       ▼
     Supabase Postgres (RLS)     Supabase Auth + Storage    Anthropic · Stripe · Resend
                 ▲
                 │ claim_due_follow_ups() / process loop
     Background worker: /api/cron/process-jobs (Vercel Cron or Supabase pg_cron+pg_net)
                        or `npm run worker` (long-running process)
```

### Key decisions

| Decision | Rationale |
|---|---|
| **Data access via `postgres.js` directly to Supabase Postgres**, not the PostgREST Data API | Multi-statement transactions (send estimate = lock version, snapshot, token, schedule follow-ups, audit) must be atomic. Each request runs inside a transaction that does `SET LOCAL ROLE authenticated` and sets `request.jwt.claims`, exactly the mechanism PostgREST uses, so **every query is subject to RLS**. |
| **Supabase Auth via `@supabase/ssr`** | Sessions in HTTP-only cookies; server verifies the user with `auth.getUser()` (authoritative round-trip to Auth, not trusting the cookie payload). |
| **Service-level DB access is isolated** in `src/server/db/service.ts` | Only used by: customer token pages, Stripe webhooks, background worker, platform admin aggregates. Never imported by tenant code paths (lint-enforced by convention and review; grep-able). |
| **`cacheComponents` disabled** | Every page is tenant- and user-specific. Fully dynamic rendering removes any risk of a cached response crossing tenants. |
| **Money as integer cents (`bigint`)**, quantities as `numeric(12,3)`, tax rates in basis points | No floating point in money paths. Totals computed by one server module and re-verified in SQL. |
| **AI never writes prices** | The model returns `{description, quantity, price_book_item_id?}` only. The server attaches prices exclusively from the company price book. Anything unmatched is flagged `needs_review` with `unit_price_cents = NULL`, which blocks approval. |
| **Estimate versions are immutable once sent** | Enforced by database triggers (not only application code). Revisions create a new version; the previous sent version is marked `superseded` and its tokens revoked. |
| **Customer links are opaque random tokens** | 32 random bytes, base64url. Only the SHA-256 hash is stored. Tokens expire with the version and can be revoked. |
| **Postgres-backed job queue** | `follow_up_jobs` rows + `FOR UPDATE SKIP LOCKED` claiming + per-job idempotency key forwarded to Resend. Driven by a cron HTTP endpoint or a worker process; never by the browser. |
| **Postgres-backed rate limiter** | Works across serverless instances without extra infrastructure. |

## 2. Request lifecycle (tenant request)

1. `src/proxy.ts` refreshes the Supabase session cookie and redirects unauthenticated
   requests for `/app/**` and `/admin/**` to `/login`.
2. A Server Component / Action calls `requireOrgContext()` (`src/server/auth/context.ts`):
   - `supabase.auth.getUser()` → verified user (redirect to `/login` if absent)
   - active organization = `active_org` cookie, **validated against `organization_members`**
   - returns `{ user, org, role, permissions }`
3. Mutations call `assertPermission(ctx, 'estimate.send')` (role matrix in
   `src/server/auth/permissions.ts`).
4. Queries run through `withTenant(ctx, async (sql) => …)` which opens a transaction,
   switches to the `authenticated` role and sets JWT claims. RLS then independently
   enforces membership and role (defense in depth: a bug in step 3 still cannot cross
   organizations).
5. Writes append to `audit_events` inside the same transaction.

## 3. Roles and permissions

| Capability | owner | admin | technician |
|---|:-:|:-:|:-:|
| View dashboard, customers, jobs, price book | ✓ | ✓ | ✓ |
| Create / edit customers | ✓ | ✓ | ✓ (create/edit, no archive) |
| Archive customers | ✓ | ✓ | – |
| Create jobs | ✓ | ✓ | ✓ |
| Edit any job / assign technicians | ✓ | ✓ | – |
| Edit observations & status on jobs assigned to self | ✓ | ✓ | ✓ |
| Upload job photos | ✓ | ✓ | ✓ (assigned jobs) |
| Edit price book | ✓ | ✓ | – |
| Create estimate drafts, run AI generation, edit drafts | ✓ | ✓ | ✓ |
| Approve estimates, send estimates, revoke links | ✓ | ✓ | – |
| Manage follow-ups | ✓ | ✓ | – |
| Company settings, invite members | ✓ | ✓ | – |
| Change member roles / remove admins | ✓ | – | – |
| Billing / subscription | ✓ | – | – |
| Data export | ✓ | ✓ | – |

Platform administrators are a separate, explicitly granted capability
(`platform_administrators` table, granted only via SQL / CLI script by an existing
operator). Membership in an organization never implies platform administration.

## 4. Security and RLS design

* **RLS enabled on every table in `public`.** `anon` has no table privileges at all.
  `authenticated` has privileges, filtered by policies.
* Helper functions live in schema `app` (not exposed through the Data API), are
  `SECURITY DEFINER`, `STABLE`, and pin `search_path = ''`:
  * `app.is_member(org_id)`, `app.has_role(org_id, roles[])`, `app.is_platform_admin()`.
* **Cross-organization relationships are impossible at the database level**: every
  child table carries `organization_id` and references its parent with a composite
  foreign key `(parent_id, organization_id) → parent(id, organization_id)`.
  Technician assignment references `organization_members(organization_id, user_id)`.
* **Immutability triggers** on `estimate_versions` / `estimate_line_items`.
* **Append-only** `audit_events` (UPDATE/DELETE rejected by trigger for all roles).
* **Customer estimate access** never uses a user session: the token is hashed and
  looked up by the service connection, which then reads only that version's frozen
  snapshot. Failures return a generic "link unavailable" page (no oracle about
  whether a token existed, expired or was revoked).
* **Decisions are idempotent**: `estimate_decisions.estimate_version_id` is `UNIQUE`;
  the accept/decline action uses `INSERT … ON CONFLICT DO NOTHING` under a row lock.
* **Stripe webhooks**: raw body + `stripe.webhooks.constructEvent` signature check;
  `stripe_events.id` primary key gives exactly-once processing.
* **Email**: each send has an idempotency key (`email_events.idempotency_key` UNIQUE),
  also forwarded to Resend's `Idempotency-Key`.
* **Secrets** are read only in server modules guarded by `import 'server-only'`
  (`src/server/env.ts`). Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key are
  browser-visible.
* **Private storage**: bucket `job-attachments` is private; objects are stored at
  `<organization_id>/<job_id>/<uuid>`; reads are via short-lived signed URLs issued
  after server-side authorization; storage RLS policies also restrict by the first
  path segment.
* **Rate limiting** (`app.rate_limit_hit`) on login, registration, password reset,
  customer token pages, decisions, AI generation and estimate sending.
* **Errors**: server actions return typed `{ ok:false, error }` with safe messages;
  unexpected errors are logged server-side with a correlation id and shown generically.

## 5. Folder structure

```
supabase/
  migrations/              versioned SQL migrations (Supabase CLI compatible)
  config.toml              Supabase CLI project config (auth redirect URLs, templates)
  templates/               auth email templates (token-hash SSR flow)
scripts/
  db-migrate.ts            apply migrations to DATABASE_URL (local/test)
  worker.ts                long-running background worker
  grant-platform-admin.ts  explicit platform admin grant
test/
  db/                      integration tests against real Postgres (RLS, triggers)
  unit/                    pure logic tests
  e2e/                     Playwright specs
  support/                 local Supabase-compat bootstrap + auth emulator (TEST ONLY)
src/
  proxy.ts                 session refresh + route gating
  app/
    (public)/              product info page, login, register, reset, verify
    app/                   authenticated contractor app (/app/...)
    admin/                 platform administration (/admin/...)
    e/[token]/             customer estimate page
    api/                   webhooks, cron, export, attachment download
  components/ui/           design-system primitives (token-driven)
  config/brand.ts          neutral brand configuration (no name)
  lib/                     shared pure logic (money, validation schemas, dates)
  server/
    env.ts                 validated server env (server-only)
    db/                    connection, withTenant, service connection
    auth/                  session, org context, permissions
    supabase/              SSR client factories
    domain/                customers, jobs, pricebook, estimates, followups, billing, admin
    ai/                    estimate generator (Anthropic) + validation
    email/                 transport (Resend) + templates
    ratelimit.ts, audit.ts
```
