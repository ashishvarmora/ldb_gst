-- ===========================================================================
-- Keep the database small, and let the admin decide how.
--
-- One retention window for everything was too blunt. A failed lookup is worth
-- a week; a toll crossing is worth a month; a credit movement is worth for
-- ever, because balances are reconstructed from it. So retention becomes one
-- row per table, and the admin sets each one.
--
-- Three things land together:
--
-- 1. RETENTION RULES. Per-table keep_days, with -1 for "keep everything", and
--    a protected flag on the tables where deleting would lose money records
--    rather than logs.
--
-- 2. PER-ACCOUNT SHEETS ARE BACK. 0009 consolidated every customer's sheet
--    into one the admin owned, because the copy that has to survive a purge
--    belonged to someone who was not running the purge. The owner wants each
--    account to have its own copy again, so each account may name a sheet and
--    the admin's sheet becomes the fallback for anyone who has not. Both is
--    strictly better than either: nobody's rows are deleted uncopied.
--
-- 3. ACTIVITY BELONGS TO THE PERSON WHO CAUSED IT. search_logs was already
--    readable by its owner, but only the admin had a screen for it. The view
--    added here is what a customer's own activity page reads, so "where did
--    that credit go" is answerable by the person who spent it.
--
-- Run after 0015_coupons.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Retention, one rule per table
--
-- entity is the table name, so the job that applies these needs no mapping
-- table and cannot drift out of step with the schema.
-- ---------------------------------------------------------------------------
create table if not exists public.retention_rules (
  entity                text primary key,
  label                 text not null,
  description           text,
  -- -1 keeps everything. 0 is deliberately not special: it would mean "delete
  -- today's rows too", which nobody wants by accident.
  keep_days             integer not null default 30,
  backup_before_delete  boolean not null default true,
  is_enabled            boolean not null default true,
  /*
   * Protected tables are the money record, not a log. Deleting from them
   * breaks balance reconstruction and every historical total, so they default
   * to keep-for-ever and the UI has to warn before overriding.
   */
  is_protected          boolean not null default false,
  sort_order            integer not null default 100,
  updated_at            timestamptz not null default now(),
  constraint retention_rules_keep_days_check check (keep_days = -1 or keep_days >= 1)
);

insert into public.retention_rules
  (entity, label, description, keep_days, is_protected, sort_order) values
  ('search_logs', 'Search activity',
   'One row per lookup, manual or automatic. The biggest source of rows and the least useful once a week old.',
   7, false, 10),
  ('truck_events', 'Toll crossings',
   'Where each truck has been. Grows for ever while a truck is watched, and is what the records page reads.',
   30, false, 20),
  ('alert_logs', 'Alerts sent',
   'Every alert raised and whether Telegram accepted it.',
   30, false, 30),
  ('audit_logs', 'Account activity',
   'What each account and admin did. Useful for a dispute, rarely after that.',
   30, false, 40),
  ('credit_transactions', 'Credit movements',
   'The money ledger. Balances are reconstructed from this, so trimming it loses the explanation for someone''s balance.',
   -1, true, 50),
  ('payments', 'Payments',
   'What was charged and what it bought. A financial record.',
   -1, true, 60),
  ('coupon_redemptions', 'Coupon claims',
   'Who used which code. Deleting these frees claims on limited codes.',
   -1, true, 70)
on conflict (entity) do nothing;

comment on table public.retention_rules is
  'How long each table is kept, and whether it is copied out before deletion. entity is the table name so the purge job needs no mapping.';

-- ---------------------------------------------------------------------------
-- 2. Each account may have its own sheet again
--
-- Dropped in 0009 in favour of a single admin sheet. Restored because each
-- customer wants their own copy of their own data - which is a fair thing to
-- want, and means a purge is no longer taking away the only copy they can see.
-- The admin sheet stays as the fallback.
-- ---------------------------------------------------------------------------
create table if not exists public.google_sheet_configs (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  spreadsheet_id text,
  sheet_url      text,
  is_enabled     boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  updated_at     timestamptz not null default now()
);

alter table public.google_sheet_configs enable row level security;

drop policy if exists sheet_configs_owner on public.google_sheet_configs;
create policy sheet_configs_owner on public.google_sheet_configs for all to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

do $blk$
begin
  execute 'drop trigger if exists touch_google_sheet_configs on public.google_sheet_configs';
  execute 'create trigger touch_google_sheet_configs before update '
          'on public.google_sheet_configs for each row '
          'execute function public.touch_updated_at()';
end $blk$;

-- How often the export runs, and what it is called.
insert into public.app_settings (key, value) values
  ('sheet_export_interval_days', '1'::jsonb),
  ('last_sheet_export_at',       'null'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. A customer's own activity
--
-- Every chargeable thing they did, in one list, so "where did that credit go"
-- is answered on their own screen rather than only in the admin console.
--
-- Deliberately NOT the rolled-up credit_activity view: that exists to keep a
-- summary readable, and this exists to be specific. Both are wanted, for
-- different questions.
-- ---------------------------------------------------------------------------
drop view if exists public.my_activity;
create view public.my_activity with (security_invoker = on) as
select
  s.user_id,
  s.created_at,
  'search'::text        as kind,
  s.source::text        as detail,
  s.truck_number,
  s.ok,
  s.new_events,
  s.response_ms,
  s.error,
  null::numeric         as credits
from public.search_logs s
union all
select
  c.user_id,
  c.created_at,
  'credit'::text        as kind,
  c.reason              as detail,
  c.truck_number,
  true                  as ok,
  null::integer         as new_events,
  null::integer         as response_ms,
  null::text            as error,
  c.delta               as credits
from public.credit_transactions c;

comment on view public.my_activity is
  'A customer''s own searches and credit movements in one feed. security_invoker, so RLS on the underlying tables keeps it to their own rows.';

-- ---------------------------------------------------------------------------
-- 4. purge_entity - delete one table's expired rows
--
-- Takes the cutoff rather than working it out, because the caller has already
-- copied everything older than that cutoff to a sheet and the two must agree
-- on the boundary exactly. A mismatch here deletes something that was never
-- copied.
--
-- Returns the number deleted. Refuses a table it does not know, so a typo in
-- a rule cannot turn into a dynamic delete against something unintended.
-- ---------------------------------------------------------------------------
create or replace function public.purge_entity(
  p_entity text,
  p_cutoff timestamptz,
  p_user   uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deleted integer := 0;
begin
  if p_cutoff is null then return 0; end if;

  case p_entity
    when 'search_logs' then
      with gone as (
        delete from public.search_logs
        where created_at < p_cutoff and (p_user is null or user_id = p_user)
        returning 1
      ) select count(*) into v_deleted from gone;

    when 'truck_events' then
      with gone as (
        delete from public.truck_events
        where coalesce(event_time, fetched_at) < p_cutoff
          and (p_user is null or user_id = p_user)
        returning 1
      ) select count(*) into v_deleted from gone;

    when 'alert_logs' then
      with gone as (
        delete from public.alert_logs
        where created_at < p_cutoff and (p_user is null or user_id = p_user)
        returning 1
      ) select count(*) into v_deleted from gone;

    when 'audit_logs' then
      with gone as (
        delete from public.audit_logs
        where created_at < p_cutoff and (p_user is null or actor_id = p_user)
        returning 1
      ) select count(*) into v_deleted from gone;

    when 'credit_transactions' then
      with gone as (
        delete from public.credit_transactions
        where created_at < p_cutoff and (p_user is null or user_id = p_user)
        returning 1
      ) select count(*) into v_deleted from gone;

    when 'payments' then
      with gone as (
        delete from public.payments
        where created_at < p_cutoff and status <> 'created'
          and (p_user is null or user_id = p_user)
        returning 1
      ) select count(*) into v_deleted from gone;

    when 'coupon_redemptions' then
      with gone as (
        delete from public.coupon_redemptions
        where created_at < p_cutoff and status <> 'reserved'
          and (p_user is null or user_id = p_user)
        returning 1
      ) select count(*) into v_deleted from gone;

    else
      raise exception 'purge_entity: unknown entity %', p_entity;
  end case;

  return v_deleted;
end $fn$;

revoke all on function public.purge_entity(text, timestamptz, uuid) from public;
grant execute on function public.purge_entity(text, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. What each table currently costs
--
-- So the admin can see whether retention is actually holding the size down,
-- rather than finding out when the free tier stops accepting writes.
-- ---------------------------------------------------------------------------
create or replace function public.table_sizes()
returns table (entity text, rows bigint, bytes bigint, pretty text)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    c.relname::text,
    -- reltuples is an estimate maintained by ANALYZE. Exact counts would mean
    -- a sequential scan of every table on every page load.
    greatest(c.reltuples, 0)::bigint,
    pg_total_relation_size(c.oid),
    pg_size_pretty(pg_total_relation_size(c.oid))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by pg_total_relation_size(c.oid) desc;
$fn$;

revoke all on function public.table_sizes() from public;
grant execute on function public.table_sizes() to service_role;
