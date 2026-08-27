-- ===========================================================================
-- GST Truck Intelligence Platform - initial schema
--
-- Hierarchy:  Super Admin (you)  ->  Officer (GST officer, the end user)
-- There is no tenant-admin layer. Every officer only ever sees their own rows.
--
-- LIMIT ENCODING (important):
--   plans.<numeric limit>              -1  = unlimited,  >= 0 = hard cap
--   user_limit_overrides.<any column>  NULL = inherit from the plan
-- So "unlimited" is -1 and "not overridden" is NULL. Never mix them up.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('super_admin', 'officer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.account_status as enum ('active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.query_source as enum ('manual', 'tracking');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.truck_status as enum ('moving', 'idle', 'no_activity', 'unknown');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- plans - fully editable from the admin panel
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id                            uuid primary key default gen_random_uuid(),
  name                          text not null unique,
  description                   text,

  truck_limit                   integer not null default 10   check (truck_limit >= -1),
  manual_search_limit_per_day   integer not null default 20   check (manual_search_limit_per_day >= -1),
  tracking_queries_per_month    integer not null default 2000 check (tracking_queries_per_month >= -1),
  max_alert_rules               integer not null default 10   check (max_alert_rules >= -1),
  max_truck_groups              integer not null default 5    check (max_truck_groups >= -1),

  min_polling_interval_minutes  integer not null default 30   check (min_polling_interval_minutes >= 1),

  telegram_enabled              boolean not null default true,
  google_sheet_enabled          boolean not null default true,
  alert_rules_enabled           boolean not null default true,

  price_per_month               numeric(10, 2) not null default 0,
  is_active                     boolean not null default true,
  sort_order                    integer not null default 100,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles - 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,
  full_name         text,
  phone             text,
  designation       text,
  office            text,
  district          text,
  state             text default 'Gujarat',
  role              public.user_role not null default 'officer',
  status            public.account_status not null default 'active',

  plan_id           uuid references public.plans (id) on delete set null,
  plan_assigned_at  timestamptz,
  plan_expires_on   date,

  notes             text,
  last_active_at    timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists profiles_role_idx   on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists profiles_plan_idx   on public.profiles (plan_id);

-- ---------------------------------------------------------------------------
-- user_limit_overrides - per-officer tweaks on top of the plan
--   NULL column = inherit from plan.  -1 = unlimited.
-- ---------------------------------------------------------------------------
create table if not exists public.user_limit_overrides (
  user_id                       uuid primary key references public.profiles (id) on delete cascade,
  truck_limit                   integer check (truck_limit >= -1),
  manual_search_limit_per_day   integer check (manual_search_limit_per_day >= -1),
  tracking_queries_per_month    integer check (tracking_queries_per_month >= -1),
  max_alert_rules               integer check (max_alert_rules >= -1),
  max_truck_groups              integer check (max_truck_groups >= -1),
  min_polling_interval_minutes  integer check (min_polling_interval_minutes >= 1),
  telegram_enabled              boolean,
  google_sheet_enabled          boolean,
  alert_rules_enabled           boolean,
  reason                        text,
  updated_at                    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tracked_trucks - trucks an officer put under background polling
-- ---------------------------------------------------------------------------
create table if not exists public.tracked_trucks (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  truck_number              text not null,
  label                     text,
  polling_interval_minutes  integer not null default 30 check (polling_interval_minutes >= 1),
  is_active                 boolean not null default true,
  is_watchlist              boolean not null default false,

  last_polled_at            timestamptz,
  last_event_at             timestamptz,
  last_location             text,
  last_direction            text,
  status                    public.truck_status not null default 'unknown',
  consecutive_errors        integer not null default 0,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (user_id, truck_number)
);

create index if not exists tracked_trucks_user_idx   on public.tracked_trucks (user_id);
create index if not exists tracked_trucks_number_idx on public.tracked_trucks (truck_number);
create index if not exists tracked_trucks_due_idx    on public.tracked_trucks (is_active, last_polled_at);

-- ---------------------------------------------------------------------------
-- truck_events - one row per toll-plaza crossing (seq_no is unique per event)
-- ---------------------------------------------------------------------------
create table if not exists public.truck_events (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  tracked_truck_id  uuid references public.tracked_trucks (id) on delete set null,
  truck_number      text not null,
  seq_no            text not null,
  event_time        timestamptz,
  event_time_raw    text,
  loc_name          text,
  lat               numeric(10, 6),
  lng               numeric(10, 6),
  direction         text,
  event_name        text,
  fetched_at        timestamptz not null default now(),
  unique (user_id, seq_no)
);

create index if not exists truck_events_user_time_idx on public.truck_events (user_id, event_time desc);
create index if not exists truck_events_truck_idx     on public.truck_events (truck_number, event_time desc);

-- ---------------------------------------------------------------------------
-- search_logs - every LDB call, manual or automatic. Billing + audit.
-- ---------------------------------------------------------------------------
create table if not exists public.search_logs (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  truck_number  text not null,
  source        public.query_source not null,
  ok            boolean not null default true,
  http_status   integer,
  response_ms   integer,
  events_found  integer not null default 0,
  new_events    integer not null default 0,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists search_logs_user_time_idx on public.search_logs (user_id, created_at desc);
create index if not exists search_logs_source_idx    on public.search_logs (source, created_at desc);

-- ---------------------------------------------------------------------------
-- alert_rules / alert_logs
-- ---------------------------------------------------------------------------
create table if not exists public.alert_rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  name            text not null,
  -- approaching_city | state_entry | state_exit | no_movement |
  -- excessive_movement | watchlist_move | night_travel | route_prediction
  kind            text not null,
  config          jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  notify_telegram boolean not null default true,
  notify_sheet    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists alert_rules_user_idx on public.alert_rules (user_id);

create table if not exists public.alert_logs (
  id             bigserial primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  alert_rule_id  uuid references public.alert_rules (id) on delete set null,
  truck_number   text,
  kind           text,
  title          text not null,
  message        text,
  delivered      boolean not null default false,
  delivery_error text,
  created_at     timestamptz not null default now()
);

create index if not exists alert_logs_user_time_idx on public.alert_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integrations, one row per officer
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_configs (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  chat_id     text,
  bot_token   text,          -- null => use the platform-wide bot
  is_enabled  boolean not null default true,
  verified_at timestamptz,
  last_error  text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.google_sheet_configs (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  spreadsheet_id text,
  sheet_url      text,
  is_enabled     boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- truck_groups - "case folders" (e.g. a fake-billing investigation)
-- ---------------------------------------------------------------------------
create table if not exists public.truck_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.truck_group_members (
  group_id     uuid not null references public.truck_groups (id) on delete cascade,
  truck_number text not null,
  added_at     timestamptz not null default now(),
  primary key (group_id, truck_number)
);

-- ---------------------------------------------------------------------------
-- usage_counters - one row per officer per day. Monthly = sum over the month.
-- Dates are IST, because that is the day an officer thinks in.
-- ---------------------------------------------------------------------------
create table if not exists public.usage_counters (
  user_id          uuid not null references public.profiles (id) on delete cascade,
  usage_date       date not null default (now() at time zone 'Asia/Kolkata')::date,
  manual_searches  integer not null default 0,
  tracking_queries integer not null default 0,
  alerts_sent      integer not null default 0,
  primary key (user_id, usage_date)
);

create index if not exists usage_counters_date_idx on public.usage_counters (usage_date desc);

-- ---------------------------------------------------------------------------
-- audit_logs - who changed what in the admin panel
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           bigserial primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_email  text,
  action       text not null,
  entity       text,
  entity_id    text,
  entity_label text,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_time_idx  on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- app_settings - global knobs editable from /admin/settings
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end $fn$;

do $blk$
declare t text;
begin
  foreach t in array array[
    'plans', 'profiles', 'user_limit_overrides', 'tracked_trucks',
    'alert_rules', 'telegram_configs', 'google_sheet_configs'
  ] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s '
      'for each row execute function public.touch_updated_at()', t);
  end loop;
end $blk$;
