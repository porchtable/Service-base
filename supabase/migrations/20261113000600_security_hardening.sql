-- ============================================================================
-- Security hardening from the production-readiness audit.
-- Closes direct Data API paths (public key + user JWT) that bypassed app rules:
--   1. members could set estimates.status / current_version_id / number directly
--   2. draft versions' totals, approval/send stamps and snapshot were writable
--   3. users could change the email teammates see for them (impersonation)
--   4. admins could rewrite organization counters / creator
-- ============================================================================

-- (3) profiles: only name and phone are user-editable; email is synced from Auth.
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- (4) organizations: settings only; counters and provenance are system-managed.
revoke update on public.organizations from authenticated;
grant update (name, industry, phone, email, website, address_line1, address_line2, city, region, postal_code,
              country, timezone, default_tax_rate_bps, estimate_validity_days, estimate_terms,
              follow_up_enabled, follow_up_offsets_days) on public.organizations to authenticated;

-- (1) estimates: only the title is user-editable. Status and current version are
-- maintained by SECURITY DEFINER triggers from estimate_versions.
revoke update on public.estimates from authenticated;
grant update (title) on public.estimates to authenticated;

-- (2) estimate_versions: system-managed columns cannot be written directly by users.
-- Totals come from line items (recalculated in nested triggers); approval/send stamps,
-- expiry and snapshot can change only through the status transitions in the guard.
create or replace function app.guard_version_system_columns() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_keys text[] := array['subtotal_cents', 'taxable_subtotal_cents', 'tax_cents', 'total_cents',
                         'approved_by', 'approved_at', 'sent_by', 'sent_at', 'expires_at', 'decided_at', 'snapshot'];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  k text;
begin
  -- Only direct statements from signed-in users; nested trigger updates (totals) are trusted.
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if old.status = 'draft' and new.status = 'draft' then
    foreach k in array v_keys loop
      if v_new -> k is distinct from v_old -> k then
        raise exception 'column % is managed by the system', k using errcode = '42501';
      end if;
    end loop;
  elsif old.status = 'draft' and new.status = 'approved' then
    -- Approval may only change status; the guard stamps approved_at/by.
    foreach k in array v_keys loop
      if v_new -> k is distinct from v_old -> k then
        raise exception 'column % cannot be set during approval', k using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end $$;
-- Name sorts before estimate_versions_guard, so it sees the user's original NEW row.
create trigger estimate_versions_a_system_columns before update on public.estimate_versions
  for each row execute function app.guard_version_system_columns();

-- Defense in depth: on approval, re-derive totals from the line items so an approved
-- version can never carry totals that disagree with its lines.
create or replace function app.rederive_totals_on_approval() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_sub bigint;
  v_taxable bigint;
begin
  if old.status = 'draft' and new.status = 'approved' then
    select coalesce(sum(line_total_cents), 0), coalesce(sum(line_total_cents) filter (where tax_class = 'taxable'), 0)
      into v_sub, v_taxable from public.estimate_line_items where estimate_version_id = new.id;
    new.subtotal_cents := v_sub;
    new.taxable_subtotal_cents := v_taxable;
    new.tax_cents := round(v_taxable * new.tax_rate_bps / 10000.0)::bigint;
    new.total_cents := v_sub + new.tax_cents;
  end if;
  return new;
end $$;
-- Runs after estimate_versions_guard (alphabetical), i.e. after the transition was validated.
create trigger estimate_versions_z_rederive_totals before update on public.estimate_versions
  for each row execute function app.rederive_totals_on_approval();

-- ---------------------------------------------------------------------------
-- Indexes for every foreign key (Supabase Performance Advisor "unindexed foreign keys").
-- Prevent sequential scans on cascades/SET NULL when organizations, users, price-book
-- items or estimate versions are deleted, and speed up tenant joins.
-- ---------------------------------------------------------------------------
create index if not exists audit_events_actor_user_id_fk_idx on public.audit_events (actor_user_id);
create index if not exists customers_archived_by_fk_idx on public.customers (archived_by);
create index if not exists customers_created_by_fk_idx on public.customers (created_by);
create index if not exists data_requests_organization_id_fk_idx on public.data_requests (organization_id);
create index if not exists data_requests_resolved_by_fk_idx on public.data_requests (resolved_by);
create index if not exists email_events_follow_up_job_id_fk_idx on public.email_events (follow_up_job_id);
create index if not exists estimate_access_tokens_created_by_fk_idx on public.estimate_access_tokens (created_by);
create index if not exists estimate_access_tokens_estimate_version_id_organization_id_fk_idx on public.estimate_access_tokens (estimate_version_id, organization_id);
create index if not exists estimate_access_tokens_organization_id_fk_idx on public.estimate_access_tokens (organization_id);
create index if not exists estimate_decisions_access_token_id_organization_id_fk_idx on public.estimate_decisions (access_token_id, organization_id);
create index if not exists estimate_decisions_estimate_version_id_organization_id_fk_idx on public.estimate_decisions (estimate_version_id, organization_id);
create index if not exists estimate_decisions_organization_id_fk_idx on public.estimate_decisions (organization_id);
create index if not exists estimate_line_items_estimate_version_id_organization_id_fk_idx on public.estimate_line_items (estimate_version_id, organization_id);
create index if not exists estimate_line_items_organization_id_fk_idx on public.estimate_line_items (organization_id);
create index if not exists estimate_line_items_price_book_item_id_organization_id_fk_idx on public.estimate_line_items (price_book_item_id, organization_id);
create index if not exists estimate_versions_approved_by_fk_idx on public.estimate_versions (approved_by);
create index if not exists estimate_versions_created_by_fk_idx on public.estimate_versions (created_by);
create index if not exists estimate_versions_estimate_id_organization_id_fk_idx on public.estimate_versions (estimate_id, organization_id);
create index if not exists estimate_versions_sent_by_fk_idx on public.estimate_versions (sent_by);
create index if not exists estimates_created_by_fk_idx on public.estimates (created_by);
create index if not exists estimates_current_version_id_organization_id_fk_idx on public.estimates (current_version_id, organization_id);
create index if not exists estimates_customer_id_organization_id_fk_idx on public.estimates (customer_id, organization_id);
create index if not exists estimates_job_id_organization_id_customer_id_fk_idx on public.estimates (job_id, organization_id, customer_id);
create index if not exists follow_up_jobs_created_by_fk_idx on public.follow_up_jobs (created_by);
create index if not exists follow_up_jobs_email_event_id_fk_idx on public.follow_up_jobs (email_event_id);
create index if not exists follow_up_jobs_estimate_version_id_organization_id_fk_idx on public.follow_up_jobs (estimate_version_id, organization_id);
create index if not exists job_attachments_job_id_organization_id_fk_idx on public.job_attachments (job_id, organization_id);
create index if not exists job_attachments_organization_id_fk_idx on public.job_attachments (organization_id);
create index if not exists job_attachments_uploaded_by_fk_idx on public.job_attachments (uploaded_by);
create index if not exists jobs_created_by_fk_idx on public.jobs (created_by);
create index if not exists jobs_customer_id_organization_id_fk_idx on public.jobs (customer_id, organization_id);
create index if not exists organization_invitations_accepted_by_fk_idx on public.organization_invitations (accepted_by);
create index if not exists organization_invitations_invited_by_fk_idx on public.organization_invitations (invited_by);
create index if not exists organizations_created_by_fk_idx on public.organizations (created_by);
create index if not exists platform_administrators_granted_by_fk_idx on public.platform_administrators (granted_by);
create index if not exists platform_config_updated_by_fk_idx on public.platform_config (updated_by);
create index if not exists price_book_items_created_by_fk_idx on public.price_book_items (created_by);
create index if not exists stripe_events_organization_id_fk_idx on public.stripe_events (organization_id);
create index if not exists subscriptions_plan_id_fk_idx on public.subscriptions (plan_id);

revoke execute on all functions in schema app from public;
