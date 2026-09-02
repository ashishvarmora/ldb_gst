-- ===========================================================================
-- Sign-up was failing outright: "Database error creating new user".
--
-- The chain, from the bottom up:
--
--   make_referral_code() hashes the new account's id with digest(), which
--   comes from pgcrypto. On Supabase pgcrypto is installed into the
--   `extensions` schema, not `public`.
--
--   set_referral_code() fires BEFORE INSERT on profiles and calls it.
--
--   handle_new_user() fires AFTER INSERT on auth.users, inserts the profile,
--   and is declared `SET search_path = public`. That search_path is inherited
--   by everything it calls, so by the time digest() is looked up, `extensions`
--   is not on the path and the name does not resolve:
--
--     ERROR 42883: function digest(text, unknown) does not exist
--       at make_referral_code -> set_referral_code -> handle_new_user
--
--   The insert into auth.users rolls back with it, and GoTrue reports the
--   generic "Database error creating new user". Nobody could register.
--
-- The fix is to stop needing the extension at all. Postgres 11 and later ship
-- sha256(bytea) in pg_catalog, which is always on the search_path and can
-- never be shadowed. Same algorithm, same eight characters, so every code
-- already handed out stays valid - this is not a rotation.
--
-- Then the same class of bug is closed for the four functions that had no
-- search_path pinned at all. A function without one runs on the caller's path,
-- which is both this failure mode and the way a rogue schema earlier on the
-- path can shadow a table a SECURITY DEFINER function trusts.
--
-- Run after 0022_credit_sources_and_bonus_coupons.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The referral code, from a built-in hash
--
-- Identical output to the pgcrypto version: sha256 of the id's text form, hex,
-- first eight characters, uppercased. Verified against the old definition
-- before the swap, so existing codes and links keep working.
--
-- search_path is pinned to pg_catalog because every function used here lives
-- there. Nothing in public is referenced, so nothing in public can break it.
-- ---------------------------------------------------------------------------
create or replace function public.make_referral_code(p_id uuid)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  select upper(substr(encode(sha256(p_id::text::bytea), 'hex'), 1, 8));
$fn$;

-- ---------------------------------------------------------------------------
-- 2. The trigger that calls it
--
-- Was the only unpinned link in the sign-up chain. public is where profiles
-- and make_referral_code live; pg_catalog is explicit rather than implied.
-- ---------------------------------------------------------------------------
create or replace function public.set_referral_code()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  if new.referral_code is null then
    new.referral_code := public.make_referral_code(new.id);
  end if;
  return new;
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. The rest of the unpinned functions
--
-- None of these is on the sign-up path, but each is one schema-shadowing away
-- from the same failure, and touch_updated_at fires on nearly every table.
-- Redefined rather than ALTERed so the file is readable on its own.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

create or replace function public.ist_today()
returns date
language sql
stable
set search_path = pg_catalog
as $fn$
  select (now() at time zone 'Asia/Kolkata')::date;
$fn$;

create or replace function public.credit_source(p_reason text, p_delta numeric, p_actor uuid)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
  select case
    -- Spending is not a source. Kept as its own bucket so a caller can sum
    -- signed deltas without having to exclude it by name.
    when p_delta < 0 then 'spend'
    when p_reason = 'purchase' then 'paid'
    -- A plan an admin assigned versus one that followed a payment.
    when p_reason = 'plan_grant' and p_actor is not null then 'admin'
    when p_reason = 'plan_grant' then 'paid'
    when p_reason in ('admin_topup', 'admin_adjust') then 'admin'
    when p_reason in ('signup_bonus', 'coupon_bonus', 'referral', 'referral_milestone')
      then 'free'
    -- An unknown positive reason is called out rather than quietly counted as
    -- free, which would understate what has been given away.
    else 'other'
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Anyone who slipped through without a code
--
-- If a profile was ever created while the trigger was failing quietly, it has
-- no code and its owner cannot invite anybody. Backfilled here so the unique
-- constraint has a value on every row.
-- ---------------------------------------------------------------------------
update public.profiles
set referral_code = public.make_referral_code(id)
where referral_code is null;
