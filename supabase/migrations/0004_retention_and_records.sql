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
-- Rebuild the two views so the new limit flows through
-- ---------------------------------------------------------------------------
drop view if exists public.officer_overview;
drop view if exists public.officer_effective_limits;

create view public.officer_effective_limits with (security_invoker = on) as
select
  p.id as user_id,
  coalesce(o.truck_limit,                  pl.truck_limit,                  0) as truck_limit,
  coalesce(o.manual_search_limit_per_day,  pl.manual_search_limit_per_day,  0) as manual_search_limit_per_day,
  coalesce(o.tracking_queries_per_month,   pl.tracking_queries_per_month,   0) as tracking_queries_per_month,
  coalesce(o.min_alert_interval_minutes,   pl.min_alert_interval_minutes,   15) as min_alert_interval_minutes,
  coalesce(o.max_truck_groups,             pl.max_truck_groups,             0) as max_truck_groups,
  coalesce(o.min_polling_interval_minutes, pl.min_polling_interval_minutes, 60) as min_polling_interval_minutes,
  coalesce(o.data_retention_days,          pl.data_retention_days,          30) as data_retention_days,
  coalesce(o.telegram_enabled,             pl.telegram_enabled,             false) as telegram_enabled,
  coalesce(o.google_sheet_enabled,         pl.google_sheet_enabled,         false) as google_sheet_enabled,
  coalesce(o.alerts_enabled,               pl.alerts_enabled,               false) as alerts_enabled,
  (o.user_id is not null) as has_overrides
from public.profiles p
left join public.plans pl on pl.id = p.plan_id
left join public.user_limit_overrides o on o.user_id = p.id;

create view public.officer_overview with (security_invoker = on) as
select
  p.id,
  p.email,
  p.full_name,
  p.phone,
  p.designation,
  p.office,
  p.district,
  p.state,
  p.role,
  p.status,
  p.plan_id,
  p.plan_assigned_at,
  p.plan_expires_on,
  p.notes,
  p.last_active_at,
  p.created_at,
  pl.name  as plan_name,
  pl.description as plan_description,
  pl.price_per_month,
  el.truck_limit,
  el.manual_search_limit_per_day,
  el.tracking_queries_per_month,
  el.min_alert_interval_minutes,
  el.max_truck_groups,
  el.min_polling_interval_minutes,
  el.data_retention_days,
  el.telegram_enabled,
  el.google_sheet_enabled,
  el.alerts_enabled,
  el.has_overrides,
  coalesce(tt.active_trucks, 0)     as active_trucks,
  coalesce(tt.total_trucks, 0)      as total_trucks,
  coalesce(ud.manual_searches, 0)   as manual_searches_today,
  coalesce(ud.tracking_queries, 0)  as tracking_queries_today,
  coalesce(um.manual_searches, 0)   as manual_searches_month,
  coalesce(um.tracking_queries, 0)  as tracking_queries_month,
  coalesce(ad.alerts_today, 0)      as alerts_today,
  coalesce(ev.total_events, 0)      as total_events,
  coalesce(tg.chat_id is not null and tg.is_enabled, false)        as telegram_connected,
  coalesce(gs.spreadsheet_id is not null and gs.is_enabled, false) as sheet_connected,
  gs.last_synced_at as sheet_last_synced_at,
  ev.last_event_at
from public.profiles p
left join public.plans pl on pl.id = p.plan_id
left join public.officer_effective_limits el on el.user_id = p.id
left join lateral (
  select count(*) filter (where t.is_active) as active_trucks,
         count(*)                            as total_trucks
  from public.tracked_trucks t where t.user_id = p.id
) tt on true
left join lateral (
  select u.manual_searches, u.tracking_queries
  from public.usage_counters u
  where u.user_id = p.id and u.usage_date = public.ist_today()
) ud on true
left join lateral (
  select sum(u.manual_searches)::int as manual_searches,
         sum(u.tracking_queries)::int as tracking_queries
  from public.usage_counters u
  where u.user_id = p.id
    and u.usage_date >= date_trunc('month', public.ist_today())::date
) um on true
left join lateral (
  select count(*) as alerts_today
  from public.alert_logs a
  where a.user_id = p.id
    and (a.created_at at time zone 'Asia/Kolkata')::date = public.ist_today()
) ad on true
left join public.telegram_configs tg on tg.user_id = p.id
left join public.google_sheet_configs gs on gs.user_id = p.id
left join lateral (
  select max(e.event_time) as last_event_at, count(*) as total_events
  from public.truck_events e where e.user_id = p.id
) ev on true;

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
