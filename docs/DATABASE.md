# Database schema

PostgreSQL (Supabase). Migrations: `supabase/migrations/*.sql`, applied in filename
order and recorded in `supabase_migrations.schema_migrations` (same table the Supabase
CLI uses).

| Migration | Phase | Contents |
|---|---|---|
| `20261113000100_foundation.sql` | 1 | tenancy, roles, profiles, invitations, customers, audit, rate limits, platform admins, data requests |
| `20261113000200_jobs_pricebook.sql` | 2 | jobs, job attachments, price book, private storage bucket |
| `20261113000300_estimates.sql` | 3 | estimates, versions, line items, access tokens, decisions, immutability triggers |
| `20261113000400_followups_email.sql` | 4 | follow-up queue, email events, dashboard metrics |
| `20261113000500_billing_admin.sql` | 5 | billing plans, subscriptions, Stripe events, platform config |

## Conventions

* Primary keys: `uuid default gen_random_uuid()`.
* Every tenant table has `organization_id uuid not null` and `unique (id, organization_id)`
  so children can reference `(parent_id, organization_id)` — **a row can never point at
  another organization's row**.
* Money: `bigint` cents. Quantities: `numeric(12,3)`. Tax: integer basis points.
* Timestamps: `timestamptz`, `created_at`/`updated_at` maintained by trigger.
* Text columns have explicit length `CHECK`s.
* RLS is enabled on every table in `public`; `anon` has no privileges.

## Tables

### Tenancy & identity
| Table | Purpose / key constraints |
|---|---|
| `profiles` | 1:1 with `auth.users` (created by trigger). Name/email for team display. Visible to self and co-members. |
| `organizations` | Contractor company. Settings: tax rate (bps), estimate validity days, company-written terms, follow-up offsets, per-org job/estimate counters. |
| `organization_members` | `(organization_id, user_id)` unique; role `owner/admin/technician`. Trigger guarantees ≥1 owner and owner-only owner changes. |
| `organization_invitations` | SHA-256 token hash, email, role (never owner), 7-day expiry, single use, revocable. Accept requires verified matching email. |
| `platform_administrators` | Explicit grant table for SaaS operators. Users can only read their own row; no write policy. |

### Customers & work
| Table | Purpose / key constraints |
|---|---|
| `customers` | Contact & billing address, notes, `archived_at`. Generated `tsvector` for search. Archive restricted to owner/admin by trigger. |
| `jobs` | Customer (composite FK), service address, equipment fields, description, technician observations, status, assigned technician (FK to membership in same org), appointment, internal notes, per-org job number. Technicians may only edit field-work columns on jobs assigned to them (trigger). |
| `job_attachments` | Private photo metadata; object path `<org>/<job>/<uuid>`; image MIME + 15 MB limits. |
| `price_book_items` | Name (unique per org, case-insensitive), description, category, `unit_price_cents ≥ 0`, unit, active flag, tax class. |

### Estimates
| Table | Purpose / key constraints |
|---|---|
| `estimates` | Header: job + customer (FK to job's own customer), per-org number, `current_version_id`, mirrored status. |
| `estimate_versions` | `draft → approved → sent → accepted/declined/expired/superseded`. Technician notes (preserved input), AI metadata, server-computed subtotal/tax/total, approval & send stamps, `expires_at`, frozen `snapshot` JSON. **Trigger-enforced immutability after send.** Approval blocked while any line is unpriced or flagged. |
| `estimate_line_items` | Optional price-book link, description, quantity, unit price (NULL = missing → blocks approval), DB-computed line total, tax class, source `ai/manual/price_book`, `needs_review` + reason. Writable only while the version is a draft. |
| `estimate_access_tokens` | SHA-256 hash only, expiry, revocation, last use. |
| `estimate_decisions` | `UNIQUE (estimate_version_id)` → exactly one decision per version; signer name, comment, IP, user agent. |

### Operations
| Table | Purpose / key constraints |
|---|---|
| `follow_up_jobs` | Queue: kind (`initial_delivery`, `automatic_reminder`, `manual_reminder`), schedule, status, attempts/backoff, lock owner, `UNIQUE idempotency_key`, unique `(version, kind, sequence)` for automatic jobs. Auto-cancelled by trigger when the version leaves `sent`. |
| `email_events` | Every outbound email: category, recipient, provider message id, delivery status (updated by Resend webhooks), `UNIQUE idempotency_key`. |
| `audit_events` | Append-only (trigger) activity log for users, customers, system, Stripe, platform admins. |
| `rate_limit_buckets` | Fixed-window counters (service role only). |
| `data_requests` | Data export and account-deletion requests with resolution workflow. |

### Billing & platform
| Table | Purpose / key constraints |
|---|---|
| `billing_plans` | Operator-configured plans referencing Stripe Price IDs. **No rows are seeded; no prices are invented.** |
| `subscriptions` | One per organization; Stripe customer/subscription ids, status, period end, cancel flags, last applied event timestamp (out-of-order protection). |
| `stripe_events` | Processed webhook event ids (exactly-once). |
| `platform_config` | Operator settings (e.g. subscription enforcement on/off). Service role only. |
