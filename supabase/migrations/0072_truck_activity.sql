-- 0072: truck_activity - what happened to each tracked truck, in one list.
--
-- Owner's ask (20 Nov 2026): the truck page's Activity tab must say everything
-- that happened to a truck - added, alerts added / edited / removed / switched
-- on or off, paused by the customer, taken live, stopped automatically (and
-- why), checked by hand, removed.
--
-- Most of the rest is already recorded elsewhere and is NOT copied here:
--   alert_logs          halt / still halted / moving again, every movement
--                       alert, failing-check warnings, auto-pause notices
--   credit_ledger_daily every check and its cost, per day and per truck
--   truck_events        the toll crossings themselves (the name is taken,
--                       which is why this table is not called truck_events)
--
-- Keyed on truck_number as well as tracked_truck_id: the id goes null when the
-- truck is removed (on delete set null), and a number removed and added again
-- keeps one continuous history - the same way truck_events and alert_logs are
-- read by number.
--
-- Written by the portal's server actions and the tracking worker through
-- src/lib/truck-activity.ts, which never throws: until this migration is
-- applied every write fails quietly and every read returns an empty list.

create table if not exists public.truck_activity (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  tracked_truck_id  uuid references public.tracked_trucks (id) on delete set null,
  truck_number      text not null,
  -- added | readded | alert_added | alert_edited | alert_removed | alert_on |
  -- alert_off | paused | live | auto_paused | manual_check | settings_changed |
  -- deleted. Free text rather than a check constraint so a new kind needs no
  -- migration; the app renders an unknown kind as a plain line.
  kind              text not null check (length(kind) between 1 and 40),
  detail            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.truck_activity is
  'Per-truck history of what the customer and the worker did to a tracked truck (0072): added, alerts changed, paused, live, auto-paused with reason, manual checks, removed. Crossings, alerts sent and charges live in truck_events, alert_logs and credit_transactions.';

-- The truck page's Activity tab: one account, one number, newest first.
create index if not exists truck_activity_user_truck_time_idx
  on public.truck_activity (user_id, truck_number, created_at desc);

-- /portal/activity: the account's removed trucks, newest first.
create index if not exists truck_activity_user_kind_time_idx
  on public.truck_activity (user_id, kind, created_at desc);

-- Service role only, like every other table the app writes (0063, 0066).
alter table public.truck_activity enable row level security;
revoke all on public.truck_activity from public, anon, authenticated;
grant select, insert, update, delete on public.truck_activity to service_role;
grant usage, select on sequence public.truck_activity_id_seq to service_role;
