-- ============================================================================
-- Phase 5: billing plans, subscriptions, Stripe event log, platform configuration.
--
-- No plans or prices are seeded. The platform operator creates Products/Prices in
-- Stripe and registers their Price IDs here through Platform admin → Plans.
-- ============================================================================

create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_-]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  stripe_price_id text not null unique check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  trial_days integer check (trial_days between 1 and 90),
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger billing_plans_updated_at before update on public.billing_plans
  for each row execute function app.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  plan_id uuid references public.billing_plans (id) on delete set null,
  stripe_price_id text,
  status text not null default 'none'
    check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_end timestamptz,
  trial_used boolean not null default false,
  last_event_created timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function app.set_updated_at();

create table public.stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null check (char_length(type) <= 100),
  stripe_created_at timestamptz not null,
  organization_id uuid references public.organizations (id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index stripe_events_received_idx on public.stripe_events (received_at desc);

create table public.platform_config (
  key text primary key check (key ~ '^[a-z0-9_.]{2,60}$'),
  value jsonb not null,
  description text check (char_length(description) <= 300),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_config (key, value, description) values
  ('billing.enforce_subscription', 'false', 'When true, AI drafting and sending estimates require an active or trialing subscription.'),
  ('features.ai_drafting', 'true', 'Kill switch for AI estimate drafting across all organizations.'),
  ('features.signup', 'true', 'Allow new account registration.'),
  ('worker.last_run', 'null', 'Timestamp of the most recent background job run (written by the worker).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Privileges & RLS
-- ---------------------------------------------------------------------------
alter table public.billing_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.platform_config enable row level security;

revoke all on public.billing_plans, public.subscriptions, public.stripe_events, public.platform_config from anon, authenticated;
grant select on public.billing_plans, public.subscriptions to authenticated;
grant all on public.billing_plans, public.subscriptions, public.stripe_events, public.platform_config to service_role;

-- Anyone signed in may see active plans; only the server (service role) writes billing data.
create policy billing_plans_select on public.billing_plans for select to authenticated using (is_active);
create policy subscriptions_select on public.subscriptions for select to authenticated using (app.is_member(organization_id));
-- stripe_events / platform_config: no policies → no tenant access at all.

revoke execute on all functions in schema app from public;
