-- 0079: the Live tracking module (GPS from the driver's phone), separate from
-- the toll module.
--
-- Rahdari = [Toll tracking] + [Live tracking]. Same login, own space (/live).
-- Design note: docs/LIVE-MODULE.md.
--
-- WORKSPACE. Every live_* row carries owner_id = the account (profiles.id)
-- that owns the data. Today a workspace is one account. When team members
-- arrive (manager, dispatcher) a live_members(owner_id, user_id, role) table
-- maps a signed-in user to the owner_id they work in; no column below changes.
--
-- Additive only. Nothing in the toll module reads these tables. Service role
-- only, like 0072/0078: every read and write goes through the server
-- (src/lib/live/*.ts, src/app/live/actions.ts, /api/driver/*, /track/*).
--
-- COMPAT (0078). Every open truck_drivers link is copied into a live trip that
-- keeps THE SAME TOKEN, so a /d/<token> link already on a driver's phone keeps
-- working and now reports into the trip. Its recent positions are copied too.
-- The 0078 tables are left in place untouched.

/* -------------------------------------------------------------------------- */
/* module switch on the account                                                */
/* -------------------------------------------------------------------------- */

alter table public.profiles
  add column if not exists modules text[] not null default '{toll}';

comment on column public.profiles.modules is
  'Apps switched on for this account (0079): toll, live. Self-serve; Live is free for now.';

/* -------------------------------------------------------------------------- */
/* places: factories, warehouses, branches, customers/dealers                  */
/* -------------------------------------------------------------------------- */

create table if not exists public.live_places (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  kind            text not null default 'customer'
                  check (kind in ('factory', 'warehouse', 'branch', 'customer', 'other')),
  name            text not null check (length(name) between 1 and 120),
  contact_name    text check (contact_name is null or length(contact_name) <= 80),
  contact_phone   text check (contact_phone is null or contact_phone ~ '^\+91[6-9][0-9]{9}$'),
  address         text check (address is null or length(address) <= 300),
  city            text check (city is null or length(city) <= 80),
  state           text check (state is null or length(state) <= 60),
  pincode         text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  gstin           text check (gstin is null or length(gstin) = 15),
  lat             double precision check (lat is null or lat between -90 and 90),
  lng             double precision check (lng is null or lng between -180 and 180),
  -- Geofence: inside this many metres of lat/lng = "at the place".
  radius_m        integer not null default 500 check (radius_m between 50 and 20000),
  notes           text check (notes is null or length(notes) <= 500),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists live_places_owner_idx on public.live_places (owner_id, kind, name);

/* -------------------------------------------------------------------------- */
/* vehicles and drivers                                                        */
/* -------------------------------------------------------------------------- */

create table if not exists public.live_vehicles (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  -- Upper case, no spaces: GJ36X1234.
  number          text not null check (number ~ '^[A-Z0-9]{4,12}$'),
  vehicle_type    text check (vehicle_type is null or length(vehicle_type) <= 40),
  -- own = the company's truck; market = hired for the trip.
  ownership       text not null default 'market' check (ownership in ('own', 'market')),
  transporter     text check (transporter is null or length(transporter) <= 120),
  capacity_kg     integer check (capacity_kg is null or capacity_kg between 0 and 100000),
  notes           text check (notes is null or length(notes) <= 300),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner_id, number)
);

create table if not exists public.live_drivers (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  name            text not null check (length(name) between 1 and 80),
  phone           text check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$'),
  license_no      text check (license_no is null or length(license_no) <= 30),
  -- First time this driver agreed to share location on a trip link.
  consent_at      timestamptz,
  notes           text check (notes is null or length(notes) <= 300),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists live_drivers_owner_phone_uniq
  on public.live_drivers (owner_id, phone) where phone is not null;
create index if not exists live_drivers_owner_idx on public.live_drivers (owner_id, name);

/* -------------------------------------------------------------------------- */
/* trips (dispatches)                                                          */
/* -------------------------------------------------------------------------- */

create table if not exists public.live_trips (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles (id) on delete cascade,
  -- Per-account running number, set by the trigger below. Shown as T-0001.
  trip_seq              integer not null default 0,

  from_place_id         uuid references public.live_places (id) on delete set null,
  to_place_id           uuid references public.live_places (id) on delete set null,
  -- Destination typed on the trip when it is not a saved place (or a snapshot).
  to_name               text check (to_name is null or length(to_name) <= 120),
  to_city               text check (to_city is null or length(to_city) <= 80),
  to_lat                double precision check (to_lat is null or to_lat between -90 and 90),
  to_lng                double precision check (to_lng is null or to_lng between -180 and 180),
  consignee_name        text check (consignee_name is null or length(consignee_name) <= 120),
  consignee_phone       text check (consignee_phone is null or consignee_phone ~ '^\+91[6-9][0-9]{9}$'),

  vehicle_id            uuid references public.live_vehicles (id) on delete set null,
  vehicle_no            text check (vehicle_no is null or vehicle_no ~ '^[A-Z0-9]{4,12}$'),
  driver_id             uuid references public.live_drivers (id) on delete set null,
  driver_name           text check (driver_name is null or length(driver_name) <= 80),
  driver_phone          text check (driver_phone is null or driver_phone ~ '^\+91[6-9][0-9]{9}$'),
  transporter           text check (transporter is null or length(transporter) <= 120),

  material              text check (material is null or length(material) <= 160),
  quantity              numeric check (quantity is null or quantity >= 0),
  quantity_unit         text check (quantity_unit is null or length(quantity_unit) <= 20),
  weight_kg             numeric check (weight_kg is null or weight_kg >= 0),
  invoice_no            text check (invoice_no is null or length(invoice_no) <= 40),
  invoice_value_inr     numeric check (invoice_value_inr is null or invoice_value_inr >= 0),
  eway_bill_no          text check (eway_bill_no is null or eway_bill_no ~ '^[0-9]{12}$'),
  eway_valid_until      timestamptz,
  lr_no                 text check (lr_no is null or length(lr_no) <= 40),
  freight_inr           numeric check (freight_inr is null or freight_inr >= 0),

  planned_dispatch_at   timestamptz,
  promised_delivery_at  timestamptz,

  status                text not null default 'planned'
                        check (status in ('planned', 'loading', 'in_transit', 'arrived', 'delivered', 'cancelled')),
  status_at             timestamptz not null default now(),
  started_at            timestamptz,
  arrived_at            timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  pod_note              text check (pod_note is null or length(pod_note) <= 500),
  notes                 text check (notes is null or length(notes) <= 1000),

  -- Driver phone link /d/<token>: the driver's only credential.
  driver_token          text unique check (driver_token is null or length(driver_token) between 16 and 64),
  share_status          text not null default 'invited'
                        check (share_status in ('invited', 'active', 'stopped', 'revoked')),
  share_consent_at      timestamptz,
  share_last_seen_at    timestamptz,

  -- Customer/consignee read-only link /track/<token>. Null = off.
  track_token           text unique check (track_token is null or length(track_token) between 16 and 64),

  -- Latest position and the worked-out ETA, cached for the lists.
  last_lat              double precision,
  last_lng              double precision,
  last_speed_kmh        real,
  last_point_at         timestamptz,
  distance_left_km      real,
  eta_at                timestamptz,
  -- Geofence memory: did the truck get seen inside the from-place?
  seen_at_origin_at     timestamptz,

  -- 0078 link this trip was carried over from (compat).
  legacy_driver_id      uuid references public.truck_drivers (id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists live_trips_owner_seq_uniq on public.live_trips (owner_id, trip_seq);
create index if not exists live_trips_owner_status_idx on public.live_trips (owner_id, status, created_at desc);
create index if not exists live_trips_active_idx on public.live_trips (status)
  where status in ('planned', 'loading', 'in_transit', 'arrived');
create index if not exists live_trips_vehicle_idx on public.live_trips (owner_id, vehicle_no);
create index if not exists live_trips_eway_idx on public.live_trips (owner_id, eway_bill_no) where eway_bill_no is not null;

-- Running trip number per account. The advisory lock serialises two inserts
-- for the same account so they cannot take the same number.
create or replace function public.live_trips_set_seq()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.trip_seq is null or new.trip_seq = 0 then
    perform pg_advisory_xact_lock(hashtext('live_trips:' || new.owner_id::text));
    select coalesce(max(trip_seq), 0) + 1 into new.trip_seq
      from public.live_trips where owner_id = new.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists live_trips_set_seq on public.live_trips;
create trigger live_trips_set_seq
  before insert on public.live_trips
  for each row execute function public.live_trips_set_seq();

/* -------------------------------------------------------------------------- */
/* trip events (timeline + notification dedupe) and positions                  */
/* -------------------------------------------------------------------------- */

create table if not exists public.live_trip_events (
  id           bigserial primary key,
  trip_id      uuid not null references public.live_trips (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  -- status | geofence_enter | geofence_exit | stoppage | delay | eway_expiring |
  -- eway_expired | no_signal | share | note | edit. Free text: a new rule needs
  -- no migration.
  kind         text not null check (length(kind) between 1 and 30),
  title        text not null check (length(title) between 1 and 200),
  detail       text check (detail is null or length(detail) <= 1000),
  actor        text not null default 'system' check (actor in ('owner', 'driver', 'system')),
  lat          double precision,
  lng          double precision,
  -- One event per key per trip: the automation's "already told the owner".
  dedupe_key   text check (dedupe_key is null or length(dedupe_key) <= 120),
  notified     boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index if not exists live_trip_events_dedupe_uniq
  on public.live_trip_events (trip_id, dedupe_key) where dedupe_key is not null;
create index if not exists live_trip_events_trip_idx on public.live_trip_events (trip_id, created_at desc);
create index if not exists live_trip_events_owner_idx on public.live_trip_events (owner_id, created_at desc);

create table if not exists public.live_locations (
  id           bigserial primary key,
  trip_id      uuid not null references public.live_trips (id) on delete cascade,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  accuracy_m   real check (accuracy_m is null or accuracy_m >= 0),
  speed_kmh    real check (speed_kmh is null or speed_kmh >= 0),
  heading      real check (heading is null or (heading >= 0 and heading < 360)),
  recorded_at  timestamptz not null,
  received_at  timestamptz not null default now(),
  source       text not null default 'phone' check (length(source) between 1 and 20)
);

create index if not exists live_locations_trip_time_idx on public.live_locations (trip_id, recorded_at desc);
create index if not exists live_locations_received_idx on public.live_locations (received_at);

/* -------------------------------------------------------------------------- */
/* access: service role only                                                   */
/* -------------------------------------------------------------------------- */

alter table public.live_places      enable row level security;
alter table public.live_vehicles    enable row level security;
alter table public.live_drivers     enable row level security;
alter table public.live_trips       enable row level security;
alter table public.live_trip_events enable row level security;
alter table public.live_locations   enable row level security;

revoke all on public.live_places, public.live_vehicles, public.live_drivers,
              public.live_trips, public.live_trip_events, public.live_locations
  from public, anon, authenticated;

grant select, insert, update, delete on public.live_places, public.live_vehicles, public.live_drivers,
              public.live_trips, public.live_trip_events, public.live_locations
  to service_role;
grant usage, select on sequence public.live_trip_events_id_seq to service_role;
grant usage, select on sequence public.live_locations_id_seq to service_role;

revoke all on function public.live_trips_set_seq() from public, anon, authenticated;

-- 30-day retention for positions, like 0078.
create or replace function public.purge_live_locations(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  gone integer;
begin
  delete from public.live_locations
   where received_at < now() - make_interval(days => greatest(p_keep_days, 1));
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function public.purge_live_locations(integer) from public, anon, authenticated;
grant execute on function public.purge_live_locations(integer) to service_role;

/* -------------------------------------------------------------------------- */
/* compat: carry every open 0078 driver link into a live trip, same token      */
/* -------------------------------------------------------------------------- */

-- Accounts that already used live location get the module switched on.
update public.profiles p
   set modules = array_append(p.modules, 'live')
 where not ('live' = any (p.modules))
   and exists (select 1 from public.truck_drivers d where d.user_id = p.id and d.status <> 'revoked');

-- Their trucks become vehicles (market by default; the owner can change it).
insert into public.live_vehicles (owner_id, number)
select distinct d.user_id, upper(regexp_replace(t.truck_number, '[^A-Za-z0-9]', '', 'g'))
  from public.truck_drivers d
  join public.tracked_trucks t on t.id = d.tracked_truck_id
 where d.status <> 'revoked'
   and upper(regexp_replace(t.truck_number, '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z0-9]{4,12}$'
on conflict (owner_id, number) do nothing;

-- Drivers with a name.
insert into public.live_drivers (owner_id, name, phone, consent_at)
select distinct on (d.user_id, d.driver_phone)
       d.user_id, coalesce(nullif(trim(d.driver_name), ''), 'Driver'), d.driver_phone, d.consent_at
  from public.truck_drivers d
 where d.status <> 'revoked' and d.driver_phone is not null
 order by d.user_id, d.driver_phone, d.created_at desc
on conflict do nothing;

-- One trip per open link, keeping the token.
insert into public.live_trips (
  owner_id, vehicle_id, vehicle_no, driver_id, driver_name, driver_phone,
  status, status_at, started_at, driver_token, share_status, share_consent_at,
  share_last_seen_at, legacy_driver_id, notes, created_at
)
select d.user_id,
       v.id,
       v.number,
       dr.id,
       d.driver_name,
       d.driver_phone,
       case when d.status = 'active' then 'in_transit' else 'planned' end,
       now(),
       case when d.status = 'active' then coalesce(d.consent_at, d.created_at) end,
       d.token,
       d.status,
       d.consent_at,
       d.last_seen_at,
       d.id,
       'Carried over from the truck page link (' || t.truck_number || ').',
       d.created_at
  from public.truck_drivers d
  join public.tracked_trucks t on t.id = d.tracked_truck_id
  left join public.live_vehicles v
         on v.owner_id = d.user_id
        and v.number = upper(regexp_replace(t.truck_number, '[^A-Za-z0-9]', '', 'g'))
  left join public.live_drivers dr on dr.owner_id = d.user_id and dr.phone = d.driver_phone
 where d.status <> 'revoked'
   and not exists (select 1 from public.live_trips x where x.driver_token = d.token);

-- Their last 7 days of positions.
insert into public.live_locations (trip_id, owner_id, lat, lng, accuracy_m, speed_kmh, heading, recorded_at, received_at, source)
select lt.id, l.user_id, l.lat, l.lng, l.accuracy_m, l.speed_kmh, l.heading, l.recorded_at, l.received_at, l.source
  from public.truck_locations l
  join public.live_trips lt on lt.legacy_driver_id = l.driver_id
 where l.recorded_at > now() - interval '7 days'
   and not exists (select 1 from public.live_locations x where x.trip_id = lt.id);

-- Cache the latest position on each carried-over trip.
update public.live_trips lt
   set last_lat = s.lat, last_lng = s.lng, last_speed_kmh = s.speed_kmh, last_point_at = s.recorded_at
  from (
    select distinct on (trip_id) trip_id, lat, lng, speed_kmh, recorded_at
      from public.live_locations
     order by trip_id, recorded_at desc
  ) s
 where s.trip_id = lt.id and lt.legacy_driver_id is not null and lt.last_point_at is null;

insert into public.live_trip_events (trip_id, owner_id, kind, title, actor)
select lt.id, lt.owner_id, 'note', 'Trip created from the earlier truck-page driver link', 'system'
  from public.live_trips lt
 where lt.legacy_driver_id is not null
   and not exists (select 1 from public.live_trip_events e where e.trip_id = lt.id);
