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
-- max_alert_rules counted something that no longer exists. 0008 retires its
-- replacement too, once the interval floor moved onto each alert rule.
--
-- The views are dropped first because they select the column being removed.
-- ---------------------------------------------------------------------------
drop view if exists public.officer_overview;
drop view if exists public.officer_effective_limits;

alter table public.plans                drop column if exists max_alert_rules;
alter table public.user_limit_overrides drop column if exists max_alert_rules;


-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- officer_effective_limits / officer_overview are defined once, at the end of
-- 0008, on the final column set. They used to be rebuilt here too, so every
-- limit change had to be made in three files and one was always stale.
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
