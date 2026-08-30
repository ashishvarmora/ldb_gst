-- ===========================================================================
-- Helpers the tracking worker and the officer dashboard need.
-- Run after 0002_views_rls_seed.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- bump_alerts_sent - cosmetic counter on usage_counters, incremented after the
-- worker actually creates alert rows. Kept as an RPC so the increment is atomic
-- rather than read-modify-write from the app.
-- ---------------------------------------------------------------------------
create or replace function public.bump_alerts_sent(p_user uuid, p_count integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.usage_counters (user_id, usage_date, alerts_sent)
  values (p_user, public.ist_today(), p_count)
  on conflict (user_id, usage_date) do update
    set alerts_sent = usage_counters.alerts_sent + p_count;
end $fn$;

revoke all on function public.bump_alerts_sent(uuid, integer) from public;
grant execute on function public.bump_alerts_sent(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- touch_last_active - "when did this officer last actually use the platform".
-- Called on sign-in and on every manual search.
-- ---------------------------------------------------------------------------
create or replace function public.touch_last_active(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.profiles set last_active_at = now() where id = p_user;
$fn$;

revoke all on function public.touch_last_active(uuid) from public;
grant execute on function public.touch_last_active(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Indexes the officer dashboard leans on.
--   - truck_events by (user_id, truck_number, event_time) for the timeline
--   - tracked_trucks by (user_id, is_watchlist) for the watchlist filter
-- ---------------------------------------------------------------------------
create index if not exists truck_events_user_truck_time_idx
  on public.truck_events (user_id, truck_number, event_time desc);

create index if not exists tracked_trucks_user_watchlist_idx
  on public.tracked_trucks (user_id, is_watchlist);

create index if not exists alert_logs_truck_time_idx
  on public.alert_logs (user_id, truck_number, created_at desc);

-- ---------------------------------------------------------------------------
-- A truck may appear in several case folders, so members are looked up by
-- number as often as by group.
-- ---------------------------------------------------------------------------
create index if not exists truck_group_members_number_idx
  on public.truck_group_members (truck_number);
