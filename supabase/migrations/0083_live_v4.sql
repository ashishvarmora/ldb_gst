-- 0083: Live tracking v4 (design: docs/LIVE-PLAN-v4.md).
--
-- ADDITIVE ONLY. New nullable columns or columns with defaults, two indexes
-- RELAXED (never tightened), snapshot triggers that only write text onto
-- trips before a master row is deleted. No status value is rewritten: the
-- four user-facing states are a mapping of the existing six (see `phase`).
-- Every /d/<token> and /track/<token> link keeps working.

/* -------------------------------------------------------------------------- */
/* masters: user-defined fields                                                 */
/* -------------------------------------------------------------------------- */

alter table public.live_drivers  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.live_vehicles add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.live_places   add column if not exists custom_fields jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_drivers_custom_fields_chk') then
    alter table public.live_drivers add constraint live_drivers_custom_fields_chk
      check (jsonb_typeof(custom_fields) = 'object' and length(custom_fields::text) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_vehicles_custom_fields_chk') then
    alter table public.live_vehicles add constraint live_vehicles_custom_fields_chk
      check (jsonb_typeof(custom_fields) = 'object' and length(custom_fields::text) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_places_custom_fields_chk') then
    alter table public.live_places add constraint live_places_custom_fields_chk
      check (jsonb_typeof(custom_fields) = 'object' and length(custom_fields::text) <= 4000);
  end if;
end $$;

/* -------------------------------------------------------------------------- */
/* trips: temporary truck, custom-place map links, archive, route cache, phase  */
/* -------------------------------------------------------------------------- */

alter table public.live_trips
  add column if not exists temp_truck       boolean not null default false,
  add column if not exists from_maps_url    text,
  add column if not exists to_maps_url      text,
  add column if not exists archived_at      timestamptz,
  add column if not exists route_waypoints  jsonb,
  add column if not exists route_at         timestamptz,
  add column if not exists route_lat        double precision,
  add column if not exists route_lng        double precision,
  add column if not exists route_source     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_trips_from_maps_url_chk') then
    alter table public.live_trips add constraint live_trips_from_maps_url_chk
      check (from_maps_url is null or (length(from_maps_url) <= 500 and from_maps_url ~ '^https://'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_to_maps_url_chk') then
    alter table public.live_trips add constraint live_trips_to_maps_url_chk
      check (to_maps_url is null or (length(to_maps_url) <= 500 and to_maps_url ~ '^https://'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_route_source_chk') then
    alter table public.live_trips add constraint live_trips_route_source_chk
      check (route_source is null or route_source in ('ai', 'rules'));
  end if;
end $$;

-- Planned / Active / Done / Cancelled, from the six stored statuses.
alter table public.live_trips
  add column if not exists phase text generated always as (
    case status
      when 'planned'    then 'planned'
      when 'loading'    then 'planned'
      when 'in_transit' then 'active'
      when 'arrived'    then 'active'
      when 'delivered'  then 'done'
      else 'cancelled'
    end
  ) stored;

-- Temporary drivers typed on a trip of either direction (was: receiving only).
update public.live_trips t
   set inline_driver = true
  from public.live_drivers d
 where t.driver_id = d.id and d.kind = 'one_time' and not t.inline_driver;

-- Temporary trucks: a number on the trip with no master row.
update public.live_trips set temp_truck = true where vehicle_id is null and vehicle_no is not null and not temp_truck;

create index if not exists live_trips_owner_dir_created_idx
  on public.live_trips (owner_id, direction, created_at desc) where archived_at is null;
create index if not exists live_trips_vehicle_id_idx on public.live_trips (vehicle_id, created_at desc) where vehicle_id is not null;
create index if not exists live_trips_from_place_idx on public.live_trips (from_place_id) where from_place_id is not null;
create index if not exists live_trips_to_place_idx on public.live_trips (to_place_id) where to_place_id is not null;

/* -------------------------------------------------------------------------- */
/* one ACTIVE trip per driver (was: one open trip) - a relaxation               */
/* -------------------------------------------------------------------------- */

drop index if exists public.live_trips_driver_open_uniq;
do $$
begin
  if exists (
    select 1 from public.live_trips
     where driver_id is not null and status in ('in_transit', 'arrived')
     group by driver_id having count(*) > 1
  ) then
    raise notice '0083: some drivers have 2+ active trips; unique index skipped (the server still blocks new ones).';
  else
    create unique index if not exists live_trips_driver_active_uniq
      on public.live_trips (driver_id)
      where driver_id is not null and status in ('in_transit', 'arrived');
  end if;
end $$;

/* -------------------------------------------------------------------------- */
/* drivers: one mobile per OWN driver; temporary drivers may repeat a mobile   */
/* -------------------------------------------------------------------------- */

drop index if exists public.live_drivers_owner_phone_uniq;
create unique index if not exists live_drivers_owner_phone_own_uniq
  on public.live_drivers (owner_id, phone) where phone is not null and kind = 'own';
create index if not exists live_drivers_owner_phone_idx on public.live_drivers (owner_id, phone) where phone is not null;

/* -------------------------------------------------------------------------- */
/* activity: change reason + the trip phase the row belongs to                  */
/* -------------------------------------------------------------------------- */

alter table public.live_trip_events
  add column if not exists reason text,
  add column if not exists phase  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_trip_events_reason_chk') then
    alter table public.live_trip_events add constraint live_trip_events_reason_chk
      check (reason is null or length(reason) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trip_events_phase_chk') then
    alter table public.live_trip_events add constraint live_trip_events_phase_chk
      check (phase is null or phase in ('planned', 'active', 'done', 'cancelled'));
  end if;
end $$;

-- Backfill: which phase the trip was in when the row was written.
update public.live_trip_events e
   set phase = case
                 when t.cancelled_at is not null and e.created_at >= t.cancelled_at then 'cancelled'
                 when t.delivered_at is not null and e.created_at >= t.delivered_at then 'done'
                 when t.started_at   is not null and e.created_at >= t.started_at   then 'active'
                 else 'planned'
               end
  from public.live_trips t
 where e.trip_id = t.id and e.phase is null;

create index if not exists live_trip_events_vehicle_idx on public.live_trip_events (vehicle_id, created_at desc) where vehicle_id is not null;

/* -------------------------------------------------------------------------- */
/* hard delete of masters: copy what trips need BEFORE the FK clears the link  */
/* -------------------------------------------------------------------------- */

create or replace function public.live_place_snapshot_on_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.live_trips
     set from_name    = coalesce(from_name, left(old.name, 120)),
         from_address = coalesce(from_address, left(old.address, 300)),
         from_lat     = coalesce(from_lat, old.lat),
         from_lng     = coalesce(from_lng, old.lng)
   where from_place_id = old.id;
  update public.live_trips
     set to_name    = coalesce(to_name, left(old.name, 120)),
         to_address = coalesce(to_address, left(old.address, 300)),
         to_city    = coalesce(to_city, left(old.city, 80)),
         to_lat     = coalesce(to_lat, old.lat),
         to_lng     = coalesce(to_lng, old.lng)
   where to_place_id = old.id;
  return old;
end;
$$;

create or replace function public.live_driver_snapshot_on_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.live_trips
     set driver_name  = coalesce(driver_name, left(old.name, 80)),
         driver_phone = coalesce(driver_phone, old.phone)
   where driver_id = old.id;
  return old;
end;
$$;

create or replace function public.live_vehicle_snapshot_on_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.live_trips
     set vehicle_no = coalesce(vehicle_no, old.number)
   where vehicle_id = old.id;
  return old;
end;
$$;

drop trigger if exists live_places_snapshot on public.live_places;
create trigger live_places_snapshot
  before delete on public.live_places
  for each row execute function public.live_place_snapshot_on_delete();

drop trigger if exists live_drivers_snapshot on public.live_drivers;
create trigger live_drivers_snapshot
  before delete on public.live_drivers
  for each row execute function public.live_driver_snapshot_on_delete();

drop trigger if exists live_vehicles_snapshot on public.live_vehicles;
create trigger live_vehicles_snapshot
  before delete on public.live_vehicles
  for each row execute function public.live_vehicle_snapshot_on_delete();

revoke all on function public.live_place_snapshot_on_delete() from public, anon, authenticated;
revoke all on function public.live_driver_snapshot_on_delete() from public, anon, authenticated;
revoke all on function public.live_vehicle_snapshot_on_delete() from public, anon, authenticated;

comment on column public.live_trips.phase is
  '0083: planned (planned, loading) / active (in_transit, arrived) / done (delivered) / cancelled.';
comment on column public.live_trips.temp_truck is
  '0083: truck number typed on the trip, not a master.';
comment on column public.live_trip_events.reason is
  '0083: why a driver / truck / destination was changed on an Active trip.';
