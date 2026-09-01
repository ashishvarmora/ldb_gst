-- ===========================================================================
-- A truck that keeps failing should say so, then stop - not delete itself.
--
-- Three things land together.
--
-- 1. A FAILURE BUDGET PER TRUCK. The worker gave up after 20 consecutive
--    errors, hard-coded, the same 20 whether the truck is checked every five
--    minutes or once a day. Twenty failures is two hours for one and nearly
--    three weeks for the other. The budget moves onto the truck, and when the
--    officer has not set one it is worked out from that truck's own check
--    interval - see resolveFailureBudget() in src/lib/tracking.ts.
--
-- 2. PAUSING IS THE END OF THE ROAD, NOT DELETING. Nothing here removes a
--    truck automatically. A truck that exhausts its budget is switched to
--    paused and the reason is recorded, so the officer opens it, sees why, and
--    decides. Their recorded crossings are never touched by any of this.
--
-- 3. CLEARING THE BELL KEEPS THE ROWS. "Clear all" sets cleared_at rather than
--    deleting, so the bell empties while the admin's alert log and the
--    account's own history stay whole. A cleared row counts towards neither
--    the unread badge nor today's total, which is why the view is rebuilt at
--    the bottom of this file.
--
-- Run after 0016_retention_rules_and_sheets.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The failure budget, and why a truck stopped
-- ---------------------------------------------------------------------------
alter table public.tracked_trucks
  add column if not exists max_consecutive_failures integer;

do $blk$
begin
  alter table public.tracked_trucks
    add constraint tracked_trucks_max_failures_range
    check (max_consecutive_failures is null or max_consecutive_failures between 1 and 1000);
exception when duplicate_object then null;
end $blk$;

comment on column public.tracked_trucks.max_consecutive_failures is
  'How many checks in a row may fail before this truck is paused. NULL means work it out from the truck''s own check interval - roughly a day of failing.';

alter table public.tracked_trucks
  add column if not exists paused_reason text;

do $blk$
begin
  alter table public.tracked_trucks
    add constraint tracked_trucks_paused_reason_known
    check (paused_reason is null
           or paused_reason in ('manual', 'repeated_failures', 'account_suspended'));
exception when duplicate_object then null;
end $blk$;

comment on column public.tracked_trucks.paused_reason is
  'Why is_active went false. NULL for a truck that is running, or paused before this column existed.';

alter table public.tracked_trucks
  add column if not exists paused_at timestamptz;

-- The warning at five failures is a nudge, not a siren: without a mark saying
-- it has been sent, every later sweep would send it again while the truck goes
-- on failing towards its budget.
alter table public.tracked_trucks
  add column if not exists failure_warned_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Clearing the bell without losing the alert
-- ---------------------------------------------------------------------------
alter table public.alert_logs
  add column if not exists cleared_at timestamptz;

comment on column public.alert_logs.cleared_at is
  'Set when the officer cleared the bell. The row stays for the admin log and for their own records; it is only hidden from the panel.';

-- The bell asks for exactly this: one account's uncleared alerts, newest
-- first. Partial, because a cleared row is never read back by that query.
create index if not exists alert_logs_user_uncleared_idx
  on public.alert_logs (user_id, created_at desc)
  where cleared_at is null;

-- ---------------------------------------------------------------------------
-- 3. The overview, rebuilt so a cleared alert stops counting
--
-- Identical to 0009 apart from the two filters in the alert_logs lateral. It
-- is dropped and recreated rather than replaced because a view that other
-- views select from cannot always be replaced in place.
-- ---------------------------------------------------------------------------
drop view if exists public.officer_overview;

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
  p.credits,
  pl.name  as plan_name,
  pl.description as plan_description,
  pl.price_per_month,
  pl.included_credits,
  el.truck_limit,
  el.has_overrides,
  -- An account may buy credits only while a plan is live. Computed here so
  -- every screen and every action asks the same question.
  (p.plan_id is not null
     and (p.plan_expires_on is null or p.plan_expires_on >= public.ist_today())
     and p.status = 'active') as plan_active,
  coalesce(tt.active_trucks, 0)  as active_trucks,
  coalesce(tt.total_trucks, 0)   as total_trucks,
  coalesce(cs.manual_searches_today, 0)  as manual_searches_today,
  coalesce(cs.tracking_queries_today, 0) as tracking_queries_today,
  coalesce(cs.manual_searches_month, 0)  as manual_searches_month,
  coalesce(cs.tracking_queries_month, 0) as tracking_queries_month,
  coalesce(cs.credits_spent_today, 0)    as credits_spent_today,
  coalesce(cs.credits_spent_month, 0)    as credits_spent_month,
  coalesce(cs.credits_purchased, 0)      as credits_purchased,
  coalesce(ad.alerts_today, 0)   as alerts_today,
  coalesce(ad.alerts_unread, 0)  as alerts_unread,
  coalesce(al.active_alerts, 0)  as active_alerts,
  coalesce(ev.total_events, 0)   as total_events,
  coalesce(tg.chat_id is not null and tg.is_enabled, false) as telegram_connected,
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
  select
    count(*) filter (
      where c.reason = 'manual_search'
        and (c.created_at at time zone 'Asia/Kolkata')::date = public.ist_today()
    ) as manual_searches_today,
    count(*) filter (
      where c.reason = 'auto_check'
        and (c.created_at at time zone 'Asia/Kolkata')::date = public.ist_today()
    ) as tracking_queries_today,
    count(*) filter (
      where c.reason = 'manual_search'
        and (c.created_at at time zone 'Asia/Kolkata')::date
            >= date_trunc('month', public.ist_today())::date
    ) as manual_searches_month,
    count(*) filter (
      where c.reason = 'auto_check'
        and (c.created_at at time zone 'Asia/Kolkata')::date
            >= date_trunc('month', public.ist_today())::date
    ) as tracking_queries_month,
    sum(-c.delta) filter (
      where c.delta < 0
        and (c.created_at at time zone 'Asia/Kolkata')::date = public.ist_today()
    ) as credits_spent_today,
    sum(-c.delta) filter (
      where c.delta < 0
        and (c.created_at at time zone 'Asia/Kolkata')::date
            >= date_trunc('month', public.ist_today())::date
    ) as credits_spent_month,
    sum(c.delta) filter (where c.reason = 'purchase') as credits_purchased
  from public.credit_transactions c
  where c.user_id = p.id
) cs on true
left join lateral (
  select
    count(*) filter (
      where (a.created_at at time zone 'Asia/Kolkata')::date = public.ist_today()
        and a.cleared_at is null
    ) as alerts_today,
    count(*) filter (where a.read_at is null and a.cleared_at is null) as alerts_unread
  from public.alert_logs a
  where a.user_id = p.id
) ad on true
left join lateral (
  select count(*) as active_alerts
  from public.truck_alerts a
  where a.user_id = p.id and a.is_enabled
) al on true
left join public.telegram_configs tg on tg.user_id = p.id
left join lateral (
  select max(e.event_time) as last_event_at, count(*) as total_events
  from public.truck_events e where e.user_id = p.id
) ev on true;
