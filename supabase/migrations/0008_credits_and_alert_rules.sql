-- ===========================================================================
-- One credit pool, and alert rules the admin writes.
--
-- Two separate reworks that have to land together, because both rewrite the
-- same views.
--
-- 1. CREDITS. There were two quotas - manual searches per day and tracking
--    queries per month - and an officer had to reason about both. Now there is
--    one balance. Every action that costs anything debits it, and the admin
--    decides the rate: "1 credit = 1 manual search", "1 credit = 2 automatic
--    checks". Rates live in a table, so adding a chargeable action later is a
--    row, not a migration.
--
-- 2. ALERT RULES. The two hard-coded alerts move into a catalogue the admin
--    maintains, and an officer attaches as many as they like to a truck, each
--    with its own interval. Three kinds ship now:
--
--      periodic_location  every N minutes, report where the truck is.
--      location_change    every N minutes, report only if the plaza changed.
--      plaza_crossing     every N minutes, report only if the truck reached
--                         one named toll plaza.
--
--    A truck has no polling interval of its own any more. It is checked when
--    one of its alerts is due, which is the only reason to check it at all.
--
-- Run after 0007_two_truck_alerts.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Credit rates - what each chargeable action costs
--
-- Stored as "how many of this action one credit buys", which is how the rate
-- is spoken about ("1 credit = 2 auto fetches"). Cost per action is the
-- reciprocal, computed where it is spent so the stored number stays the one
-- the admin typed.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_rates (
  action            text primary key,
  label             text not null,
  description       text,
  units_per_credit  numeric(10, 2) not null default 1 check (units_per_credit > 0),
  updated_at        timestamptz not null default now()
);

insert into public.credit_rates (action, label, description, units_per_credit) values
  ('manual_search', 'Manual search',
   'An officer typing a registration number into the search box, or re-checking a truck by hand.', 1),
  ('auto_check', 'Automatic check',
   'One background check of a tracked truck. Runs only when one of that truck''s alerts is due.', 2)
on conflict (action) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The balance, and the ledger behind it
--
-- profiles.credits is the running balance so the dashboard is one read. Every
-- movement is also written to credit_transactions, so "where did my credits
-- go" is answerable and a wrong balance can be reconstructed.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists credits numeric(12, 2) not null default 0;

comment on column public.profiles.credits is
  'Single credit balance. Debited by spend_credits(), topped up by grant_credits(). Never written directly.';

create table if not exists public.credit_transactions (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- Negative for usage, positive for a top-up.
  delta         numeric(12, 2) not null,
  balance_after numeric(12, 2) not null,
  -- manual_search | auto_check | admin_topup | admin_adjust | purchase | plan_grant
  reason        text not null,
  truck_number  text,
  note          text,
  actor_id      uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists credit_tx_user_time_idx
  on public.credit_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. spend_credits - atomic "may this officer afford one more call?"
--
-- Replaces consume_quota. The balance is decremented inside the same statement
-- that reads it, so two tabs cannot both spend the last credit. usage_counters
-- is still maintained, but only as a daily tally for the dashboard - it no
-- longer gates anything.
-- ---------------------------------------------------------------------------
create or replace function public.spend_credits(
  p_user   uuid,
  p_action text,
  p_count  integer default 1,
  p_truck  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status  public.account_status;
  v_rate    numeric(10, 2);
  v_cost    numeric(12, 2);
  v_balance numeric(12, 2);
  v_today   date := public.ist_today();
begin
  select status into v_status from public.profiles where id = p_user;

  if v_status is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_such_user');
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'account_suspended');
  end if;

  select units_per_credit into v_rate from public.credit_rates where action = p_action;
  if v_rate is null then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_action');
  end if;

  -- Round up: a part-used credit is a used credit, and rounding down would let
  -- a cheap action be free for ever.
  v_cost := ceil((p_count::numeric / v_rate) * 100) / 100;

  -- Lock the row so the read and the write cannot be interleaved.
  select credits into v_balance from public.profiles where id = p_user for update;

  if v_balance < v_cost then
    return jsonb_build_object(
      'allowed', false, 'reason', 'out_of_credits',
      'balance', v_balance, 'cost', v_cost);
  end if;

  update public.profiles set credits = credits - v_cost where id = p_user
  returning credits into v_balance;

  insert into public.credit_transactions (user_id, delta, balance_after, reason, truck_number)
  values (p_user, -v_cost, v_balance, p_action, p_truck);

  insert into public.usage_counters (user_id, usage_date, manual_searches, tracking_queries)
  values (
    p_user, v_today,
    case when p_action = 'manual_search' then p_count else 0 end,
    case when p_action = 'auto_check'    then p_count else 0 end
  )
  on conflict (user_id, usage_date) do update set
    manual_searches  = usage_counters.manual_searches
                       + case when p_action = 'manual_search' then p_count else 0 end,
    tracking_queries = usage_counters.tracking_queries
                       + case when p_action = 'auto_check'    then p_count else 0 end;

  return jsonb_build_object('allowed', true, 'cost', v_cost, 'balance', v_balance);
end $fn$;

revoke all on function public.spend_credits(uuid, text, integer, text) from public;
grant execute on function public.spend_credits(uuid, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- grant_credits - the only way credits come in. Used by the admin panel and,
-- later, by the payment webhook.
-- ---------------------------------------------------------------------------
create or replace function public.grant_credits(
  p_user   uuid,
  p_amount numeric,
  p_reason text default 'admin_topup',
  p_actor  uuid default null,
  p_note   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_balance numeric(12, 2);
begin
  if p_amount = 0 then
    return jsonb_build_object('ok', false, 'reason', 'zero_amount');
  end if;

  update public.profiles set credits = greatest(credits + p_amount, 0)
  where id = p_user
  returning credits into v_balance;

  if v_balance is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_user');
  end if;

  insert into public.credit_transactions
    (user_id, delta, balance_after, reason, note, actor_id)
  values (p_user, p_amount, v_balance, p_reason, p_note, p_actor);

  return jsonb_build_object('ok', true, 'balance', v_balance);
end $fn$;

revoke all on function public.grant_credits(uuid, numeric, text, uuid, text) from public;
grant execute on function public.grant_credits(uuid, numeric, text, uuid, text) to service_role;

-- consume_quota counted per-day and per-month allowances that no longer exist.
drop function if exists public.consume_quota(uuid, public.query_source, integer);

-- ---------------------------------------------------------------------------
-- 4. Toll plaza catalogue
--
-- The "alert me when the truck reaches this plaza" rule needs a list to choose
-- from. The worker records every plaza it stores, so the list is whatever the
-- platform has actually seen rather than a hand-kept file that goes stale.
-- ---------------------------------------------------------------------------
create table if not exists public.toll_plazas (
  name          text primary key,
  seen_count    integer not null default 1,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

insert into public.toll_plazas (name, seen_count, last_seen_at)
select loc_name, count(*)::int, max(coalesce(event_time, fetched_at))
from public.truck_events
where loc_name is not null and btrim(loc_name) <> ''
group by loc_name
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Alert rule catalogue, written by the admin
--
-- kind is what the worker switches on; the admin controls the wording, whether
-- it is offered at all, and how fast it may repeat.
-- ---------------------------------------------------------------------------
create table if not exists public.alert_rule_templates (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  -- periodic_location | location_change | plaza_crossing
  kind                     text not null,
  description              text,
  is_active                boolean not null default true,
  min_interval_minutes     integer not null default 15 check (min_interval_minutes >= 1),
  default_interval_minutes integer not null default 60 check (default_interval_minutes >= 1),
  sort_order               integer not null default 100,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists alert_rule_templates_active_idx
  on public.alert_rule_templates (is_active, sort_order);

insert into public.alert_rule_templates
  (name, kind, description, min_interval_minutes, default_interval_minutes, sort_order)
values
  ('Location update', 'periodic_location',
   'Sends the truck''s current toll plaza on a fixed beat, whether or not it has moved.',
   5, 60, 10),
  ('Location changed', 'location_change',
   'Checks on a fixed beat and messages only when the toll plaza differs from the one last reported.',
   5, 30, 20),
  ('Reached a toll plaza', 'plaza_crossing',
   'Watches one named toll plaza and messages the moment the truck is recorded there.',
   5, 30, 30)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. The officer's alerts, one row per truck per rule
--
-- Several rows may point at the same template, so an officer can watch two
-- different plazas on one truck.
-- ---------------------------------------------------------------------------
create table if not exists public.truck_alerts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  tracked_truck_id uuid not null references public.tracked_trucks (id) on delete cascade,
  template_id      uuid not null references public.alert_rule_templates (id) on delete cascade,
  is_enabled       boolean not null default true,
  interval_minutes integer not null default 30 check (interval_minutes between 1 and 10080),
  -- plaza_crossing only.
  plaza            text,
  -- Bookkeeping, written by the worker.
  last_run_at      timestamptz,
  last_location    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists truck_alerts_truck_idx on public.truck_alerts (tracked_truck_id);
create index if not exists truck_alerts_user_idx  on public.truck_alerts (user_id);
create index if not exists truck_alerts_due_idx
  on public.truck_alerts (is_enabled, last_run_at) where is_enabled;

-- Carry across whatever the 0007 per-truck columns had switched on, so nobody
-- silently loses an alert they had configured.
insert into public.truck_alerts
  (user_id, tracked_truck_id, template_id, is_enabled, interval_minutes, last_location, last_run_at)
select t.user_id, t.id, tpl.id, true, t.location_alert_minutes, null, t.location_alert_last_at
from public.tracked_trucks t
join public.alert_rule_templates tpl on tpl.kind = 'periodic_location'
where t.location_alert_enabled
  and not exists (
    select 1 from public.truck_alerts a
    where a.tracked_truck_id = t.id and a.template_id = tpl.id
  );

insert into public.truck_alerts
  (user_id, tracked_truck_id, template_id, is_enabled, interval_minutes, last_location, last_run_at)
select t.user_id, t.id, tpl.id, true, t.movement_alert_minutes,
       t.movement_alert_last_location, t.movement_alert_last_at
from public.tracked_trucks t
join public.alert_rule_templates tpl on tpl.kind = 'location_change'
where t.movement_alert_enabled
  and not exists (
    select 1 from public.truck_alerts a
    where a.tracked_truck_id = t.id and a.template_id = tpl.id
  );

-- ---------------------------------------------------------------------------
-- 7. Unread alerts, for the bell
-- ---------------------------------------------------------------------------
alter table public.alert_logs
  add column if not exists read_at timestamptz;

create index if not exists alert_logs_unread_idx
  on public.alert_logs (user_id, created_at desc) where read_at is null;

-- ---------------------------------------------------------------------------
-- 8. Drop what the rework retires
--
-- The views go first: they select several of these columns.
-- ---------------------------------------------------------------------------
drop view if exists public.officer_overview;
drop view if exists public.officer_effective_limits;

-- Per-truck alert settings, superseded by truck_alerts.
alter table public.tracked_trucks
  drop column if exists location_alert_enabled,
  drop column if exists location_alert_minutes,
  drop column if exists location_alert_last_at,
  drop column if exists movement_alert_enabled,
  drop column if exists movement_alert_minutes,
  drop column if exists movement_alert_last_at,
  drop column if exists movement_alert_last_location;

-- A truck is checked because an alert is due, never on a schedule of its own.
drop index if exists public.tracked_trucks_user_watchlist_idx;
alter table public.tracked_trucks
  drop column if exists polling_interval_minutes,
  drop column if exists is_watchlist;

-- Per-day and per-month allowances are replaced by the credit balance, and the
-- generic interval floors by the per-rule minimum on alert_rule_templates.
alter table public.plans
  drop column if exists manual_search_limit_per_day,
  drop column if exists tracking_queries_per_month,
  drop column if exists min_polling_interval_minutes,
  drop column if exists min_alert_interval_minutes;

alter table public.user_limit_overrides
  drop column if exists manual_search_limit_per_day,
  drop column if exists tracking_queries_per_month,
  drop column if exists min_polling_interval_minutes,
  drop column if exists min_alert_interval_minutes;

-- What a plan hands over when it is assigned.
alter table public.plans
  add column if not exists included_credits numeric(12, 2) not null default 0;

comment on column public.plans.included_credits is
  'Credits granted when this plan is assigned. Officers buy more on top; the plan is the starting allocation, not a cap.';

update public.plans set included_credits = case name
  when 'Basic'        then 500
  when 'Professional' then 2500
  when 'Unlimited'    then 10000
  else included_credits
end
where included_credits = 0;

-- ---------------------------------------------------------------------------
-- 8b. Open every existing account with its plan's allocation
--
-- credits defaults to 0, so without this every officer would wake up on the
-- new scheme unable to run a single check - the platform would go quiet on the
-- day it shipped rather than when anyone actually ran out. Written through the
-- ledger so the opening balance is explained rather than appearing from
-- nowhere, and guarded so re-running the migration cannot grant it twice.
-- ---------------------------------------------------------------------------
do $blk$
declare r record;
begin
  for r in
    select p.id, coalesce(pl.included_credits, 500) as amount
    from public.profiles p
    left join public.plans pl on pl.id = p.plan_id
    where not exists (
      select 1 from public.credit_transactions c
      where c.user_id = p.id and c.reason = 'plan_grant'
    )
  loop
    perform public.grant_credits(r.id, r.amount, 'plan_grant', null,
      'Opening balance when credits replaced the old per-day and per-month quotas.');
  end loop;
end $blk$;

-- ---------------------------------------------------------------------------
-- 9. Every officer gets the default plan without an admin doing it by hand
-- ---------------------------------------------------------------------------
create or replace function public.assign_default_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_plan   uuid;
  v_name   text;
  v_credits numeric(12, 2);
begin
  if new.plan_id is not null then return new; end if;

  select (value #>> '{}') into v_name from public.app_settings where key = 'default_plan_name';

  select id, included_credits into v_plan, v_credits
  from public.plans
  where is_active and (v_name is null or name = v_name)
  order by (name = coalesce(v_name, '')) desc, sort_order
  limit 1;

  if v_plan is null then return new; end if;

  new.plan_id := v_plan;
  new.plan_assigned_at := now();
  if coalesce(new.credits, 0) = 0 and coalesce(v_credits, 0) > 0 then
    new.credits := v_credits;
  end if;
  return new;
end $fn$;

drop trigger if exists assign_default_plan_trg on public.profiles;
create trigger assign_default_plan_trg
  before insert on public.profiles
  for each row execute function public.assign_default_plan();

-- ---------------------------------------------------------------------------
-- 10. The two views, on the final column set
--
-- Defined only here now. 0002 and 0004 used to rebuild them on every run,
-- which meant three copies to keep in step every time a limit changed.
-- ---------------------------------------------------------------------------
create view public.officer_effective_limits with (security_invoker = on) as
select
  p.id as user_id,
  coalesce(o.truck_limit,         pl.truck_limit,         0) as truck_limit,
  coalesce(o.max_truck_groups,    pl.max_truck_groups,    0) as max_truck_groups,
  coalesce(o.data_retention_days, pl.data_retention_days, 30) as data_retention_days,
  coalesce(o.telegram_enabled,    pl.telegram_enabled,    false) as telegram_enabled,
  coalesce(o.google_sheet_enabled, pl.google_sheet_enabled, false) as google_sheet_enabled,
  coalesce(o.alerts_enabled,      pl.alerts_enabled,      false) as alerts_enabled,
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
  el.max_truck_groups,
  el.data_retention_days,
  el.telegram_enabled,
  el.google_sheet_enabled,
  el.alerts_enabled,
  el.has_overrides,
  coalesce(tt.active_trucks, 0)     as active_trucks,
  coalesce(tt.total_trucks, 0)      as total_trucks,
  coalesce(ud.manual_searches, 0)   as manual_searches_today,
  coalesce(ud.tracking_queries, 0)  as tracking_queries_today,
  coalesce(um.manual_searches, 0)   as manual_searches_month,
  coalesce(um.tracking_queries, 0)  as tracking_queries_month,
  coalesce(cs.credits_spent_today, 0) as credits_spent_today,
  coalesce(cs.credits_spent_month, 0) as credits_spent_month,
  coalesce(ad.alerts_today, 0)      as alerts_today,
  coalesce(ad.alerts_unread, 0)     as alerts_unread,
  coalesce(al.active_alerts, 0)     as active_alerts,
  coalesce(ev.total_events, 0)      as total_events,
  coalesce(tg.chat_id is not null and tg.is_enabled, false)        as telegram_connected,
  coalesce(gs.spreadsheet_id is not null and gs.is_enabled, false) as sheet_connected,
  gs.last_synced_at as sheet_last_synced_at,
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
  select
    sum(-c.delta) filter (
      where c.delta < 0
        and (c.created_at at time zone 'Asia/Kolkata')::date = public.ist_today()
    ) as credits_spent_today,
    sum(-c.delta) filter (
      where c.delta < 0
        and (c.created_at at time zone 'Asia/Kolkata')::date
            >= date_trunc('month', public.ist_today())::date
    ) as credits_spent_month
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
left join public.google_sheet_configs gs on gs.user_id = p.id
left join lateral (
  select max(e.event_time) as last_event_at, count(*) as total_events
  from public.truck_events e where e.user_id = p.id
) ev on true;

-- ---------------------------------------------------------------------------
-- 11. RLS for the new tables
-- ---------------------------------------------------------------------------
do $blk$
declare t text;
begin
  foreach t in array array[
    'credit_rates', 'credit_transactions', 'toll_plazas',
    'alert_rule_templates', 'truck_alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $blk$;

-- The catalogue tables are readable by everyone signed in, writable by admin.
do $blk$
declare t text;
begin
  foreach t in array array['credit_rates', 'alert_rule_templates', 'toll_plazas'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format(
      'create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all to authenticated
         using (public.is_super_admin()) with check (public.is_super_admin())', t);
  end loop;
end $blk$;

-- The officer owns their alerts; the ledger is theirs to read, never to write.
drop policy if exists truck_alerts_owner on public.truck_alerts;
create policy truck_alerts_owner on public.truck_alerts for all to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists credit_tx_owner_read on public.credit_transactions;
create policy credit_tx_owner_read on public.credit_transactions for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- updated_at triggers for the new tables that have the column.
do $blk$
declare t text;
begin
  foreach t in array array['alert_rule_templates', 'truck_alerts'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s '
      'for each row execute function public.touch_updated_at()', t);
  end loop;
end $blk$;

-- ---------------------------------------------------------------------------
-- 12. Payment gateway settings
--
-- The secret key stays in the environment; only the public key id and the
-- on/off switch are stored here, so the admin page has something to show.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('razorpay_enabled', 'false'::jsonb),
  ('razorpay_key_id',  '""'::jsonb),
  ('credit_price_inr', '10'::jsonb)
on conflict (key) do nothing;

comment on table public.credit_rates is
  'What each chargeable action costs, expressed as how many of it one credit buys. Editable from the admin panel.';
comment on table public.truck_alerts is
  'An officer''s alert on one truck. Several rows may share a template, so two plazas can be watched on the same truck.';
