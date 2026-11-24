-- 0077: a destination on a tracked truck, and public read-only trip links.
--
-- Owner's ask (24 Nov 2026):
--   1. The owner may set where a truck is heading. The app shows roughly how
--      far is left (straight line from the latest crossing x 1.25 road factor),
--      "Near destination" inside ~15 km, and "Moving away from destination"
--      when the latest crossing is >25 km farther than the one before. All of
--      that is worked out in the app (src/lib/destination.ts); only the chosen
--      place is stored here.
--   2. "Share trip": a random-token link https://rahdari.in/t/<token> that
--      anyone can open without signing in. Read-only, 7 days by default, and
--      the owner can revoke it. The public page (src/app/t/[token]/page.tsx)
--      shows the masked plate, the latest crossings and the destination -
--      never the label, the account or any owner detail.
--
-- Adds columns and one table; nothing existing is changed. Until this is
-- applied the app reads the new columns as missing (no destination) and the
-- Share button reports that sharing is not available yet.

-- ---------------------------------------------------------------------------
-- 1. destination on tracked_trucks
-- ---------------------------------------------------------------------------
alter table public.tracked_trucks
  add column if not exists destination_name   text,
  add column if not exists destination_lat    double precision,
  add column if not exists destination_lng    double precision,
  add column if not exists destination_set_at timestamptz;

-- All three set together or all three empty, and inside India's bounding box
-- give or take (a typo'd coordinate would otherwise read as "1,800 km left").
alter table public.tracked_trucks drop constraint if exists tracked_trucks_destination_check;
alter table public.tracked_trucks add constraint tracked_trucks_destination_check check (
  (destination_name is null and destination_lat is null and destination_lng is null)
  or (
    destination_name is not null and length(btrim(destination_name)) between 1 and 120
    and destination_lat between 5 and 38
    and destination_lng between 66 and 99
  )
);

comment on column public.tracked_trucks.destination_name is
  'Where the owner says the truck is heading (0077): a town from src/lib/places.ts or a toll plaza name. Optional; distance left is computed in the app.';

-- ---------------------------------------------------------------------------
-- 2. truck_shares: public read-only trip links
-- ---------------------------------------------------------------------------
create table if not exists public.truck_shares (
  -- The URL secret: 16 url-safe characters from 12 random bytes, made by the
  -- server action. The primary key, because the public page looks it up by
  -- nothing else.
  token             text primary key check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  tracked_truck_id  uuid not null references public.tracked_trucks (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '7 days'),
  revoked_at        timestamptz
);

comment on table public.truck_shares is
  'Public read-only trip links /t/<token> (0077). Valid while revoked_at is null and expires_at is in the future. Deleting the truck deletes its links.';

-- The truck page: this truck's live link, newest first.
create index if not exists truck_shares_truck_idx
  on public.truck_shares (tracked_truck_id, created_at desc);

-- Service role only, like every other table the app writes (0063, 0066, 0072).
-- The public page reads through the server, never from the browser.
alter table public.truck_shares enable row level security;
revoke all on public.truck_shares from public, anon, authenticated;
grant select, insert, update, delete on public.truck_shares to service_role;
