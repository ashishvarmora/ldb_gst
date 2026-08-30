-- ===========================================================================
-- Views, helper functions, Row Level Security and seed data.
-- Run after 0001_init.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function public.ist_today()
returns date language sql stable as $fn$
  select (now() at time zone 'Asia/Kolkata')::date;
$fn$;

-- SECURITY DEFINER so the policies below can call it without recursing into
-- the profiles policies they are defining.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and status = 'active'
  );
$fn$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- officer_effective_limits / officer_overview used to be built here and then
-- rebuilt by 0004 and 0007. Three copies of the same select had to be kept in
-- step every time a limit changed, and one of them was always the stale one.
-- They are now defined once, at the end of 0008, on the final column set.
--
-- consume_quota also lived here. Per-day and per-month allowances were
-- replaced by a single credit balance in 0008; spend_credits() took over.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- handle_new_user - safety net so a user created straight from the Supabase
-- dashboard still gets a profile row. The admin panel creates it explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'officer')
  )
  on conflict (id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ===========================================================================
-- Row Level Security
--   Officers  -> only their own rows.
--   Admin UI  -> uses the service-role key server-side, which bypasses RLS,
--                but every admin policy is still declared so the anon key can
--                never be used to read across officers.
-- ===========================================================================
do $blk$
declare t text;
begin
  foreach t in array array[
    'plans', 'profiles', 'user_limit_overrides', 'tracked_trucks', 'truck_events',
    'search_logs', 'alert_logs', 'telegram_configs',
    'truck_groups', 'truck_group_members',
    'audit_logs', 'app_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $blk$;

-- plans: everyone signed in can read the catalogue, only admin writes.
drop policy if exists plans_read  on public.plans;
drop policy if exists plans_write on public.plans;
create policy plans_read  on public.plans for select to authenticated using (true);
create policy plans_write on public.plans for all    to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- profiles: read own or all-if-admin. Writes go through the service role only,
-- so officers can never promote themselves or change their own plan.
drop policy if exists profiles_read  on public.profiles;
drop policy if exists profiles_write on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin());
create policy profiles_write on public.profiles for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- user_limit_overrides: officer may see their own, only admin may change.
drop policy if exists overrides_read  on public.user_limit_overrides;
drop policy if exists overrides_write on public.user_limit_overrides;
create policy overrides_read on public.user_limit_overrides for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());
create policy overrides_write on public.user_limit_overrides for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Officer-owned, officer-writable.
do $blk$
declare t text;
begin
  foreach t in array array['tracked_trucks', 'telegram_configs', 'truck_groups'] loop
    execute format('drop policy if exists %1$s_owner on public.%1$s', t);
    execute format(
      'create policy %1$s_owner on public.%1$s for all to authenticated
         using (user_id = auth.uid() or public.is_super_admin())
         with check (user_id = auth.uid() or public.is_super_admin())', t);
  end loop;
end $blk$;

-- Officer-owned, read-only for the officer (written by the tracking worker).
do $blk$
declare t text;
begin
  foreach t in array array['truck_events', 'search_logs', 'alert_logs'] loop
    execute format('drop policy if exists %1$s_owner_read on public.%1$s', t);
    execute format(
      'create policy %1$s_owner_read on public.%1$s for select to authenticated
         using (user_id = auth.uid() or public.is_super_admin())', t);
  end loop;
end $blk$;

-- Group members inherit the group owner.
drop policy if exists group_members_owner on public.truck_group_members;
create policy group_members_owner on public.truck_group_members for all to authenticated
  using (exists (select 1 from public.truck_groups g
                 where g.id = group_id and (g.user_id = auth.uid() or public.is_super_admin())))
  with check (exists (select 1 from public.truck_groups g
                 where g.id = group_id and (g.user_id = auth.uid() or public.is_super_admin())));

-- Admin-only tables.
drop policy if exists audit_admin    on public.audit_logs;
drop policy if exists settings_admin on public.app_settings;
create policy audit_admin    on public.audit_logs  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy settings_admin on public.app_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ===========================================================================
-- Seed: three starter plans + default global settings
-- ===========================================================================
-- A plan decides how many trucks may be watched and how many credits the
-- account opens with. Usage is paid for out of the balance, so there is
-- nothing else to cap. included_credits is added and filled in by 0008, which
-- is why it is absent here.
insert into public.plans (
  name, description, truck_limit, price_per_month, sort_order
) values
  ('Basic', 'Single-officer starter allocation.', 10, 0, 10),
  ('Professional', 'Full district workload.', 50, 0, 20),
  ('Unlimited', 'No caps. Use for headquarters or your own account.', -1, 0, 30)
on conflict (name) do nothing;

insert into public.app_settings (key, value) values
  ('ldb_api_url',            '"https://ldb.co.in/api/ldbv2/truck/search"'::jsonb),
  ('default_plan_name',      '"Basic"'::jsonb),
  ('global_polling_floor',   '5'::jsonb),
  ('tracking_enabled',       'true'::jsonb),
  ('no_activity_hours',      '6'::jsonb)
on conflict (key) do nothing;
