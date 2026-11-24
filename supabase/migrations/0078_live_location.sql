-- 0078: live location from the driver's phone.
--
-- Owner's ask (24 Nov 2026): on a tracked truck, invite the driver with a link
-- (https://rahdari.in/d/<token>). The driver opens it on his phone, agrees, and
-- the page sends his GPS position every ~30 s while it is open. The owner sees
-- the latest position and a short trail on the truck page.
--
-- Two tables:
--   truck_drivers    one row per invite link. At most one link per truck is
--                    not revoked at a time (a new invite revokes the old one).
--   truck_locations  the positions themselves. `source` is 'phone' today; a
--                    hardware tracker can write here later as 'device' without
--                    a schema change.
--
-- Written and read only by the server (src/lib/live-location.ts and the
-- /api/driver/* and /api/live-location/* routes) through the service role.
-- Until this migration is applied every read returns "not shared" and every
-- invite fails with a plain message; nothing else in the app depends on it.
--
-- Retention: 30 days. purge_truck_locations() deletes older rows; the location
-- endpoint also calls a per-truck delete now and then, so the table stays
-- bounded even if nobody schedules the function.

create table if not exists public.truck_drivers (
  id                uuid primary key default gen_random_uuid(),
  tracked_truck_id  uuid not null references public.tracked_trucks (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  driver_name       text check (driver_name is null or length(driver_name) <= 80),
  -- +91XXXXXXXXXX, normalised by src/lib/phone.ts. Shown to the owner only.
  driver_phone      text check (driver_phone is null or driver_phone ~ '^\+91[6-9][0-9]{9}$'),
  -- What the driver's page says the location is shared with. Chosen by the
  -- owner at invite time, so the public page shows nothing they did not pick.
  owner_label       text check (owner_label is null or length(owner_label) <= 80),
  -- 128 random bits, base64url. The link is the only credential the driver has.
  token             text not null unique check (length(token) between 16 and 64),
  status            text not null default 'invited'
                    check (status in ('invited', 'active', 'stopped', 'revoked')),
  consent_at        timestamptz,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz
);

comment on table public.truck_drivers is
  'Driver live-location invite links (0078). One non-revoked link per truck; the token in /d/<token> is the driver''s only credential. Service role only.';

-- One live link per truck: a fresh invite revokes the previous one first.
create unique index if not exists truck_drivers_one_open_per_truck
  on public.truck_drivers (tracked_truck_id)
  where status <> 'revoked';

create index if not exists truck_drivers_user_idx
  on public.truck_drivers (user_id, created_at desc);

create table if not exists public.truck_locations (
  id                bigserial primary key,
  tracked_truck_id  uuid not null references public.tracked_trucks (id) on delete cascade,
  driver_id         uuid references public.truck_drivers (id) on delete set null,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  lat               double precision not null check (lat between -90 and 90),
  lng               double precision not null check (lng between -180 and 180),
  accuracy_m        real check (accuracy_m is null or accuracy_m >= 0),
  speed_kmh         real check (speed_kmh is null or speed_kmh >= 0),
  heading           real check (heading is null or (heading >= 0 and heading < 360)),
  -- The phone's own clock, clamped by the server to [now - 24 h, now].
  recorded_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  -- phone | device (hardware tracker, later). Free text so a new source needs
  -- no migration.
  source            text not null default 'phone' check (length(source) between 1 and 20)
);

comment on table public.truck_locations is
  'GPS positions per tracked truck (0078): from the driver''s phone today (source=phone), hardware trackers later. Kept 30 days. Service role only.';

-- The truck page: latest position and the last couple of hours, newest first.
create index if not exists truck_locations_truck_time_idx
  on public.truck_locations (tracked_truck_id, recorded_at desc);

-- The retention sweep.
create index if not exists truck_locations_received_idx
  on public.truck_locations (received_at);

-- Service role only, like every other table the app writes (0063, 0066, 0072).
alter table public.truck_drivers enable row level security;
alter table public.truck_locations enable row level security;
revoke all on public.truck_drivers from public, anon, authenticated;
revoke all on public.truck_locations from public, anon, authenticated;
grant select, insert, update, delete on public.truck_drivers to service_role;
grant select, insert, update, delete on public.truck_locations to service_role;
grant usage, select on sequence public.truck_locations_id_seq to service_role;

-- 30-day retention. Returns how many rows went. Safe to call any time, e.g.
-- from the backup/purge sweep or by hand: select public.purge_truck_locations();
create or replace function public.purge_truck_locations(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  gone integer;
begin
  delete from public.truck_locations
   where received_at < now() - make_interval(days => greatest(p_keep_days, 1));
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function public.purge_truck_locations(integer) from public, anon, authenticated;
grant execute on function public.purge_truck_locations(integer) to service_role;
