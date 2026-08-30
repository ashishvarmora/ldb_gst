-- ===========================================================================
-- Data retention, and the indexes the officer's records view needs.
--
-- The Google Sheet is the officer's permanent record. The database only has to
-- hold enough history to answer "where has this truck been lately", so old
-- rows are purged on a schedule. Retention is a per-officer limit like any
-- other: plan default, per-officer override, -1 to keep forever.
--
-- Run after 0003_worker_rpcs.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Retention as a limit
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists data_retention_days integer not null default 30
    check (data_retention_days = -1 or data_retention_days >= 1);

alter table public.user_limit_overrides
  add column if not exists data_retention_days integer
    check (data_retention_days is null or data_retention_days = -1 or data_retention_days >= 1);

comment on column public.plans.data_retention_days is
  'Days of truck_events / search_logs / alert_logs kept in the database. -1 keeps everything. The Google Sheet is the long-term record.';

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- officer_effective_limits / officer_overview are defined once, at the end of
-- 0008, on the final column set. They used to be rebuilt here too, so every
-- limit change had to be made in three files and one was always stale.
-- ---------------------------------------------------------------------------

-- purge_officer_data - delete history older than the officer's retention.
--
-- Deliberately refuses when the officer has no working Google Sheet, unless
-- forced: without the sheet the database IS the only record, and silently
-- deleting it would lose the case history.
-- ---------------------------------------------------------------------------
create or replace function public.purge_officer_data(
  p_user  uuid,
  p_days  integer default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days     integer;
  v_cutoff   timestamptz;
  v_sheet_ok boolean;
  v_events   integer := 0;
  v_searches integer := 0;
  v_alerts   integer := 0;
  v_usage    integer := 0;
begin
  select coalesce(p_days, data_retention_days) into v_days
  from public.officer_effective_limits where user_id = p_user;

  if v_days is null then
    return jsonb_build_object('purged', false, 'reason', 'no_such_user');
  end if;

  if v_days = -1 then
    return jsonb_build_object('purged', false, 'reason', 'keep_forever', 'days', -1);
  end if;

  select coalesce(spreadsheet_id is not null and is_enabled, false) into v_sheet_ok
  from public.google_sheet_configs where user_id = p_user;

  if not coalesce(v_sheet_ok, false) and not p_force then
    return jsonb_build_object(
      'purged', false,
      'reason', 'no_sheet_backup',
      'days', v_days);
  end if;

  v_cutoff := now() - make_interval(days => v_days);

  with gone as (
    delete from public.truck_events
    where user_id = p_user and coalesce(event_time, fetched_at) < v_cutoff
    returning 1
  ) select count(*) into v_events from gone;

  with gone as (
    delete from public.search_logs
    where user_id = p_user and created_at < v_cutoff
    returning 1
  ) select count(*) into v_searches from gone;

  with gone as (
    delete from public.alert_logs
    where user_id = p_user and created_at < v_cutoff
    returning 1
  ) select count(*) into v_alerts from gone;

  -- Daily counters are tiny, but there is no reason to keep years of them.
  with gone as (
    delete from public.usage_counters
    where user_id = p_user
      and usage_date < (v_cutoff at time zone 'Asia/Kolkata')::date
      and usage_date < date_trunc('month', public.ist_today())::date
    returning 1
  ) select count(*) into v_usage from gone;

  return jsonb_build_object(
    'purged', true,
    'days', v_days,
    'cutoff', v_cutoff,
    'truck_events', v_events,
    'search_logs', v_searches,
    'alert_logs', v_alerts,
    'usage_counters', v_usage);
end $fn$;

revoke all on function public.purge_officer_data(uuid, integer, boolean) from public;
grant execute on function public.purge_officer_data(uuid, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Indexes for the officer's records view: filtering by truck, by day, and by
-- plaza across every truck they own.
-- ---------------------------------------------------------------------------
create index if not exists truck_events_user_loc_idx
  on public.truck_events (user_id, loc_name);

create index if not exists truck_events_user_fetched_idx
  on public.truck_events (user_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- Defaults
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('data_retention_days',  '30'::jsonb),
  ('purge_enabled',        'true'::jsonb)
on conflict (key) do nothing;

update public.plans set data_retention_days = 30 where data_retention_days is null;
