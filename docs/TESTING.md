# Testing

| Command | What it runs |
|---|---|
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run test:unit` | Pure logic tests (money math, AI output validation, webhook verification, …) |
| `npm run test:db` | Integration tests against **real PostgreSQL** with the real migrations and RLS |
| `npm run test:e2e` | Playwright against the real Next.js app |

## Database integration tests

`test/support/global-setup.ts` drops and recreates the local database `fsa_test`, loads
`test/support/supabase-compat.sql` (a **test-only** recreation of the Supabase `auth` /
`storage` schemas, roles and `auth.uid()`), then applies every migration. Tests then run as
the `authenticated` role with JWT claims — the same mechanism Supabase's Data API uses — so
RLS policies and triggers are exercised for real.

Requirements: PostgreSQL 15+ listening on `127.0.0.1:54322` with user `postgres` /
password `postgres` (override with `TEST_DATABASE_URL`). With the Supabase CLI you can use
`supabase start`, which exposes the same port.

## End-to-end tests

Playwright starts two servers:

1. `test/support/supabase-emulator.ts` — a **TEST-ONLY** emulator of the Supabase Auth and
   Storage REST endpoints the app calls. It exists because Supabase's Docker images could
   not be pulled in the build environment. Users live in the real local `auth.users` table;
   confirmation / recovery emails are captured and exposed at `GET /__emails`.
2. `next dev` on port 3100 with `EMAIL_TRANSPORT=capture` (emails are recorded in the
   database instead of being sent; refused in production).

**Before launch, run the e2e suite against a real Supabase project** (staging) to confirm
behaviour against the genuine Auth service and email templates.
