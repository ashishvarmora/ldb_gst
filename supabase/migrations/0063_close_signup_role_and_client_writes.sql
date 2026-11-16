-- 0063: two holes found by the 16 Nov 2026 security review.
--
-- 1. CRITICAL - anyone could make themselves super admin.
--    handle_new_user() copied `role` from raw_user_meta_data, and Supabase's
--    public /auth/v1/signup endpoint lets the caller set that metadata. So a
--    sign-up with {"data":{"role":"super_admin"}}, made with the public anon
--    key, created an admin. The app never relied on it: sign-up and the admin's
--    "new customer" form both create officers, and scripts/bootstrap-admin.mjs
--    sets the role on the profile row itself afterwards. Every new account is
--    now an officer, whatever the metadata says. Checked before the fix: the
--    only super_admin is the owner, and no auth user carries role metadata.
--
-- 2. HIGH - signed-in customers could write tables directly.
--    Supabase grants INSERT/UPDATE/DELETE on every public table to `anon` and
--    `authenticated`, and several owner policies are FOR ALL. With the public
--    key and their own session a customer could insert tracked_trucks past the
--    plan's limit or alerts at a 1-minute interval. Every write the app makes
--    goes through the service role, so these grants are taken away; reads stay
--    as they are (RLS still scopes them), so nothing in the app changes.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    -- Already normalised to +91XXXXXXXXXX before the user was created. nullif
    -- so an account made without one (the admin creating a customer by hand)
    -- stores null rather than an empty string.
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    -- Never from metadata (0063): the caller of the public sign-up endpoint
    -- chooses the metadata. Admins are made by setting profiles.role directly.
    'officer'
  )
  on conflict (id) do nothing;
  return new;
end $function$;

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;

-- And for tables created later, so a new migration cannot quietly reopen it.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
