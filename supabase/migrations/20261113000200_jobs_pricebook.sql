-- ============================================================================
-- Phase 2: jobs, technician assignment, private job attachments, price book.
-- ============================================================================

create type public.job_status as enum ('new', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled');
create type public.tax_class as enum ('taxable', 'non_taxable');

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_number integer not null,
  customer_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  status public.job_status not null default 'new',
  service_address_line1 text check (char_length(service_address_line1) <= 200),
  service_address_line2 text check (char_length(service_address_line2) <= 200),
  service_city text check (char_length(service_city) <= 100),
  service_region text check (char_length(service_region) <= 100),
  service_postal_code text check (char_length(service_postal_code) <= 20),
  equipment_type text check (char_length(equipment_type) <= 120),
  equipment_make text check (char_length(equipment_make) <= 120),
  equipment_model text check (char_length(equipment_model) <= 120),
  equipment_serial text check (char_length(equipment_serial) <= 120),
  equipment_age_years integer check (equipment_age_years between 0 and 150),
  equipment_notes text check (char_length(equipment_notes) <= 2000),
  description text check (char_length(description) <= 5000),
  technician_observations text check (char_length(technician_observations) <= 10000),
  internal_notes text check (char_length(internal_notes) <= 5000),
  assigned_technician_id uuid,
  appointment_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, job_number),
  unique (id, organization_id),
  unique (id, organization_id, customer_id),
  -- Same-organization guarantees:
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (organization_id, assigned_technician_id)
    references public.organization_members (organization_id, user_id) on delete set null (assigned_technician_id)
);
create index jobs_org_status_idx on public.jobs (organization_id, status);
create index jobs_org_customer_idx on public.jobs (organization_id, customer_id);
create index jobs_org_tech_idx on public.jobs (organization_id, assigned_technician_id);
create index jobs_org_appointment_idx on public.jobs (organization_id, appointment_at);
create trigger jobs_updated_at before update on public.jobs
  for each row execute function app.set_updated_at();

-- Per-organization sequential numbers (SECURITY DEFINER: technicians cannot update organizations).
create or replace function app.assign_job_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.organizations set next_job_number = next_job_number + 1
    where id = new.organization_id
    returning next_job_number - 1 into new.job_number;
  return new;
end $$;
create trigger jobs_assign_number before insert on public.jobs
  for each row execute function app.assign_job_number();

-- Technicians may only change field-work columns on jobs assigned to them.
create or replace function app.guard_job_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id <> old.organization_id or new.job_number <> old.job_number then
    raise exception 'organization_id and job_number are immutable' using errcode = '42501';
  end if;
  if auth.uid() is null or app.has_role(new.organization_id, array['owner', 'admin']::public.member_role[]) then
    return new;
  end if;
  if old.assigned_technician_id is distinct from auth.uid() then
    raise exception 'technicians can only update jobs assigned to them' using errcode = '42501';
  end if;
  if new.customer_id <> old.customer_id
     or new.assigned_technician_id is distinct from old.assigned_technician_id
     or new.appointment_at is distinct from old.appointment_at
     or new.title <> old.title
     or new.internal_notes is distinct from old.internal_notes then
    raise exception 'technicians cannot change customer, assignment, schedule, title or internal notes' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger jobs_guard_update before update on public.jobs
  for each row execute function app.guard_job_update();

-- ---------------------------------------------------------------------------
-- Job attachments (metadata; objects live in the private Storage bucket)
-- ---------------------------------------------------------------------------
create table public.job_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes integer not null check (size_bytes between 1 and 15728640),
  caption text check (char_length(caption) <= 300),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (job_id, organization_id) references public.jobs (id, organization_id) on delete cascade,
  -- Path must live under the owning organization and job.
  check (storage_path like organization_id::text || '/' || job_id::text || '/%')
);
create index job_attachments_job_idx on public.job_attachments (job_id);

-- ---------------------------------------------------------------------------
-- Price book
-- ---------------------------------------------------------------------------
create table public.price_book_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text check (char_length(description) <= 2000),
  category text check (char_length(category) <= 80),
  sku text check (char_length(sku) <= 60),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 100000000000),
  unit text not null default 'each' check (char_length(unit) between 1 and 30),
  tax_class public.tax_class not null default 'taxable',
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index price_book_items_org_name_uq on public.price_book_items (organization_id, lower(name));
create index price_book_items_org_active_idx on public.price_book_items (organization_id, is_active, category);
create trigger price_book_items_updated_at before update on public.price_book_items
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Private storage bucket. No storage.objects policies are created for
-- anon/authenticated: browsers cannot read or write objects directly. The server
-- authorizes each request, then uses the secret key to upload or to mint a
-- short-lived signed URL.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-attachments', 'job-attachments', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- Privileges & RLS
-- ---------------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.job_attachments enable row level security;
alter table public.price_book_items enable row level security;

grant select, insert, update, delete on public.jobs, public.job_attachments, public.price_book_items to authenticated;
grant all on public.jobs, public.job_attachments, public.price_book_items to service_role;
revoke all on public.jobs, public.job_attachments, public.price_book_items from anon;

create policy jobs_select on public.jobs for select to authenticated
  using (app.is_member(organization_id));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (app.is_member(organization_id) and created_by = auth.uid());
create policy jobs_update on public.jobs for update to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[])
         or (app.is_member(organization_id) and assigned_technician_id = auth.uid()))
  with check (app.is_member(organization_id));
create policy jobs_delete on public.jobs for delete to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy job_attachments_select on public.job_attachments for select to authenticated
  using (app.is_member(organization_id));
create policy job_attachments_insert on public.job_attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid() and (
      app.has_role(organization_id, array['owner', 'admin']::public.member_role[])
      or exists (select 1 from public.jobs j where j.id = job_id and j.organization_id = job_attachments.organization_id
                 and j.assigned_technician_id = auth.uid())));
create policy job_attachments_delete on public.job_attachments for delete to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]) or uploaded_by = auth.uid());

create policy price_book_select on public.price_book_items for select to authenticated
  using (app.is_member(organization_id));
create policy price_book_insert on public.price_book_items for insert to authenticated
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy price_book_update on public.price_book_items for update to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]))
  with check (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy price_book_delete on public.price_book_items for delete to authenticated
  using (app.has_role(organization_id, array['owner', 'admin']::public.member_role[]));
