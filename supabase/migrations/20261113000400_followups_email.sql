-- ============================================================================
-- Phase 4: email delivery log, follow-up queue, automatic cancellation.
--
-- Reliability model:
--   * Every outbound customer email is a row in follow_up_jobs with a UNIQUE
--     idempotency_key that is also sent to Resend as its Idempotency-Key.
--   * Workers claim due jobs with FOR UPDATE SKIP LOCKED (no double-claiming);
--     stale claims are reclaimed after 10 minutes.
--   * When a version leaves 'sent' (decision, expiry, supersede), pending
--     reminders are cancelled by trigger in the same transaction.
-- ============================================================================

create table public.follow_up_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  estimate_version_id uuid not null,
  kind text not null check (kind in ('initial_delivery', 'automatic_reminder', 'manual_reminder')),
  sequence integer not null default 0 check (sequence >= 0),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text check (char_length(locked_by) <= 100),
  last_error text check (char_length(last_error) <= 1000),
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 100),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  email_event_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (estimate_version_id, organization_id) references public.estimate_versions (id, organization_id) on delete cascade
);
create unique index follow_up_jobs_unique_scheduled
  on public.follow_up_jobs (estimate_version_id, kind, sequence) where kind <> 'manual_reminder';
create index follow_up_jobs_due_idx on public.follow_up_jobs ((coalesce(next_attempt_at, scheduled_for))) where status = 'pending';
create index follow_up_jobs_processing_idx on public.follow_up_jobs (locked_at) where status = 'processing';
create index follow_up_jobs_org_idx on public.follow_up_jobs (organization_id, status, scheduled_for);
create trigger follow_up_jobs_updated_at before update on public.follow_up_jobs
  for each row execute function app.set_updated_at();

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  follow_up_job_id uuid references public.follow_up_jobs (id) on delete set null,
  category text not null check (category in ('estimate_delivery', 'estimate_reminder', 'invitation')),
  to_email text not null check (char_length(to_email) <= 254),
  subject text not null check (char_length(subject) <= 300),
  provider text not null check (provider in ('resend', 'capture')),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  error text check (char_length(error) <= 1000),
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_events_org_idx on public.email_events (organization_id, created_at desc);
create index email_events_status_idx on public.email_events (status, created_at desc);
create unique index email_events_provider_message_uq on public.email_events (provider, provider_message_id) where provider_message_id is not null;
create trigger email_events_updated_at before update on public.email_events
  for each row execute function app.set_updated_at();

alter table public.follow_up_jobs
  add constraint follow_up_jobs_email_event_fk foreign key (email_event_id) references public.email_events (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Cancel pending follow-ups as soon as a version is no longer awaiting a decision.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_follow_ups_on_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.follow_up_jobs
    set status = 'cancelled', cancelled_at = now(), cancel_reason = 'estimate_' || new.status::text,
        locked_at = null, locked_by = null
    where estimate_version_id = new.id and status = 'pending';
  return null;
end $$;
create trigger estimate_versions_cancel_follow_ups
  after update of status on public.estimate_versions
  for each row when (old.status = 'sent' and new.status <> 'sent')
  execute function app.cancel_follow_ups_on_status();

-- ---------------------------------------------------------------------------
-- Worker claim: atomically lease due jobs (service role only).
-- ---------------------------------------------------------------------------
create or replace function app.claim_follow_up_jobs(p_limit integer, p_worker text, p_version uuid default null)
returns setof public.follow_up_jobs
language sql security definer set search_path = '' as $$
  update public.follow_up_jobs j
     set status = 'processing', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
   where j.id in (
     select id from public.follow_up_jobs
      where ((status = 'pending' and coalesce(next_attempt_at, scheduled_for) <= now())
          or (status = 'processing' and locked_at < now() - interval '10 minutes'))
        and (p_version is null or estimate_version_id = p_version)
      order by coalesce(next_attempt_at, scheduled_for)
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning j.*
$$;
revoke all on function app.claim_follow_up_jobs(integer, text, uuid) from public;
grant execute on function app.claim_follow_up_jobs(integer, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Privileges & RLS
-- ---------------------------------------------------------------------------
alter table public.follow_up_jobs enable row level security;
alter table public.email_events enable row level security;

revoke all on public.follow_up_jobs, public.email_events from anon, authenticated;
grant select, insert, update on public.follow_up_jobs to authenticated;
grant select on public.email_events to authenticated;
grant all on public.follow_up_jobs, public.email_events to service_role;

create policy follow_ups_select on public.follow_up_jobs for select to authenticated
  using (app.is_member(organization_id));
create policy follow_ups_insert on public.follow_up_jobs for insert to authenticated
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]) and status = 'pending' and attempts = 0);
create policy follow_ups_update on public.follow_up_jobs for update to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- Tenants may only cancel or re-queue; delivery outcomes are written by the worker.
create or replace function app.guard_follow_up_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.estimate_version_id <> old.estimate_version_id or new.organization_id <> old.organization_id
     or new.idempotency_key <> old.idempotency_key or new.kind <> old.kind or new.sent_at is distinct from old.sent_at
     or new.email_event_id is distinct from old.email_event_id then
    raise exception 'follow-up identity and delivery fields are immutable' using errcode = '42501';
  end if;
  if not ((old.status = 'pending' and new.status = 'cancelled')
          or (old.status = 'failed' and new.status = 'pending')
          or (old.status = new.status)) then
    raise exception 'invalid follow-up status change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger follow_up_jobs_guard before update on public.follow_up_jobs
  for each row execute function app.guard_follow_up_update();

create policy email_events_select on public.email_events for select to authenticated
  using (organization_id is not null and app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

revoke execute on all functions in schema app from public;
