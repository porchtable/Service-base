-- ============================================================================
-- Phase 1 foundation: tenancy, roles, profiles, invitations, customers,
-- audit log, rate limiting, platform administrators, data requests.
-- ============================================================================

-- Private schema for helpers. Not exposed via the Supabase Data API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Nothing in public is reachable by anonymous Data API clients.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

create type public.member_role as enum ('owner', 'admin', 'technician');
create type public.industry as enum ('hvac', 'plumbing', 'electrical', 'roofing', 'general');

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (char_length(full_name) <= 120),
  phone text check (char_length(phone) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

create or replace function app.handle_auth_user_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, email, full_name)
    values (
      new.id,
      coalesce(new.email, ''),
      nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), '')
    )
    on conflict (id) do nothing;
  elsif new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_change
  after insert or update of email on auth.users
  for each row execute function app.handle_auth_user_change();

-- ---------------------------------------------------------------------------
-- Organizations & membership
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  industry public.industry not null default 'hvac',
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 254),
  website text check (char_length(website) <= 200),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 100),
  region text check (char_length(region) <= 100),
  postal_code text check (char_length(postal_code) <= 20),
  country text not null default 'US' check (char_length(country) = 2),
  timezone text not null default 'America/New_York' check (char_length(timezone) <= 64),
  -- Company-configured. AI never sets taxes, terms, or warranties.
  default_tax_rate_bps integer not null default 0 check (default_tax_rate_bps between 0 and 10000),
  estimate_validity_days integer not null default 30 check (estimate_validity_days between 1 and 365),
  estimate_terms text check (char_length(estimate_terms) <= 5000),
  follow_up_enabled boolean not null default true,
  follow_up_offsets_days integer[] not null default '{2,5,10}'
    check (cardinality(follow_up_offsets_days) <= 6 and 0 < all (follow_up_offsets_days) and 366 > all (follow_up_offsets_days)),
  next_job_number integer not null default 1001,
  next_estimate_number integer not null default 1001,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
create trigger organization_members_updated_at before update on public.organization_members
  for each row execute function app.set_updated_at();

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role public.member_role not null check (role <> 'owner'),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organization_invitations_pending_uq
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

create table public.platform_administrators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  note text check (char_length(note) <= 500),
  granted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER: bypass RLS on the tables they read,
-- avoiding policy recursion; search_path pinned).
-- ---------------------------------------------------------------------------
create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid()
  )
$$;

create or replace function app.has_role(p_org uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  )
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_administrators a where a.user_id = auth.uid())
$$;

create or replace function app.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and them.user_id = p_user
  )
$$;

revoke all on function app.is_member(uuid), app.has_role(uuid, public.member_role[]),
  app.is_platform_admin(), app.shares_org_with(uuid) from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.member_role[]),
  app.is_platform_admin(), app.shares_org_with(uuid) to authenticated, service_role;

-- Create an organization and make the caller its owner, atomically.
create or replace function app.create_organization(p_name text, p_industry public.industry)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.organizations (name, industry, created_by)
  values (btrim(p_name), p_industry, v_user)
  returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');
  insert into public.audit_events (organization_id, actor_user_id, actor_type, action, entity_type, entity_id)
  values (v_org, v_user, 'user', 'organization.created', 'organization', v_org);
  return v_org;
end $$;
revoke all on function app.create_organization(text, public.industry) from public;
grant execute on function app.create_organization(text, public.industry) to authenticated;

-- Accept an invitation for the caller's verified email address.
create or replace function app.accept_invitation(p_token_hash bytea) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.organization_invitations;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select lower(u.email) into v_email from auth.users u
  where u.id = v_user and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'email not verified' using errcode = '42501';
  end if;

  select * into v_inv from public.organization_invitations i
  where i.token_hash = p_token_hash
  for update;

  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null
     or v_inv.expires_at <= now() or v_inv.email <> v_email then
    raise exception 'invitation invalid' using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_inv.organization_id, v_user, v_inv.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
    set accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;

  insert into public.audit_events (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (v_inv.organization_id, v_user, 'user', 'member.joined', 'organization_member', v_inv.id,
          jsonb_build_object('role', v_inv.role));
  return v_inv.organization_id;
end $$;
revoke all on function app.accept_invitation(bytea) from public;
grant execute on function app.accept_invitation(bytea) to authenticated;

-- Guard: an organization must always retain at least one owner, and only owners
-- may grant or revoke the owner role.
create or replace function app.guard_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_remaining integer;
begin
  -- Cascade from an organization being deleted: nothing to protect.
  if not exists (select 1 from public.organizations where id = v_org) then
    return coalesce(new, old);
  end if;
  -- Bootstrap: the first member of a brand-new organization (app.create_organization).
  if tg_op = 'INSERT' and new.role = 'owner'
     and not exists (select 1 from public.organization_members where organization_id = v_org) then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.user_id <> old.user_id) then
    raise exception 'membership identity is immutable' using errcode = '42501';
  end if;

  if auth.uid() is not null then
    if (tg_op in ('INSERT', 'UPDATE') and new.role = 'owner')
       or (tg_op in ('UPDATE', 'DELETE') and old.role = 'owner') then
      -- Allow an owner to leave (delete own row); everything else needs owner role.
      if not app.has_role(v_org, array['owner']::public.member_role[]) then
        raise exception 'only owners can change owner memberships' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' and old.role = 'owner'
     or tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    select count(*) into v_remaining from public.organization_members
      where organization_id = v_org and role = 'owner' and id <> old.id;
    if v_remaining = 0 then
      raise exception 'an organization must keep at least one owner' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger organization_members_guard
  before insert or update or delete on public.organization_members
  for each row execute function app.guard_membership_change();

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  company_name text check (char_length(company_name) <= 160),
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  city text check (char_length(city) <= 100),
  region text check (char_length(region) <= 100),
  postal_code text check (char_length(postal_code) <= 20),
  notes text check (char_length(notes) <= 5000),
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple',
      coalesce(name, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(email, '') || ' ' ||
      coalesce(phone, '') || ' ' || coalesce(address_line1, '') || ' ' || coalesce(city, '') || ' ' ||
      coalesce(postal_code, ''))
  ) stored,
  unique (id, organization_id)
);
create index customers_org_name_idx on public.customers (organization_id, lower(name));
create index customers_org_active_idx on public.customers (organization_id) where archived_at is null;
create index customers_search_idx on public.customers using gin (search);
create trigger customers_updated_at before update on public.customers
  for each row execute function app.set_updated_at();

-- Only owners/admins may archive or restore customers.
create or replace function app.guard_customer_archive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.archived_at is distinct from old.archived_at and auth.uid() is not null
     and not app.has_role(new.organization_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'insufficient role to archive customers' using errcode = '42501';
  end if;
  if new.organization_id <> old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger customers_archive_guard before update on public.customers
  for each row execute function app.guard_customer_archive();

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'customer', 'system', 'platform_admin', 'stripe')),
  action text not null check (char_length(action) between 1 and 100),
  entity_type text check (char_length(entity_type) <= 60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text check (char_length(ip_address) <= 64),
  created_at timestamptz not null default now()
);
create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_created_idx on public.audit_events (created_at desc);

create or replace function app.audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Allow cascading cleanup when an entire organization is deleted.
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = old.organization_id) then
    return old;
  end if;
  raise exception 'audit_events is append-only' using errcode = '42501';
end $$;
create trigger audit_events_no_update before update on public.audit_events
  for each row execute function app.audit_append_only();
create trigger audit_events_no_delete before delete on public.audit_events
  for each row execute function app.audit_append_only();

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, shared across server instances)
-- ---------------------------------------------------------------------------
create table public.rate_limit_buckets (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
create index rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

create or replace function app.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = b.hits + 1
  returning hits into v_hits;
  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then
    delete from public.rate_limit_buckets where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end $$;
revoke all on function app.rate_limit_hit(text, integer, integer) from public;
grant execute on function app.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Data export / account deletion requests
-- ---------------------------------------------------------------------------
create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  requester_email text not null,
  kind text not null check (kind in ('export', 'account_deletion')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  reason text check (char_length(reason) <= 2000),
  resolution_note text check (char_length(resolution_note) <= 2000),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index data_requests_status_idx on public.data_requests (status, created_at);
create unique index data_requests_one_pending_deletion
  on public.data_requests (user_id) where kind = 'account_deletion' and status = 'pending';

-- ---------------------------------------------------------------------------
-- Privileges & Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.platform_administrators enable row level security;
alter table public.customers enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.data_requests enable row level security;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
-- Tables with no authenticated access at all.
revoke all on public.rate_limit_buckets from authenticated;
revoke insert, update, delete on public.platform_administrators from authenticated;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- organizations (insert via app.create_organization only)
create policy organizations_select on public.organizations for select to authenticated
  using (app.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app.has_role(id, array['owner', 'admin']::public.member_role[]))
  with check (app.has_role(id, array['owner', 'admin']::public.member_role[]));
create policy organizations_delete on public.organizations for delete to authenticated
  using (app.has_role(id, array['owner']::public.member_role[]));

-- organization_members
create policy members_select on public.organization_members for select to authenticated
  using (app.is_member(organization_id));
create policy members_insert on public.organization_members for insert to authenticated
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy members_update on public.organization_members for update to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy members_delete on public.organization_members for delete to authenticated
  using (user_id = auth.uid() or app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- invitations
create policy invitations_all on public.organization_invitations for all to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- platform administrators: a user may only see whether they themselves are one.
create policy platform_admins_self on public.platform_administrators for select to authenticated
  using (user_id = auth.uid());

-- customers
create policy customers_select on public.customers for select to authenticated
  using (app.is_member(organization_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (app.is_member(organization_id) and created_by = auth.uid());
create policy customers_update on public.customers for update to authenticated
  using (app.is_member(organization_id)) with check (app.is_member(organization_id));
-- No delete policy: customers are archived, never hard-deleted by tenants.

-- audit events: owners/admins read their org's log; members append as themselves.
create policy audit_select on public.audit_events for select to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy audit_insert on public.audit_events for insert to authenticated
  with check (app.is_member(organization_id) and actor_user_id = auth.uid() and actor_type = 'user');

-- data requests
create policy data_requests_select on public.data_requests for select to authenticated
  using (user_id = auth.uid()
         or (organization_id is not null and app.has_role(organization_id, array['owner', 'admin']::public.member_role[])));
create policy data_requests_insert on public.data_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending'
              and (organization_id is null or app.has_role(organization_id, array['owner', 'admin']::public.member_role[]) or kind = 'account_deletion'));
