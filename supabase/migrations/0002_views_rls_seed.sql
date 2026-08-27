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
-- officer_effective_limits
--   override (if not null) -> plan -> hard fallback
-- ---------------------------------------------------------------------------
drop view if exists public.officer_overview;
drop view if exists public.officer_effective_limits;

create view public.officer_effective_limits with (security_invoker = on) as
select
  p.id as user_id,
  coalesce(o.truck_limit,                  pl.truck_limit,                  0) as truck_limit,
  coalesce(o.manual_search_limit_per_day,  pl.manual_search_limit_per_day,  0) as manual_search_limit_per_day,
  coalesce(o.tracking_queries_per_month,   pl.tracking_queries_per_month,   0) as tracking_queries_per_month,
  coalesce(o.max_alert_rules,              pl.max_alert_rules,              0) as max_alert_rules,
  coalesce(o.max_truck_groups,             pl.max_truck_groups,             0) as max_truck_groups,
  coalesce(o.min_polling_interval_minutes, pl.min_polling_interval_minutes, 60) as min_polling_interval_minutes,
  coalesce(o.telegram_enabled,             pl.telegram_enabled,             false) as telegram_enabled,
  coalesce(o.google_sheet_enabled,          pl.google_sheet_enabled,        false) as google_sheet_enabled,
  coalesce(o.alert_rules_enabled,           pl.alert_rules_enabled,         false) as alert_rules_enabled,
  (o.user_id is not null) as has_overrides
from public.profiles p
left join public.plans pl on pl.id = p.plan_id
left join public.user_limit_overrides o on o.user_id = p.id;

-- ---------------------------------------------------------------------------
-- officer_overview - one row per officer, everything the admin list needs.
-- ---------------------------------------------------------------------------
create view public.officer_overview with (security_invoker = on) as
select
  p.id,
  p.email,
  p.full_name,
  p.phone,
  p.designation,
  p.office,
  p.district,
  p.state,
  p.role,
  p.status,
  p.plan_id,
  p.plan_assigned_at,
  p.plan_expires_on,
  p.notes,
  p.last_active_at,
  p.created_at,
  pl.name  as plan_name,
  pl.price_per_month,
  el.truck_limit,
  el.manual_search_limit_per_day,
  el.tracking_queries_per_month,
  el.max_alert_rules,
  el.max_truck_groups,
  el.min_polling_interval_minutes,
  el.telegram_enabled,
  el.google_sheet_enabled,
  el.alert_rules_enabled,
  el.has_overrides,
  coalesce(tt.active_trucks, 0)     as active_trucks,
  coalesce(tt.total_trucks, 0)      as total_trucks,
  coalesce(ud.manual_searches, 0)   as manual_searches_today,
  coalesce(ud.tracking_queries, 0)  as tracking_queries_today,
  coalesce(um.manual_searches, 0)   as manual_searches_month,
  coalesce(um.tracking_queries, 0)  as tracking_queries_month,
  coalesce(ad.alerts_today, 0)      as alerts_today,
  coalesce(tg.chat_id is not null and tg.is_enabled, false)        as telegram_connected,
  coalesce(gs.spreadsheet_id is not null and gs.is_enabled, false) as sheet_connected,
  ev.last_event_at
from public.profiles p
left join public.plans pl on pl.id = p.plan_id
left join public.officer_effective_limits el on el.user_id = p.id
left join lateral (
  select count(*) filter (where t.is_active) as active_trucks,
         count(*)                            as total_trucks
  from public.tracked_trucks t where t.user_id = p.id
) tt on true
left join lateral (
  select u.manual_searches, u.tracking_queries
  from public.usage_counters u
  where u.user_id = p.id and u.usage_date = public.ist_today()
) ud on true
left join lateral (
  select sum(u.manual_searches)::int as manual_searches,
         sum(u.tracking_queries)::int as tracking_queries
  from public.usage_counters u
  where u.user_id = p.id
    and u.usage_date >= date_trunc('month', public.ist_today())::date
) um on true
left join lateral (
  select count(*) as alerts_today
  from public.alert_logs a
  where a.user_id = p.id
    and (a.created_at at time zone 'Asia/Kolkata')::date = public.ist_today()
) ad on true
left join public.telegram_configs tg on tg.user_id = p.id
left join public.google_sheet_configs gs on gs.user_id = p.id
left join lateral (
  select max(e.event_time) as last_event_at
  from public.truck_events e where e.user_id = p.id
) ev on true;

-- ---------------------------------------------------------------------------
-- consume_quota - atomic "may this officer make one more call?"
--   p_source 'manual'   -> checked against the per-DAY limit
--   p_source 'tracking' -> checked against the per-MONTH limit
-- Returns { allowed, limit, used, remaining, reason }
-- ---------------------------------------------------------------------------
create or replace function public.consume_quota(
  p_user   uuid,
  p_source public.query_source,
  p_amount integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status   public.account_status;
  v_expires  date;
  v_limit    integer;
  v_used     integer;
  v_today    date := public.ist_today();
begin
  select status, plan_expires_on into v_status, v_expires
  from public.profiles where id = p_user;

  if v_status is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_such_user');
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'account_suspended');
  end if;
  if v_expires is not null and v_expires < v_today then
    return jsonb_build_object('allowed', false, 'reason', 'plan_expired');
  end if;

  if p_source = 'manual' then
    select manual_search_limit_per_day into v_limit
    from public.officer_effective_limits where user_id = p_user;

    select coalesce(manual_searches, 0) into v_used
    from public.usage_counters where user_id = p_user and usage_date = v_today;
  else
    select tracking_queries_per_month into v_limit
    from public.officer_effective_limits where user_id = p_user;

    select coalesce(sum(tracking_queries), 0)::int into v_used
    from public.usage_counters
    where user_id = p_user and usage_date >= date_trunc('month', v_today)::date;
  end if;

  v_used := coalesce(v_used, 0);

  if v_limit <> -1 and v_used + p_amount > v_limit then
    return jsonb_build_object(
      'allowed', false, 'reason', 'quota_exhausted',
      'limit', v_limit, 'used', v_used, 'remaining', greatest(v_limit - v_used, 0));
  end if;

  insert into public.usage_counters (user_id, usage_date, manual_searches, tracking_queries)
  values (
    p_user, v_today,
    case when p_source = 'manual'   then p_amount else 0 end,
    case when p_source = 'tracking' then p_amount else 0 end
  )
  on conflict (user_id, usage_date) do update set
    manual_searches  = usage_counters.manual_searches
                       + case when p_source = 'manual'   then p_amount else 0 end,
    tracking_queries = usage_counters.tracking_queries
                       + case when p_source = 'tracking' then p_amount else 0 end;

  return jsonb_build_object(
    'allowed', true, 'limit', v_limit, 'used', v_used + p_amount,
    'remaining', case when v_limit = -1 then -1 else greatest(v_limit - v_used - p_amount, 0) end);
end $fn$;

revoke all on function public.consume_quota(uuid, public.query_source, integer) from public;
grant execute on function public.consume_quota(uuid, public.query_source, integer) to service_role;

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
    'search_logs', 'alert_rules', 'alert_logs', 'telegram_configs',
    'google_sheet_configs', 'truck_groups', 'truck_group_members',
    'usage_counters', 'audit_logs', 'app_settings'
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
  foreach t in array array['tracked_trucks', 'alert_rules', 'telegram_configs',
                           'google_sheet_configs', 'truck_groups'] loop
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
  foreach t in array array['truck_events', 'search_logs', 'alert_logs', 'usage_counters'] loop
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
insert into public.plans (
  name, description, truck_limit, manual_search_limit_per_day,
  tracking_queries_per_month, max_alert_rules, max_truck_groups,
  min_polling_interval_minutes, telegram_enabled, google_sheet_enabled,
  alert_rules_enabled, price_per_month, sort_order
) values
  ('Basic', 'Single-officer starter allocation.',
   10, 20, 2000, 5, 3, 30, true, true, true, 0, 10),
  ('Professional', 'Full district workload.',
   50, 100, 10000, 25, 15, 10, true, true, true, 0, 20),
  ('Unlimited', 'No caps. Use for headquarters or your own account.',
   -1, -1, -1, -1, -1, 5, true, true, true, 0, 30)
on conflict (name) do nothing;

insert into public.app_settings (key, value) values
  ('ldb_api_url',            '"https://ldb.co.in/api/ldbv2/truck/search"'::jsonb),
  ('default_plan_name',      '"Basic"'::jsonb),
  ('global_polling_floor',   '5'::jsonb),
  ('tracking_enabled',       'true'::jsonb),
  ('no_activity_hours',      '6'::jsonb),
  ('excessive_tolls',        '5'::jsonb),
  ('excessive_window_hours', '2'::jsonb),
  ('night_window',           '{"from": "22:00", "to": "06:00"}'::jsonb)
on conflict (key) do nothing;
