-- ===========================================================================
-- Money in, credits out, and one place that decides both.
--
-- Four things land together, because they all rewrite officer_overview:
--
-- 1. PLANS SHRINK. A plan was carrying feature switches, a case-folder cap and
--    a retention window that nobody set per plan. What it actually decides is
--    two things: how many trucks may be under automatic checking, and how many
--    credits the account opens with. Everything else moves out.
--
-- 2. CREDIT PACKS. Money buys credits at rates the admin writes as rows -
--    "100 rupees = 200 credits" - so the pricing ladder, including the bonus
--    tiers at the top, is edited in the admin panel rather than in code.
--
-- 3. PAYMENTS. Razorpay orders are recorded before the officer is sent to
--    checkout and credited only when a verified webhook says the money
--    arrived, so a closed browser tab cannot lose a payment and a replayed
--    webhook cannot pay twice.
--
-- 4. USAGE COUNTERS GO. credit_transactions already records every chargeable
--    action with its timestamp, so a second daily tally of the same events was
--    duplicate storage that could disagree with the ledger. Today's counts are
--    derived from the ledger instead.
--
-- Run after 0008_credits_and_alert_rules.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Credit packs - the money-to-credits ladder
--
-- Deliberately explicit rows rather than a formula. The bonus tiers are not a
-- smooth curve ("100 -> 200" is 2x, "500 -> 1100" is 2.2x, "10000 -> 25000" is
-- 2.5x), and an admin editing a number is clearer than an admin editing a
-- percentage that then multiplies.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_packs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  price_inr  numeric(10, 2) not null check (price_inr > 0),
  credits    numeric(12, 2) not null check (credits > 0),
  is_active  boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_packs_active_idx on public.credit_packs (is_active, sort_order);

-- Something for the seed to conflict on, or the runner adds a fresh set of
-- packs every time it re-applies this file.
alter table public.credit_packs drop constraint if exists credit_packs_name_key;
alter table public.credit_packs add constraint credit_packs_name_key unique (name);

-- Only the two rungs that survive into the final ladder. Seeding names that a
-- later migration renames or drops means re-running this file resurrects them,
-- and they accumulate one copy per run. 0013 owns the ladder's real shape.
insert into public.credit_packs (name, price_inr, credits, sort_order) values
  ('Starter',  100, 200,  10),
  ('Standard', 500, 1100, 20)
on conflict (name) do nothing;

comment on table public.credit_packs is
  'What a rupee amount buys in credits. Edited by the admin; the officer only ever picks a row.';

-- ---------------------------------------------------------------------------
-- 2. Payments
--
-- status is the whole safety story:
--   created  order opened at Razorpay, nothing credited
--   paid     signature verified, credits granted exactly once
--   failed   Razorpay told us it failed
--
-- razorpay_order_id is unique, and credits are only ever granted on the
-- transition into 'paid', so a webhook delivered twice is a no-op.
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  pack_id             uuid references public.credit_packs (id) on delete set null,
  razorpay_order_id   text not null unique,
  razorpay_payment_id text,
  amount_inr          numeric(10, 2) not null,
  credits             numeric(12, 2) not null,
  status              text not null default 'created',
  failure_reason      text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index if not exists payments_user_time_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx    on public.payments (status, created_at desc);

-- ---------------------------------------------------------------------------
-- credit_payment - grant the credits for a verified payment, exactly once.
--
-- The guard is the row itself: the update only matches while the payment is
-- still 'created', so a duplicate webhook finds nothing to update and grants
-- nothing.
-- ---------------------------------------------------------------------------
create or replace function public.credit_payment(
  p_order_id   text,
  p_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user    uuid;
  v_credits numeric(12, 2);
  v_amount  numeric(10, 2);
begin
  update public.payments
  set status = 'paid',
      razorpay_payment_id = p_payment_id,
      paid_at = now()
  where razorpay_order_id = p_order_id
    and status = 'created'
  returning user_id, credits, amount_inr into v_user, v_credits, v_amount;

  if v_user is null then
    -- Either unknown, or already paid. Both are fine to see twice.
    return jsonb_build_object('ok', true, 'granted', false, 'reason', 'not_pending');
  end if;

  perform public.grant_credits(
    v_user, v_credits, 'purchase', null,
    format('Paid %s rupees, order %s', v_amount, p_order_id));

  return jsonb_build_object('ok', true, 'granted', true, 'credits', v_credits, 'user_id', v_user);
end $fn$;

revoke all on function public.credit_payment(text, text) from public;
grant execute on function public.credit_payment(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Officer activity, so the audit page can show what OFFICERS did
--
-- audit_logs only ever held admin actions. The interesting question is what an
-- officer looked up and when, so the same table now carries both and the role
-- says which is which.
-- ---------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists actor_role text;

update public.audit_logs a
set actor_role = coalesce(p.role::text, 'super_admin')
from public.profiles p
where p.id = a.actor_id and a.actor_role is null;

update public.audit_logs set actor_role = 'super_admin' where actor_role is null;

create index if not exists audit_logs_role_time_idx
  on public.audit_logs (actor_role, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Backup then purge, on the admin's schedule
--
-- The Google Sheet is the long-term copy. Retention was a per-plan and
-- per-officer number that nobody varied, so it becomes one platform setting
-- alongside how often the backup runs and where it is written.
--
-- "No sheet configured" now means "no backup wanted", not "refuse to purge" -
-- the old behaviour quietly kept every row for ever for anyone without a
-- sheet, which is the opposite of saving storage.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('backup_interval_days', '7'::jsonb),
  ('backup_sheet_id',      '""'::jsonb),
  ('last_backup_at',       'null'::jsonb)
on conflict (key) do nothing;

delete from public.app_settings where key = 'credit_price_inr';

-- Every officer used to connect their own sheet, which the worker wrote to on
-- every check. One sheet the admin owns, written on a schedule, is the same
-- record with none of the per-officer setup - and it is the only copy that has
-- to survive the purge, so it belongs to whoever runs the purge.
drop table if exists public.google_sheet_configs;

-- ---------------------------------------------------------------------------
-- 5. Drop what the rework retires
--
-- Views first: they select several of these columns.
-- ---------------------------------------------------------------------------
drop view if exists public.officer_overview;
drop view if exists public.officer_effective_limits;

-- usage_counters recorded the same events as credit_transactions, one day at a
-- time. Two records of one fact, and the tally could disagree with the money.
drop function if exists public.bump_alerts_sent(uuid, integer);
drop table if exists public.usage_counters;

-- A plan decides trucks and opening credits. Nothing else.
alter table public.plans
  drop column if exists max_truck_groups,
  drop column if exists telegram_enabled,
  drop column if exists google_sheet_enabled,
  drop column if exists alerts_enabled,
  drop column if exists data_retention_days;

alter table public.user_limit_overrides
  drop column if exists max_truck_groups,
  drop column if exists telegram_enabled,
  drop column if exists google_sheet_enabled,
  drop column if exists alerts_enabled,
  drop column if exists data_retention_days;

-- ---------------------------------------------------------------------------
-- 6. purge_officer_data, on the simpler rules
-- ---------------------------------------------------------------------------
create or replace function public.purge_officer_data(
  p_user  uuid,
  p_days  integer default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days     integer;
  v_cutoff   timestamptz;
  v_events   integer := 0;
  v_searches integer := 0;
  v_alerts   integer := 0;
begin
  select coalesce(p_days, (value #>> '{}')::int, 30) into v_days
  from public.app_settings where key = 'data_retention_days';

  v_days := coalesce(v_days, 30);

  if v_days = -1 then
    return jsonb_build_object('purged', false, 'reason', 'keep_forever', 'days', -1);
  end if;

  v_cutoff := now() - make_interval(days => v_days);

  with gone as (
    delete from public.truck_events
    where user_id = p_user and coalesce(event_time, fetched_at) < v_cutoff
    returning 1
  ) select count(*) into v_events from gone;

  with gone as (
    delete from public.search_logs
    where user_id = p_user and created_at < v_cutoff
    returning 1
  ) select count(*) into v_searches from gone;

  with gone as (
    delete from public.alert_logs
    where user_id = p_user and created_at < v_cutoff
    returning 1
  ) select count(*) into v_alerts from gone;

  return jsonb_build_object(
    'purged', true,
    'days', v_days,
    'cutoff', v_cutoff,
    'truck_events', v_events,
    'search_logs', v_searches,
    'alert_logs', v_alerts,
    'usage_counters', 0);
end $fn$;

revoke all on function public.purge_officer_data(uuid, integer, boolean) from public;
grant execute on function public.purge_officer_data(uuid, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The two views, on the final column set
--
-- Today's and this month's counts are derived from the ledger, so the numbers
-- an officer sees and the credits they were charged can never disagree.
-- ---------------------------------------------------------------------------
create view public.officer_effective_limits with (security_invoker = on) as
select
  p.id as user_id,
  coalesce(o.truck_limit, pl.truck_limit, 0) as truck_limit,
  (o.user_id is not null) as has_overrides
from public.profiles p
left join public.plans pl on pl.id = p.plan_id
left join public.user_limit_overrides o on o.user_id = p.id;

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
    ) as alerts_today,
    count(*) filter (where a.read_at is null) as alerts_unread
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

-- ---------------------------------------------------------------------------
-- 8. Who is tracking a given truck
--
-- The admin's question is "which officer is watching this number", which
-- otherwise means joining trucks to profiles on every search.
-- ---------------------------------------------------------------------------
drop view if exists public.truck_directory;
create view public.truck_directory with (security_invoker = on) as
select
  t.id as tracked_truck_id,
  t.truck_number,
  t.label,
  t.is_active,
  t.status,
  t.last_location,
  t.last_event_at,
  t.last_polled_at,
  t.created_at,
  p.id    as officer_id,
  p.full_name as officer_name,
  p.email as officer_email,
  p.phone as officer_phone,
  p.office,
  p.district,
  p.state,
  coalesce(al.alert_count, 0) as alert_count,
  coalesce(ev.event_count, 0) as event_count
from public.tracked_trucks t
join public.profiles p on p.id = t.user_id
left join lateral (
  select count(*) as alert_count from public.truck_alerts a
  where a.tracked_truck_id = t.id and a.is_enabled
) al on true
left join lateral (
  select count(*) as event_count from public.truck_events e
  where e.user_id = t.user_id and e.truck_number = t.truck_number
) ev on true;

-- ---------------------------------------------------------------------------
-- 9. RLS for the new tables
-- ---------------------------------------------------------------------------
alter table public.credit_packs enable row level security;
alter table public.payments     enable row level security;

drop policy if exists credit_packs_read  on public.credit_packs;
drop policy if exists credit_packs_write on public.credit_packs;
create policy credit_packs_read on public.credit_packs for select to authenticated using (true);
create policy credit_packs_write on public.credit_packs for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists payments_owner_read on public.payments;
create policy payments_owner_read on public.payments for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

do $blk$
begin
  execute 'drop trigger if exists touch_credit_packs on public.credit_packs';
  execute 'create trigger touch_credit_packs before update on public.credit_packs '
          'for each row execute function public.touch_updated_at()';
end $blk$;
