-- 0081: Live tracking becomes DRIVER-FIRST (design: docs/LIVE-MODULE.md).
--
-- Tracking follows the driver's phone, not the truck. The driver is the main
-- record and owns the phone link (/d/<token>); a trip is optional. Two kinds
-- of driver:
--   own       - the account's own driver: shares until HE stops (no expiry);
--   one_time  - a dealer's / supplier's driver: sharing ends by itself
--               (live_profiles.one_time_expire_hours, default 1 h) after his
--               trip is delivered or cancelled.
--
-- ADDITIVE ONLY. New columns are nullable or have defaults; the two
-- "drop not null" below only RELAX a constraint (a position or an activity
-- row may now belong to a driver with no trip). Nothing is deleted.
--
-- COMPAT. Every /d/<token> link already sent keeps working:
--   * each trip without a driver gets one (by mobile, else one per trip);
--   * each driver's share_token = the token of his latest trip link, so that
--     link is now the driver's own link;
--   * older trip tokens still resolve (trip -> its driver) in src/lib/live/driver.ts.
-- T-0001 and every other trip keep their number, token, positions and timeline.

/* -------------------------------------------------------------------------- */
/* business profile for the Live app (one row per workspace owner)             */
/* -------------------------------------------------------------------------- */

create table if not exists public.live_profiles (
  owner_id               uuid primary key references public.profiles (id) on delete cascade,
  business_name          text check (business_name is null or length(business_name) between 1 and 120),
  gstin                  text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  contact_name           text check (contact_name is null or length(contact_name) <= 80),
  contact_phone          text check (contact_phone is null or contact_phone ~ '^\+91[6-9][0-9]{9}$'),
  business_type          text check (business_type is null or business_type in
                           ('manufacturer', 'trader', 'distributor', 'transporter', 'other')),
  default_place_id       uuid references public.live_places (id) on delete set null,
  -- One-time (dealer/supplier) drivers stop sharing this long after the trip ends.
  one_time_expire_hours  integer not null default 1 check (one_time_expire_hours between 1 and 72),
  -- Push/Telegram: trip moves made by the driver (started/reached/delivered).
  notify_status          boolean not null default true,
  -- Push/Telegram: problems (late, no GPS, e-way bill, stoppage).
  notify_alerts          boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

/* -------------------------------------------------------------------------- */
/* drivers: kind + the phone link + last position live on the driver           */
/* -------------------------------------------------------------------------- */

alter table public.live_drivers
  add column if not exists kind                text not null default 'own',
  add column if not exists company             text,
  add column if not exists share_token         text,
  add column if not exists share_status        text not null default 'invited',
  add column if not exists share_consent_at    timestamptz,
  add column if not exists share_last_seen_at  timestamptz,
  add column if not exists share_expires_at    timestamptz,
  add column if not exists last_lat            double precision,
  add column if not exists last_lng            double precision,
  add column if not exists last_speed_kmh      real,
  add column if not exists last_accuracy_m     real,
  add column if not exists last_point_at       timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_drivers_kind_chk') then
    alter table public.live_drivers add constraint live_drivers_kind_chk check (kind in ('own', 'one_time'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_drivers_company_chk') then
    alter table public.live_drivers add constraint live_drivers_company_chk check (company is null or length(company) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_drivers_share_status_chk') then
    alter table public.live_drivers add constraint live_drivers_share_status_chk
      check (share_status in ('invited', 'active', 'stopped', 'revoked', 'expired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_drivers_share_token_chk') then
    alter table public.live_drivers add constraint live_drivers_share_token_chk
      check (share_token is null or length(share_token) between 16 and 64);
  end if;
end $$;

create unique index if not exists live_drivers_share_token_uniq on public.live_drivers (share_token) where share_token is not null;
create index if not exists live_drivers_expiry_idx on public.live_drivers (share_expires_at) where share_expires_at is not null;

comment on column public.live_drivers.kind is
  '0081: own = tracked until the driver stops; one_time = dealer/supplier driver, sharing expires after the trip.';
comment on column public.live_drivers.share_token is
  '0081: the driver''s /d/<token> link. Works with or without a trip.';

/* -------------------------------------------------------------------------- */
/* trucks: who owns the truck                                                   */
/* -------------------------------------------------------------------------- */

alter table public.live_vehicles add column if not exists owner_type text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_vehicles_owner_type_chk') then
    alter table public.live_vehicles add constraint live_vehicles_owner_type_chk
      check (owner_type is null or owner_type in ('own', 'dealer', 'supplier', 'transporter'));
  end if;
end $$;

update public.live_vehicles
   set owner_type = case when ownership = 'own' then 'own' else 'transporter' end
 where owner_type is null;

/* -------------------------------------------------------------------------- */
/* trips: purpose, fixed name, free-text origin                                 */
/* -------------------------------------------------------------------------- */

alter table public.live_trips
  add column if not exists purpose    text,
  add column if not exists trip_name  text,
  add column if not exists from_name  text,
  add column if not exists from_lat   double precision,
  add column if not exists from_lng   double precision;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_trips_purpose_chk') then
    alter table public.live_trips add constraint live_trips_purpose_chk
      check (purpose is null or purpose in ('dispatch', 'pickup', 'transfer', 'return', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_trip_name_chk') then
    alter table public.live_trips add constraint live_trips_trip_name_chk
      check (trip_name is null or length(trip_name) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_from_name_chk') then
    alter table public.live_trips add constraint live_trips_from_name_chk
      check (from_name is null or length(from_name) <= 120);
  end if;
end $$;

-- Trip number and trip name never change once the trip exists.
create or replace function public.live_trips_fixed_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.trip_seq is distinct from old.trip_seq then
    raise exception 'trip number cannot change';
  end if;
  if new.trip_name is distinct from old.trip_name then
    raise exception 'trip name cannot change';
  end if;
  return new;
end;
$$;

drop trigger if exists live_trips_fixed_identity on public.live_trips;
create trigger live_trips_fixed_identity
  before update of trip_seq, trip_name on public.live_trips
  for each row execute function public.live_trips_fixed_identity();
revoke all on function public.live_trips_fixed_identity() from public, anon, authenticated;

/* -------------------------------------------------------------------------- */
/* truck <-> driver assignments (history; one open row per driver / per truck) */
/* -------------------------------------------------------------------------- */

create table if not exists public.live_assignments (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  driver_id     uuid not null references public.live_drivers (id) on delete cascade,
  vehicle_id    uuid not null references public.live_vehicles (id) on delete cascade,
  trip_id       uuid references public.live_trips (id) on delete set null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  ended_reason  text check (ended_reason is null or length(ended_reason) <= 80),
  actor         text not null default 'owner' check (actor in ('owner', 'driver', 'system'))
);

create unique index if not exists live_assignments_driver_open_uniq
  on public.live_assignments (driver_id) where ended_at is null;
create unique index if not exists live_assignments_vehicle_open_uniq
  on public.live_assignments (vehicle_id) where ended_at is null;
create index if not exists live_assignments_owner_idx on public.live_assignments (owner_id, started_at desc);

/* -------------------------------------------------------------------------- */
/* activity log: driver-level rows and field changes                           */
/* -------------------------------------------------------------------------- */

alter table public.live_trip_events
  add column if not exists driver_id      uuid references public.live_drivers (id) on delete set null,
  add column if not exists vehicle_id     uuid references public.live_vehicles (id) on delete set null,
  add column if not exists field          text,
  add column if not exists old_value      text,
  add column if not exists new_value      text,
  add column if not exists actor_user_id  uuid;

-- A driver event (sharing, gaps, truck changes) may have no trip.
alter table public.live_trip_events alter column trip_id drop not null;

create index if not exists live_trip_events_driver_idx on public.live_trip_events (driver_id, created_at desc);
create unique index if not exists live_trip_events_driver_dedupe_uniq
  on public.live_trip_events (driver_id, dedupe_key) where trip_id is null and dedupe_key is not null;

/* -------------------------------------------------------------------------- */
/* positions: keyed to the driver (and the trip when there is one)             */
/* -------------------------------------------------------------------------- */

alter table public.live_locations
  add column if not exists driver_id uuid references public.live_drivers (id) on delete set null;
alter table public.live_locations alter column trip_id drop not null;
create index if not exists live_locations_driver_time_idx on public.live_locations (driver_id, recorded_at desc);

/* -------------------------------------------------------------------------- */
/* backfill                                                                     */
/* -------------------------------------------------------------------------- */

-- 1. Trips with a driver mobile but no driver row: link by mobile, create if needed.
update public.live_trips t
   set driver_id = d.id
  from public.live_drivers d
 where t.driver_id is null and t.driver_phone is not null
   and d.owner_id = t.owner_id and d.phone = t.driver_phone;

insert into public.live_drivers (owner_id, name, phone)
select distinct on (t.owner_id, t.driver_phone)
       t.owner_id, coalesce(nullif(trim(t.driver_name), ''), 'Driver'), t.driver_phone
  from public.live_trips t
 where t.driver_id is null and t.driver_phone is not null
 order by t.owner_id, t.driver_phone, t.created_at desc
on conflict do nothing;

update public.live_trips t
   set driver_id = d.id
  from public.live_drivers d
 where t.driver_id is null and t.driver_phone is not null
   and d.owner_id = t.owner_id and d.phone = t.driver_phone;

-- 2. Trips with a phone link but still no driver (no mobile typed): one driver each.
do $$
declare
  r record;
  new_id uuid;
begin
  for r in
    select id, owner_id, trip_seq, driver_name
      from public.live_trips
     where driver_id is null and driver_token is not null
  loop
    insert into public.live_drivers (owner_id, name, notes)
    values (
      r.owner_id,
      coalesce(nullif(trim(r.driver_name), ''), 'Driver (T-' || lpad(r.trip_seq::text, 4, '0') || ')'),
      'Created by 0081 for trip T-' || lpad(r.trip_seq::text, 4, '0') || ' (no mobile was saved).'
    )
    returning id into new_id;
    update public.live_trips set driver_id = new_id where id = r.id;
  end loop;
end $$;

-- 3. Each driver's link = his latest trip link (open trips first). Same token,
--    so a link already on the driver's phone keeps reporting.
update public.live_drivers d
   set share_token        = s.driver_token,
       share_status       = case
                              when s.share_status = 'revoked' then 'revoked'
                              when s.open then s.share_status
                              when s.share_status = 'active' then 'stopped'
                              else s.share_status
                            end,
       share_consent_at   = coalesce(d.share_consent_at, s.share_consent_at, d.consent_at),
       share_last_seen_at = s.share_last_seen_at,
       last_lat           = s.last_lat,
       last_lng           = s.last_lng,
       last_speed_kmh     = s.last_speed_kmh,
       last_point_at      = s.last_point_at
  from (
    select distinct on (t.driver_id)
           t.driver_id, t.driver_token, t.share_status, t.share_consent_at, t.share_last_seen_at,
           t.last_lat, t.last_lng, t.last_speed_kmh, t.last_point_at,
           t.status in ('planned', 'loading', 'in_transit', 'arrived') as open
      from public.live_trips t
     where t.driver_id is not null and t.driver_token is not null
     order by t.driver_id, (t.status in ('planned', 'loading', 'in_transit', 'arrived')) desc, t.created_at desc
  ) s
 where d.id = s.driver_id and d.share_token is null
   and not exists (select 1 from public.live_drivers x where x.share_token = s.driver_token);

-- Drivers with no link yet get a fresh one (gen_random_uuid is cryptographically random).
update public.live_drivers
   set share_token = replace(gen_random_uuid()::text, '-', '')
 where share_token is null;

-- 4. Positions and activity rows learn their driver.
update public.live_locations l
   set driver_id = t.driver_id
  from public.live_trips t
 where l.trip_id = t.id and l.driver_id is null and t.driver_id is not null;

update public.live_trip_events e
   set driver_id = t.driver_id, vehicle_id = coalesce(e.vehicle_id, t.vehicle_id)
  from public.live_trips t
 where e.trip_id = t.id and e.driver_id is null and t.driver_id is not null;

-- 5. Open trips with a driver and a truck become the current assignment
--    (latest per driver, then latest per truck, skipping any conflict).
insert into public.live_assignments (owner_id, driver_id, vehicle_id, trip_id, started_at, actor)
select x.owner_id, x.driver_id, x.vehicle_id, x.id, coalesce(x.started_at, x.created_at), 'system'
  from (
    select distinct on (y.vehicle_id) y.*
      from (
        select distinct on (t.driver_id) t.*
          from public.live_trips t
         where t.status in ('planned', 'loading', 'in_transit', 'arrived')
           and t.driver_id is not null and t.vehicle_id is not null
         order by t.driver_id, t.created_at desc
      ) y
     order by y.vehicle_id, y.created_at desc
  ) x
 where not exists (select 1 from public.live_assignments a where a.ended_at is null and (a.driver_id = x.driver_id or a.vehicle_id = x.vehicle_id));

-- 6. Business profile rows for accounts already using Live.
insert into public.live_profiles (owner_id, business_name)
select p.id, nullif(left(trim(coalesce(p.office, '')), 120), '')
  from public.profiles p
 where 'live' = any (p.modules)
on conflict (owner_id) do nothing;

/* -------------------------------------------------------------------------- */
/* one open trip per driver (enforced in the server too)                        */
/* -------------------------------------------------------------------------- */

do $$
begin
  if exists (
    select 1 from public.live_trips
     where driver_id is not null and status in ('planned', 'loading', 'in_transit', 'arrived')
     group by driver_id having count(*) > 1
  ) then
    raise notice '0081: some drivers have 2+ open trips; unique index skipped (server still blocks new ones). Close the extras and re-run this block.';
  else
    create unique index if not exists live_trips_driver_open_uniq
      on public.live_trips (driver_id)
      where driver_id is not null and status in ('planned', 'loading', 'in_transit', 'arrived');
  end if;
end $$;

/* -------------------------------------------------------------------------- */
/* access: service role only (like 0079)                                        */
/* -------------------------------------------------------------------------- */

alter table public.live_profiles    enable row level security;
alter table public.live_assignments enable row level security;

revoke all on public.live_profiles, public.live_assignments from public, anon, authenticated;
grant select, insert, update, delete on public.live_profiles, public.live_assignments to service_role;
