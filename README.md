# field-service-app

Multi-tenant SaaS for HVAC contractors (extensible to plumbing, electrical, roofing and
other field-service trades): customers, jobs, company price books, AI-assisted estimates,
customer approvals, automated follow-ups, subscriptions and platform administration.

> `field-service-app` is an internal repository identifier only. No product name, logo or
> tagline has been chosen; the interface is intentionally unbranded. Design tokens live in
> `src/app/globals.css` and `src/config/brand.ts`.

**Status:** under active development — see [`docs/CHECKLIST.md`](docs/CHECKLIST.md) for
what is implemented and verified, and what is blocked. Not production-ready; not deployed.

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, roles & permissions, security/RLS design, folder structure |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema and migration plan |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | External accounts and environment variables |
| [docs/TESTING.md](docs/TESTING.md) | Test suites and how they run |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | Running implementation checklist and blockers |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, private
Storage) via `@supabase/ssr` and `postgres.js` · Zod · Anthropic Claude API · Resend ·
Stripe Billing · Vitest · Playwright.

## Local development

Requirements: Node.js 22+, PostgreSQL 15+ (or the Supabase CLI).

```bash
npm install
cp .env.example .env.local            # fill in values (docs/ENVIRONMENT.md)
```

### Option A — real Supabase project (recommended)

1. Create a Supabase project. In **Authentication → URL configuration** set the Site URL
   to `NEXT_PUBLIC_SITE_URL` and add `<site>/auth/confirm` as a redirect URL.
2. In **Authentication → Email templates**, paste `supabase/templates/confirmation.html`
   (Confirm signup) and `supabase/templates/recovery.html` (Reset password). These use the
   SSR token-hash flow handled by `src/app/auth/confirm/route.ts`.
3. Apply migrations: `supabase link --project-ref <ref>` then `supabase db push`.
4. Set `DATABASE_URL` to the transaction pooler connection string.
5. `npm run dev`

### Option B — Supabase CLI locally

`supabase start` (Docker) then `supabase db reset` applies `supabase/migrations`.
Use the printed API URL / keys and `postgres://postgres:postgres@127.0.0.1:54322/postgres`.

### Grant platform administration

Platform admins are never self-service:

```bash
DATABASE_URL=... npm run grant-platform-admin -- operator@example.com
```

## Tests

```bash
npm run typecheck && npm run lint
npm run test        # unit + database integration (needs local Postgres on :54322)
npm run test:e2e    # Playwright (starts the app + a test-only Supabase emulator)
```
