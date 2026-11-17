-- 0065: tell "opened the app" apart from "searched", and keep a day-by-day
-- record of visits, so the admin can see who is really using the product.
--
-- Until now profiles.last_active_at was the only activity stamp and it was
-- written by one thing - a manual search (touch_last_active from
-- runManualLookup) - while every admin screen labelled it "Last seen". A
-- customer who opened the app every morning to read their alerts but never
-- typed a number looked dead. Now:
--
--   last_seen_at / last_seen_via  any signed-in portal page, from the app or
--                                 the web; written at most once per 5 minutes
--   last_search_at                the last manual search
--   last_active_at                unchanged: the last thing the customer did
--   customer_visits               one row per customer per IST day they came

alter table public.profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_seen_via text,
  add column if not exists last_search_at timestamptz;

comment on column public.profiles.last_seen_at is 'Last time the customer opened any signed-in page (app or web). Throttled to once per 5 minutes (0065).';
comment on column public.profiles.last_seen_via is 'Where that was: app (the Android app) or web.';
comment on column public.profiles.last_search_at is 'Last manual search (0065). last_active_at keeps its old meaning.';

-- Backfill what can be known: the last manual search on record.
update public.profiles p set last_search_at = s.last_at
from (select user_id, max(created_at) last_at from public.search_logs where source = 'manual' group by user_id) s
where s.user_id = p.id and p.last_search_at is null;

create table if not exists public.customer_visits (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  day       date not null,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  hits      integer not null default 1,
  via       text,
  primary key (user_id, day)
);
comment on table public.customer_visits is 'One row per customer per IST day they opened a signed-in page; hits counts the throttled touches (0065). Service role only.';

alter table public.customer_visits enable row level security;
revoke all on public.customer_visits from public, anon, authenticated;
grant select, insert, update, delete on public.customer_visits to service_role;

create or replace function public.touch_seen(p_user uuid, p_via text default 'web')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_seen_at = now(), last_seen_via = left(p_via, 16)
   where id = p_user
     and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  if not found then
    return;
  end if;

  insert into public.customer_visits (user_id, day, via)
  values (p_user, public.ist_today(), left(p_via, 16))
  on conflict (user_id, day) do update
    set last_at = now(), hits = public.customer_visits.hits + 1, via = excluded.via;
end $$;

revoke all on function public.touch_seen(uuid, text) from public, anon, authenticated;
grant execute on function public.touch_seen(uuid, text) to service_role;

-- A manual search now also stamps last_search_at.
create or replace function public.touch_last_active(p_user uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.profiles set last_active_at = now(), last_search_at = now() where id = p_user;
$$;

-- The overview view gains the three columns at the end (appending keeps
-- every existing column and dependent in place).
create or replace view public.officer_overview with (security_invoker = on) as
SELECT p.id,
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
    p.credits,
    pl.name AS plan_name,
    pl.description AS plan_description,
    pl.price_per_month,
    pl.included_credits,
    el.truck_limit,
    el.has_overrides,
    p.plan_id IS NOT NULL AND (p.plan_expires_on IS NULL OR p.plan_expires_on >= ist_today()) AND p.status = 'active'::account_status AS plan_active,
    COALESCE(tt.active_trucks, 0::bigint) AS active_trucks,
    COALESCE(tt.total_trucks, 0::bigint) AS total_trucks,
    COALESCE(cs.manual_searches_today, 0::bigint) AS manual_searches_today,
    COALESCE(cs.tracking_queries_today, 0::bigint) AS tracking_queries_today,
    COALESCE(cs.manual_searches_month, 0::bigint) AS manual_searches_month,
    COALESCE(cs.tracking_queries_month, 0::bigint) AS tracking_queries_month,
    COALESCE(cs.credits_spent_today, 0::numeric) AS credits_spent_today,
    COALESCE(cs.credits_spent_month, 0::numeric) AS credits_spent_month,
    COALESCE(cs.credits_purchased, 0::numeric) AS credits_purchased,
    COALESCE(ad.alerts_today, 0::bigint) AS alerts_today,
    COALESCE(ad.alerts_unread, 0::bigint) AS alerts_unread,
    COALESCE(al.active_alerts, 0::bigint) AS active_alerts,
    COALESCE(ev.total_events, 0::bigint) AS total_events,
    COALESCE(tg.chat_id IS NOT NULL AND tg.is_enabled, false) AS telegram_connected,
    ev.last_event_at,
    COALESCE(pl.is_trial, false) AS plan_is_trial,
    pl.price_inr,
    p.last_seen_at,
    p.last_seen_via,
    p.last_search_at
   FROM profiles p
     LEFT JOIN plans pl ON pl.id = p.plan_id
     LEFT JOIN officer_effective_limits el ON el.user_id = p.id
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE t.is_active) AS active_trucks,
            count(*) AS total_trucks
           FROM tracked_trucks t
          WHERE t.user_id = p.id) tt ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE c.reason = 'manual_search'::text AND (c.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date = ist_today()) AS manual_searches_today,
            count(*) FILTER (WHERE c.reason = 'auto_check'::text AND (c.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date = ist_today()) AS tracking_queries_today,
            count(*) FILTER (WHERE c.reason = 'manual_search'::text AND (c.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date >= date_trunc('month'::text, ist_today()::timestamp with time zone)::date) AS manual_searches_month,
            count(*) FILTER (WHERE c.reason = 'auto_check'::text AND (c.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date >= date_trunc('month'::text, ist_today()::timestamp with time zone)::date) AS tracking_queries_month,
            sum(- c.delta) FILTER (WHERE c.delta < 0::numeric AND (c.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date = ist_today()) AS credits_spent_today,
            sum(- c.delta) FILTER (WHERE c.delta < 0::numeric AND (c.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date >= date_trunc('month'::text, ist_today()::timestamp with time zone)::date) AS credits_spent_month,
            sum(c.delta) FILTER (WHERE c.reason = 'purchase'::text) AS credits_purchased
           FROM credit_transactions c
          WHERE c.user_id = p.id) cs ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (a.created_at AT TIME ZONE 'Asia/Kolkata'::text)::date = ist_today() AND a.cleared_at IS NULL) AS alerts_today,
            count(*) FILTER (WHERE a.read_at IS NULL AND a.cleared_at IS NULL) AS alerts_unread
           FROM alert_logs a
          WHERE a.user_id = p.id) ad ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS active_alerts
           FROM truck_alerts a
          WHERE a.user_id = p.id AND a.is_enabled) al ON true
     LEFT JOIN telegram_configs tg ON tg.user_id = p.id
     LEFT JOIN LATERAL ( SELECT max(e.event_time) AS last_event_at,
            count(*) AS total_events
           FROM truck_events e
          WHERE e.user_id = p.id) ev ON true;
