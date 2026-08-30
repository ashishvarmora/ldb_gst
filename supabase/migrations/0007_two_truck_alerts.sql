-- ===========================================================================
-- Two alerts, chosen per truck.
--
-- The eight configurable rule kinds are gone. In their place the platform has
-- exactly two alerts, both built in, neither of them creatable:
--
--   location_update  every X minutes, say where the truck is now - even when
--                    that is the same plaza as last time.
--   location_change  every Y minutes, compare the current plaza with the one
--                    the last movement alert reported, and speak up only if it
--                    changed.
--
-- An officer cannot invent an alert; they switch these two on for a truck and
-- pick the interval. The admin decides whether an officer may use alerts at
-- all (plans.alerts_enabled) and how fast they may repeat
-- (plans.min_alert_interval_minutes), the same shape as polling already has.
--
-- Because the settings belong to a truck, there is no separate alert screen:
-- everything lives on the truck's own page under My trucks.
--
-- Run after 0006_store_movements_only.sql.
--
-- Note: 0001 already carries the new column definitions for a fresh database
-- and reconciles the renamed limit columns on an old one. This file does the
-- destructive half, which 0001 deliberately leaves alone.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-truck alert settings
--
--     *_last_at            when the alert was last evaluated, so the interval
--                          is measured from the alert itself and not from the
--                          polling clock.
--     movement_alert_last_location
--                          the plaza the last movement alert reported. "Has it
--                          changed" is asked against this, not against the
--                          previous crossing, so an officer who is told the
--                          truck reached Nadiad is not told again.
-- ---------------------------------------------------------------------------
alter table public.tracked_trucks
  add column if not exists location_alert_enabled       boolean not null default false,
  add column if not exists location_alert_minutes       integer not null default 60,
  add column if not exists location_alert_last_at       timestamptz,
  add column if not exists movement_alert_enabled       boolean not null default false,
  add column if not exists movement_alert_minutes       integer not null default 30,
  add column if not exists movement_alert_last_at       timestamptz,
  add column if not exists movement_alert_last_location text;

alter table public.tracked_trucks
  drop constraint if exists tracked_trucks_location_alert_minutes_check;
alter table public.tracked_trucks
  add constraint tracked_trucks_location_alert_minutes_check
  check (location_alert_minutes between 1 and 10080);

alter table public.tracked_trucks
  drop constraint if exists tracked_trucks_movement_alert_minutes_check;
alter table public.tracked_trucks
  add constraint tracked_trucks_movement_alert_minutes_check
  check (movement_alert_minutes between 1 and 10080);

-- A sweep now picks up a truck that is due for an alert even when it is not
-- due for a poll, so that "every 15 minutes" does not silently become "every
-- polling interval". Only trucks with an alert switched on are candidates.
create index if not exists tracked_trucks_alert_due_idx
  on public.tracked_trucks (is_active, location_alert_last_at, movement_alert_last_at)
  where location_alert_enabled or movement_alert_enabled;

comment on column public.tracked_trucks.movement_alert_last_location is
  'Plaza reported by the last movement alert. The change test compares against this, so the same move is never announced twice.';

-- ---------------------------------------------------------------------------
-- 2. Retire alert_rules
--
-- alert_logs is kept in full: it is the officer''s record of what was sent and
-- whether Telegram took it. Only the pointer to the deleted rule goes. Rows
-- written under the old rule kinds keep their original kind string; the admin
-- alert list falls back to showing it verbatim.
-- ---------------------------------------------------------------------------
drop index if exists public.alert_logs_rule_truck_time_idx;

alter table public.alert_logs drop column if exists alert_rule_id;

drop table if exists public.alert_rules cascade;

create index if not exists alert_logs_truck_time_idx
  on public.alert_logs (user_id, truck_number, created_at desc);

comment on table public.alert_logs is
  'Every alert the worker produced. kind is location_update or location_change; older rows may carry one of the eight retired rule kinds.';

-- ---------------------------------------------------------------------------
-- 3. Drop the retired limit
--
-- max_alert_rules counted something that no longer exists. Its replacement,
-- min_alert_interval_minutes, was added in 0001 so that the views rebuilt by
-- 0002 and 0004 can already refer to it.
--
-- The views are dropped first because they select the column being removed on
-- a database that has not yet re-run 0004.
-- ---------------------------------------------------------------------------
drop view if exists public.officer_overview;
drop view if exists public.officer_effective_limits;

alter table public.plans                drop column if exists max_alert_rules;
alter table public.user_limit_overrides drop column if exists max_alert_rules;

comment on column public.plans.min_alert_interval_minutes is
  'Fastest an officer may set a truck alert to repeat. The alert equivalent of min_polling_interval_minutes.';

-- ---------------------------------------------------------------------------
-- 4. Rebuild the views on the final column set
-- ---------------------------------------------------------------------------
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
-- 5. Seed the movement baseline
--
-- A truck whose movement alert is switched on later starts from wherever it
-- is at that moment; doing it here as well means an existing truck cannot fire
-- a "changed" alert for a move the officer was already shown before the
-- rework.
-- ---------------------------------------------------------------------------
update public.tracked_trucks
set movement_alert_last_location = last_location
where movement_alert_last_location is null
  and last_location is not null;

-- ---------------------------------------------------------------------------
-- 6. Retire the global knobs that only ever fed the deleted rules
--
-- excessive_movement and night_travel are gone, so these read as live settings
-- on the admin page while changing nothing. no_activity_hours stays: it still
-- decides when a truck is shown as "no activity" rather than "idle".
-- ---------------------------------------------------------------------------
delete from public.app_settings
where key in ('excessive_tolls', 'excessive_window_hours', 'night_window');
