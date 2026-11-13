-- ============================================================================
-- Phase 3: estimates, versions, line items, customer access tokens, decisions.
--
-- Rules enforced here (not only in application code):
--   * line items are writable only while their version is a draft
--   * line totals and version totals are computed by the database
--   * approval requires ≥1 line, every line priced, no unresolved review flags,
--     and the owner/admin role
--   * sending requires approval, a frozen snapshot whose total matches, and an expiry
--   * after sending, a version's content is immutable; only the status may move
--     sent → accepted | declined | expired | superseded, and terminal states are final
--   * exactly one customer decision per version, only while sent and unexpired
-- ============================================================================

create type public.estimate_status as enum ('draft', 'approved', 'sent', 'accepted', 'declined', 'expired', 'superseded');

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  estimate_number integer not null,
  job_id uuid not null,
  customer_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  status public.estimate_status not null default 'draft',
  current_version_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, estimate_number),
  unique (id, organization_id),
  foreign key (job_id, organization_id, customer_id) references public.jobs (id, organization_id, customer_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id)
);
create index estimates_org_status_idx on public.estimates (organization_id, status);
create index estimates_org_job_idx on public.estimates (organization_id, job_id);
create index estimates_org_customer_idx on public.estimates (organization_id, customer_id);
create trigger estimates_updated_at before update on public.estimates
  for each row execute function app.set_updated_at();

create or replace function app.assign_estimate_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.organizations set next_estimate_number = next_estimate_number + 1
    where id = new.organization_id
    returning next_estimate_number - 1 into new.estimate_number;
  new.status := 'draft';
  new.current_version_id := null;
  return new;
end $$;
create trigger estimates_assign_number before insert on public.estimates
  for each row execute function app.assign_estimate_number();

create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  estimate_id uuid not null,
  version_number integer not null,
  status public.estimate_status not null default 'draft',
  technician_notes text check (char_length(technician_notes) <= 20000),
  customer_summary text check (char_length(customer_summary) <= 5000),
  internal_notes text check (char_length(internal_notes) <= 5000),
  tax_rate_bps integer not null check (tax_rate_bps between 0 and 10000),
  subtotal_cents bigint not null default 0,
  taxable_subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  ai_status text not null default 'none' check (ai_status in ('none', 'pending', 'succeeded', 'failed')),
  ai_model text check (char_length(ai_model) <= 100),
  ai_requested_at timestamptz,
  ai_completed_at timestamptz,
  ai_error text check (char_length(ai_error) <= 1000),
  ai_warnings jsonb not null default '[]'::jsonb,
  ai_raw jsonb,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz,
  expires_at timestamptz,
  decided_at timestamptz,
  snapshot jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estimate_id, version_number),
  unique (id, organization_id),
  foreign key (estimate_id, organization_id) references public.estimates (id, organization_id) on delete cascade
);
create index estimate_versions_status_expiry_idx on public.estimate_versions (status, expires_at);
create index estimate_versions_org_idx on public.estimate_versions (organization_id, status);
-- Fires after estimate_versions_guard (triggers run in name order); the guard ignores updated_at.
create trigger estimate_versions_updated_at before update on public.estimate_versions
  for each row execute function app.set_updated_at();

alter table public.estimates
  add constraint estimates_current_version_fk
  foreign key (current_version_id, organization_id) references public.estimate_versions (id, organization_id)
  deferrable initially deferred;

create table public.estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  estimate_version_id uuid not null,
  position integer not null default 0,
  price_book_item_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 100000),
  unit text not null default 'each' check (char_length(unit) between 1 and 30),
  unit_price_cents bigint check (unit_price_cents between 0 and 100000000000),
  line_total_cents bigint,
  tax_class public.tax_class not null default 'taxable',
  source text not null check (source in ('ai', 'manual', 'price_book')),
  needs_review boolean not null default false,
  review_reason text check (char_length(review_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (estimate_version_id, organization_id) references public.estimate_versions (id, organization_id) on delete cascade,
  foreign key (price_book_item_id, organization_id) references public.price_book_items (id, organization_id) on delete set null (price_book_item_id)
);
create index estimate_line_items_version_idx on public.estimate_line_items (estimate_version_id, position);
create trigger estimate_line_items_updated_at before update on public.estimate_line_items
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Version numbering + initial state
-- ---------------------------------------------------------------------------
create or replace function app.before_version_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.estimates where id = new.estimate_id for update;
  select coalesce(max(version_number), 0) + 1 into new.version_number
    from public.estimate_versions where estimate_id = new.estimate_id;
  new.status := 'draft';
  new.approved_by := null; new.approved_at := null;
  new.sent_by := null; new.sent_at := null; new.expires_at := null; new.decided_at := null;
  new.snapshot := null;
  new.subtotal_cents := 0; new.taxable_subtotal_cents := 0; new.tax_cents := 0; new.total_cents := 0;
  return new;
end $$;
create trigger estimate_versions_before_insert before insert on public.estimate_versions
  for each row execute function app.before_version_insert();

-- Keep estimates.status / current_version_id in sync with the latest version.
create or replace function app.sync_estimate_from_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.estimates set current_version_id = new.id, status = new.status where id = new.estimate_id;
  else
    update public.estimates set status = new.status
      where id = new.estimate_id and current_version_id = new.id and status is distinct from new.status;
  end if;
  return new;
end $$;
create trigger estimate_versions_sync after insert or update of status on public.estimate_versions
  for each row execute function app.sync_estimate_from_version();

-- ---------------------------------------------------------------------------
-- Version state machine & immutability
-- ---------------------------------------------------------------------------
create or replace function app.guard_version_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_is_user boolean := auth.uid() is not null;
  v_manager boolean := app.has_role(old.organization_id, array['owner', 'admin']::public.member_role[]);
  v_lines integer;
  v_unresolved integer;
  -- Columns that may change while a version is a draft but never afterwards.
  v_frozen_keys text[] := array['status', 'approved_by', 'approved_at', 'sent_by', 'sent_at', 'expires_at',
                                'decided_at', 'snapshot', 'updated_at'];
begin
  if new.organization_id <> old.organization_id or new.estimate_id <> old.estimate_id
     or new.version_number <> old.version_number then
    raise exception 'version identity is immutable' using errcode = '42501';
  end if;

  if old.status = 'draft' then
    if new.status = 'draft' then
      if new.tax_rate_bps <> old.tax_rate_bps and v_is_user and not v_manager then
        raise exception 'only owners and admins can change the tax rate' using errcode = '42501';
      end if;
      return new;
    elsif new.status = 'approved' then
      if v_is_user and not v_manager then
        raise exception 'only owners and admins can approve estimates' using errcode = '42501';
      end if;
      select count(*), count(*) filter (where unit_price_cents is null or needs_review)
        into v_lines, v_unresolved
        from public.estimate_line_items where estimate_version_id = old.id;
      if v_lines = 0 then
        raise exception 'an estimate needs at least one line item before approval' using errcode = 'P0001';
      end if;
      if v_unresolved > 0 then
        raise exception 'resolve % line item(s) with missing prices or review flags before approval', v_unresolved using errcode = 'P0001';
      end if;
      if (to_jsonb(new) - v_frozen_keys) <> (to_jsonb(old) - v_frozen_keys) then
        raise exception 'content cannot change during approval' using errcode = '42501';
      end if;
      new.approved_at := now();
      new.approved_by := coalesce(auth.uid(), new.approved_by);
      return new;
    end if;
    raise exception 'invalid status transition from draft to %', new.status using errcode = 'P0001';
  end if;

  if old.status = 'approved' then
    if new.status = 'draft' then
      if v_is_user and not v_manager then
        raise exception 'only owners and admins can reopen an approved estimate' using errcode = '42501';
      end if;
      new.approved_at := null;
      new.approved_by := null;
      return new;
    elsif new.status = 'sent' then
      if v_is_user and not v_manager then
        raise exception 'only owners and admins can send estimates' using errcode = '42501';
      end if;
      if (to_jsonb(new) - v_frozen_keys) <> (to_jsonb(old) - v_frozen_keys)
         or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
        raise exception 'content cannot change while sending' using errcode = '42501';
      end if;
      if new.snapshot is null or new.expires_at is null or new.expires_at <= now() then
        raise exception 'a sent estimate requires a snapshot and a future expiry' using errcode = 'P0001';
      end if;
      if (new.snapshot -> 'totals' ->> 'total_cents')::bigint is distinct from new.total_cents then
        raise exception 'snapshot totals do not match the approved estimate' using errcode = 'P0001';
      end if;
      new.sent_at := now();
      new.sent_by := coalesce(auth.uid(), new.sent_by);
      return new;
    elsif new.status = 'approved' then
      raise exception 'approved estimates cannot be edited; reopen as a draft first' using errcode = '42501';
    end if;
    raise exception 'invalid status transition from approved to %', new.status using errcode = 'P0001';
  end if;

  if old.status = 'sent' then
    -- Everything except status/decided_at is frozen.
    if (to_jsonb(new) - array['status', 'decided_at', 'updated_at']) <> (to_jsonb(old) - array['status', 'decided_at', 'updated_at']) then
      raise exception 'sent estimate versions are immutable' using errcode = '42501';
    end if;
    if new.status in ('accepted', 'declined') then
      if v_is_user then
        raise exception 'only the customer can accept or decline an estimate' using errcode = '42501';
      end if;
      new.decided_at := now();
      return new;
    elsif new.status = 'expired' then
      if new.expires_at > now() then
        raise exception 'estimate has not expired yet' using errcode = 'P0001';
      end if;
      return new;
    elsif new.status = 'superseded' then
      if v_is_user and not v_manager then
        raise exception 'only owners and admins can revise a sent estimate' using errcode = '42501';
      end if;
      return new;
    elsif new.status = 'sent' then
      raise exception 'sent estimate versions are immutable' using errcode = '42501';
    end if;
    raise exception 'invalid status transition from sent to %', new.status using errcode = 'P0001';
  end if;

  raise exception 'estimate version is final (%) and cannot be changed', old.status using errcode = '42501';
end $$;
create trigger estimate_versions_guard before update on public.estimate_versions
  for each row execute function app.guard_version_update();

create or replace function app.guard_version_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and exists (select 1 from public.organizations where id = old.organization_id) then
    raise exception 'only draft estimate versions can be deleted' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger estimate_versions_guard_delete before delete on public.estimate_versions
  for each row execute function app.guard_version_delete();

-- ---------------------------------------------------------------------------
-- Line items: draft-only writes, DB-computed totals
-- ---------------------------------------------------------------------------
create or replace function app.guard_line_item() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_version uuid := coalesce(new.estimate_version_id, old.estimate_version_id);
  v_status public.estimate_status;
begin
  select status into v_status from public.estimate_versions where id = v_version;
  if v_status is null then
    return coalesce(new, old); -- parent being deleted (cascade)
  end if;
  if v_status <> 'draft' then
    raise exception 'line items can only change while the estimate is a draft' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.estimate_version_id <> old.estimate_version_id or new.organization_id <> old.organization_id) then
    raise exception 'line item ownership is immutable' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new.line_total_cents := case when new.unit_price_cents is null then null
                                 else round(new.quantity * new.unit_price_cents)::bigint end;
    -- Only owners/admins may set custom (non-price-book) prices or clear review flags.
    if auth.uid() is not null and not app.has_role(new.organization_id, array['owner', 'admin']::public.member_role[]) then
      if new.unit_price_cents is not null and (
           new.price_book_item_id is null
           or new.unit_price_cents <> (select p.unit_price_cents from public.price_book_items p where p.id = new.price_book_item_id)
         ) and (tg_op = 'INSERT' or new.unit_price_cents is distinct from old.unit_price_cents
                or new.price_book_item_id is distinct from old.price_book_item_id) then
        raise exception 'technicians can only use prices from the price book' using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and old.needs_review and not new.needs_review
         and not (new.price_book_item_id is not null and new.price_book_item_id is distinct from old.price_book_item_id) then
        raise exception 'only owners and admins can clear review flags' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  return old;
end $$;
create trigger estimate_line_items_guard before insert or update or delete on public.estimate_line_items
  for each row execute function app.guard_line_item();

create or replace function app.recalculate_version_totals(p_version uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_tax integer;
  v_sub bigint;
  v_taxable bigint;
begin
  select tax_rate_bps into v_tax from public.estimate_versions where id = p_version and status = 'draft';
  if v_tax is null then
    return;
  end if;
  select coalesce(sum(line_total_cents), 0), coalesce(sum(line_total_cents) filter (where tax_class = 'taxable'), 0)
    into v_sub, v_taxable
    from public.estimate_line_items where estimate_version_id = p_version and line_total_cents is not null;
  update public.estimate_versions set
    subtotal_cents = v_sub,
    taxable_subtotal_cents = v_taxable,
    tax_cents = round(v_taxable * v_tax / 10000.0)::bigint,
    total_cents = v_sub + round(v_taxable * v_tax / 10000.0)::bigint
  where id = p_version;
end $$;

-- Called from trigger functions that run as the invoking user.
grant execute on function app.recalculate_version_totals(uuid) to authenticated, service_role;

create or replace function app.after_line_item_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform app.recalculate_version_totals(coalesce(new.estimate_version_id, old.estimate_version_id));
  return null;
end $$;
create trigger estimate_line_items_totals after insert or update or delete on public.estimate_line_items
  for each row execute function app.after_line_item_change();

-- Tax-rate changes on a draft re-derive totals.
create or replace function app.after_version_tax_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform app.recalculate_version_totals(new.id);
  return null;
end $$;
create trigger estimate_versions_tax_change after update of tax_rate_bps on public.estimate_versions
  for each row when (old.tax_rate_bps is distinct from new.tax_rate_bps)
  execute function app.after_version_tax_change();

-- ---------------------------------------------------------------------------
-- Customer access tokens and decisions
-- ---------------------------------------------------------------------------
create table public.estimate_access_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  estimate_version_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  purpose text not null default 'link' check (purpose in ('link', 'email', 'reminder')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (estimate_version_id, organization_id) references public.estimate_versions (id, organization_id) on delete cascade
);
create index estimate_access_tokens_version_idx on public.estimate_access_tokens (estimate_version_id);

create table public.estimate_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  estimate_version_id uuid not null unique,
  decision text not null check (decision in ('accepted', 'declined')),
  signer_name text check (char_length(signer_name) <= 160),
  comment text check (char_length(comment) <= 2000),
  access_token_id uuid,
  ip_address text check (char_length(ip_address) <= 64),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  foreign key (estimate_version_id, organization_id) references public.estimate_versions (id, organization_id) on delete cascade,
  foreign key (access_token_id, organization_id) references public.estimate_access_tokens (id, organization_id),
  check (decision = 'declined' or char_length(btrim(coalesce(signer_name, ''))) > 0)
);

create or replace function app.before_decision_insert() returns trigger
language plpgsql set search_path = '' as $$
declare
  v public.estimate_versions;
begin
  select * into v from public.estimate_versions where id = new.estimate_version_id for update;
  if v.id is null or v.organization_id <> new.organization_id then
    raise exception 'estimate not found' using errcode = 'P0002';
  end if;
  if v.status <> 'sent' then
    raise exception 'this estimate is no longer awaiting a decision (%)', v.status using errcode = 'P0001';
  end if;
  if v.expires_at <= now() then
    raise exception 'this estimate has expired' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger estimate_decisions_before_insert before insert on public.estimate_decisions
  for each row execute function app.before_decision_insert();

create or replace function app.after_decision_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.estimate_versions set status = new.decision::public.estimate_status
    where id = new.estimate_version_id;
  return null;
end $$;
create trigger estimate_decisions_after_insert after insert on public.estimate_decisions
  for each row execute function app.after_decision_insert();

create or replace function app.guard_decision_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = old.organization_id) then
    return old;
  end if;
  raise exception 'customer decisions are permanent' using errcode = '42501';
end $$;
create trigger estimate_decisions_immutable before update or delete on public.estimate_decisions
  for each row execute function app.guard_decision_immutable();

-- Expire overdue sent versions (called by the background worker). Returns ids.
create or replace function app.expire_overdue_estimates() returns setof uuid
language sql security definer set search_path = '' as $$
  update public.estimate_versions set status = 'expired'
  where status = 'sent' and expires_at <= now()
  returning id
$$;
revoke all on function app.expire_overdue_estimates() from public;
grant execute on function app.expire_overdue_estimates() to service_role;

-- ---------------------------------------------------------------------------
-- Privileges & RLS
-- ---------------------------------------------------------------------------
alter table public.estimates enable row level security;
alter table public.estimate_versions enable row level security;
alter table public.estimate_line_items enable row level security;
alter table public.estimate_access_tokens enable row level security;
alter table public.estimate_decisions enable row level security;

revoke all on public.estimates, public.estimate_versions, public.estimate_line_items,
  public.estimate_access_tokens, public.estimate_decisions from authenticated;
grant select, insert, update, delete on public.estimates, public.estimate_versions, public.estimate_line_items to authenticated;
grant select, insert, update on public.estimate_access_tokens to authenticated;
grant select on public.estimate_decisions to authenticated;
grant all on public.estimates, public.estimate_versions, public.estimate_line_items,
  public.estimate_access_tokens, public.estimate_decisions to service_role;
revoke all on public.estimates, public.estimate_versions, public.estimate_line_items,
  public.estimate_access_tokens, public.estimate_decisions from anon;

create policy estimates_select on public.estimates for select to authenticated using (app.is_member(organization_id));
create policy estimates_insert on public.estimates for insert to authenticated
  with check (app.is_member(organization_id) and created_by = auth.uid());
create policy estimates_update on public.estimates for update to authenticated
  using (app.is_member(organization_id)) with check (app.is_member(organization_id));
create policy estimates_delete on public.estimates for delete to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy versions_select on public.estimate_versions for select to authenticated using (app.is_member(organization_id));
create policy versions_insert on public.estimate_versions for insert to authenticated
  with check (app.is_member(organization_id) and created_by = auth.uid());
create policy versions_update on public.estimate_versions for update to authenticated
  using (app.is_member(organization_id)) with check (app.is_member(organization_id));
create policy versions_delete on public.estimate_versions for delete to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy line_items_select on public.estimate_line_items for select to authenticated using (app.is_member(organization_id));
create policy line_items_insert on public.estimate_line_items for insert to authenticated with check (app.is_member(organization_id));
create policy line_items_update on public.estimate_line_items for update to authenticated
  using (app.is_member(organization_id)) with check (app.is_member(organization_id));
create policy line_items_delete on public.estimate_line_items for delete to authenticated using (app.is_member(organization_id));

create policy tokens_manage on public.estimate_access_tokens for all to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy decisions_select on public.estimate_decisions for select to authenticated using (app.is_member(organization_id));

-- Functions in `app` are executable only where explicitly granted.
revoke execute on all functions in schema app from public;
