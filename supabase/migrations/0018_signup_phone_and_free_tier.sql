-- ===========================================================================
-- The mobile number a new account gives actually reaches the profile.
--
-- Registration now insists on an Indian mobile - it is how an officer is
-- reached when their account is locked or a payment fails, and email alone has
-- already proved insufficient, because outbound mail can be misconfigured on a
-- deployment while everything else looks fine.
--
-- The number travels in raw_user_meta_data alongside full_name, and this
-- trigger is what copies that into public.profiles. It only ever read
-- full_name and role, so a phone posted by the sign-up form was accepted,
-- validated, stored on the auth user, and then silently dropped on the way to
-- the row every screen actually reads. Adding the column to the insert is the
-- whole fix.
--
-- Nothing is made NOT NULL. Accounts created before this have no number and
-- are perfectly valid; the requirement belongs at the point of registration,
-- not as a constraint that would make every older row unwritable. The format
-- is settled in src/lib/phone.ts, which stores exactly one shape: +91 then ten
-- digits.
--
-- No table changes are needed for the free signup tier - signup_free_credits
-- is one more row in the key/value app_settings table, and credits are granted
-- through grant_credits(), which already writes its own ledger entry.
--
-- Run after 0017_truck_failure_budget_and_bell_clearing.sql.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    -- Already normalised to +91XXXXXXXXXX before the user was created. nullif
    -- so an account made without one (the admin creating a customer by hand)
    -- stores null rather than an empty string, which every screen would then
    -- have to treat as a number.
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'officer')
  )
  on conflict (id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Support looks people up by the number they rang from, and the admin customer
-- list filters on it. Cheap index, and it keeps that search off a full scan.
create index if not exists profiles_phone_idx on public.profiles (phone)
  where phone is not null;
