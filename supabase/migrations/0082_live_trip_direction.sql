-- 0082: Live tracking is managed through TRIPS (design: docs/LIVE-MODULE.md).
--
-- Every trip now has a direction:
--   outgoing - we send (to a dealer / customer / own site / other). Driver and
--              truck are picked from our masters. Existing trips = outgoing.
--   incoming - a supplier / dealer sends to us and does not use the app. We
--              create the trip on their behalf; the driver, truck and the
--              supplier's place are typed on the trip only (trip-only info,
--              never shown in masters, never reused).
--
-- ADDITIVE ONLY. New nullable columns (or columns with a default); nothing is
-- deleted, no constraint is tightened on existing rows.
--
-- Trip-only drivers reuse the 0081 'one_time' driver kind (they still need a
-- live_drivers row for the /d/<token> phone link, positions and the log), and
-- their sharing ends by itself after the trip (live_profiles.one_time_expire_hours).
-- Masters and pickers now show only kind = 'own'; existing one_time drivers are
-- kept as they are (their links, trips and positions keep working) and are
-- simply no longer listed in masters.

alter table public.live_trips
  add column if not exists direction      text not null default 'outgoing',
  add column if not exists party_type     text,
  add column if not exists party_name     text,
  add column if not exists from_address   text,
  add column if not exists to_address     text,
  add column if not exists inline_driver  boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'live_trips_direction_chk') then
    alter table public.live_trips add constraint live_trips_direction_chk
      check (direction in ('outgoing', 'incoming'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_party_type_chk') then
    alter table public.live_trips add constraint live_trips_party_type_chk
      check (party_type is null or party_type in ('dealer', 'customer', 'internal', 'supplier', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_party_name_chk') then
    alter table public.live_trips add constraint live_trips_party_name_chk
      check (party_name is null or length(party_name) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_from_address_chk') then
    alter table public.live_trips add constraint live_trips_from_address_chk
      check (from_address is null or length(from_address) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'live_trips_to_address_chk') then
    alter table public.live_trips add constraint live_trips_to_address_chk
      check (to_address is null or length(to_address) <= 300);
  end if;
end $$;

create index if not exists live_trips_owner_direction_idx on public.live_trips (owner_id, direction, created_at desc);

comment on column public.live_trips.direction is
  '0082: outgoing = we send (driver/truck from masters); incoming = supplier sends to us (driver/truck/from typed on the trip only).';
comment on column public.live_trips.party_type is
  '0082: who the other side is: dealer / customer / internal / supplier / other.';
comment on column public.live_trips.party_name is
  '0082: incoming = supplier / dealer company name (trip-only). Outgoing uses to_name.';
comment on column public.live_trips.inline_driver is
  '0082: true when the driver was typed on this trip (incoming). That driver row is kind one_time and hidden from masters.';
