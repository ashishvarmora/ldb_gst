-- 0084: Live tracking v5 (design: docs/LIVE-PLAN-v5.md).
--
-- ADDITIVE ONLY. New nullable columns or columns with defaults and one index.
-- Nothing is rewritten or dropped. The app works before this is applied
-- (new columns are left out of writes and defaults are used on reads).

/* trips: per-trip alert switches (defaults come from live_profiles.alert_settings) */
alter table public.live_trips
  add column if not exists alert_overrides jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_trips_alert_overrides_chk') then
    alter table public.live_trips add constraint live_trips_alert_overrides_chk
      check (jsonb_typeof(alert_overrides) = 'object' and length(alert_overrides::text) <= 2000);
  end if;
end $$;

comment on column public.live_trips.alert_overrides is
  '0084: per-trip alert switches {"off":["stopped",...],"on":[...],"late_min":45}. Empty = account defaults.';
comment on column public.live_trips.started_at is
  'Actual start (first move to Active). 0084: editable by the owner with a reason (logged in live_trip_events).';

/* live profile: default alerts + customer page options */
alter table public.live_profiles
  add column if not exists alert_settings    jsonb   not null default '{}'::jsonb,
  add column if not exists track_show_driver boolean not null default true,
  add column if not exists track_call_driver boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_profiles_alert_settings_chk') then
    alter table public.live_profiles add constraint live_profiles_alert_settings_chk
      check (jsonb_typeof(alert_settings) = 'object' and length(alert_settings::text) <= 2000);
  end if;
end $$;

comment on column public.live_profiles.alert_settings is
  '0084: default trip alerts {"started":{"on":true},"late":{"on":true,"min":30},...}. Missing key = default on.';

/* warehouses: display type (preset or custom) and a kept Maps link */
alter table public.live_places
  add column if not exists site_type text,
  add column if not exists maps_url  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_places_site_type_chk') then
    alter table public.live_places add constraint live_places_site_type_chk
      check (site_type is null or length(site_type) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_places_maps_url_chk') then
    alter table public.live_places add constraint live_places_maps_url_chk
      check (maps_url is null or length(maps_url) <= 500);
  end if;
end $$;

/* trucks: type and capacity exist since 0079; kept here for databases that skipped them */
alter table public.live_vehicles
  add column if not exists vehicle_type text,
  add column if not exists capacity_kg  integer;

/* in-app bell: a link per alert (Live alerts open their trip) */
alter table public.alert_logs
  add column if not exists url text;

create index if not exists alert_logs_user_kind_idx on public.alert_logs (user_id, kind, created_at desc);
