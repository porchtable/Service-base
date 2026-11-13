# Acceptance criteria → automated tests

| # | Requirement | Verified by |
|---|---|---|
| 1 | Register, verify email, log in, log out | `test/e2e/auth.spec.ts` "register → verify email → …", "password reset" |
| 2 | Organizations can be created | `test/db/phase1-tenancy.test.ts` "creates an organization…", e2e auth flow |
| 3 | Company A cannot access Company B's data | `phase1-tenancy` "tenant isolation", `phase2` "cross-organization relationships", `phase3` "isolated between companies", `phase4` dashboard other-company check, e2e `customers.spec.ts`, e2e `phase2.spec.ts` (photos) |
| 4 | Unauthorized users cannot access protected routes | e2e `auth.spec.ts` "unauthenticated users cannot reach protected routes"; role checks throughout DB tests |
| 5 | Customers and jobs persist after refresh | e2e `customers.spec.ts`, `phase2.spec.ts` (reload) |
| 6 | Price-book amounts calculate correctly | `test/unit/money.test.ts`, `phase2` price book cents, `phase3` "computes line, tax and grand totals", e2e `phase3.spec.ts` totals |
| 7 | AI cannot insert unauthorized pricing | `test/unit/ai-draft-builder.test.ts`, `phase3` "cannot insert unauthorized pricing" |
| 8 | Missing prices prevent unreviewed delivery | `phase3` "blocks approval and delivery…", e2e `phase3.spec.ts` |
| 9 | Only authorized users can send estimates | `phase3` "only owners/admins can approve and send" |
| 10 | Sent estimates cannot be modified | `phase3` "makes sent versions immutable — even for privileged database roles" |
| 11 | Decisions apply to the correct version | `phase3` "applies the decision to the correct version" |
| 12 | Expired or revoked links fail securely | `phase3` "fails securely for revoked, expired, malformed and unknown links", e2e `phase3.spec.ts` |
| 13 | Follow-ups stop after a decision | `phase4` "stops follow-ups after a customer decision (13)", "…declined, revised or expires", e2e `phase4.spec.ts` |
| 14 | Duplicate background jobs don't duplicate reminders | `phase4` "never sends duplicates when workers run concurrently or retry after a crash (14)" |
| 15 | Dashboard metrics match database records | `phase4` "dashboard metrics (15)" (vs independent SQL), e2e `phase4.spec.ts` |
| 16 | Stripe webhooks authenticated and idempotent | `phase5` "Stripe webhooks (16)", e2e `phase5.spec.ts` webhook test |
| 17 | Contractors cannot access platform administration | `phase5` "platform administration (17)", e2e `phase5.spec.ts` (404 for contractor) |
| 18 | AI errors do not cause data loss | `phase3` "does not lose technician notes…", `phase5` gating/kill-switch tests, e2e `phase3.spec.ts` |

Also: `test/db/schema-guard.test.ts` (RLS on every table, no anon grants, least-privilege
grants, pinned `search_path`), `test/e2e/responsive.spec.ts` (mobile layout).
