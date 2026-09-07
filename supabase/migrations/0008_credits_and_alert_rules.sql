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
-- that reads it, so two tabs cannot both spend the last credit.
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

  -- The ledger above is the only record of a chargeable action. A second
  -- daily tally would be the same fact stored twice, free to disagree with it.
  return jsonb_build_object('allowed', true, 'cost', v_cost, 'balance', v_balance);
end $fn$;

revoke all on function public.spend_credits(uuid, text, integer, text) from public;
grant execute on function public.spend_credits(uuid, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- grant_credits - the only way credits come in. Used by the admin panel and,
-- later, by the payment webhook.
--
-- THE DROP KEEPS THIS FILE RE-RUNNABLE, and it is not defensive noise. 0034
-- adds a sixth argument, and `create or replace` with a different argument list
-- OVERLOADS rather than replaces - so on every re-run this file recreated the
-- five-argument version beside 0034's six, and the five-argument call at the
-- foot of this file then bound to neither (42725, "is not unique"). That failed
-- the whole chain HERE, at 0008, so nothing after it applied - including the
-- files that would have fixed it.
--
-- Dropping first is safe in both directions because migrations run in filename
-- order: this file leaves exactly one five-argument function, and 0034 then
-- turns that into exactly one six-argument function. Never two.
-- ---------------------------------------------------------------------------
drop function if exists public.grant_credits(uuid, numeric, text, uuid, text, uuid);

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

-- The seed below is "on conflict do nothing", which needs something to
-- conflict ON. Without this the migration runner - which re-applies every file
-- on every run - would add a fresh copy of all three rules each time.
--
-- Any duplicates a previous run already created are folded into the oldest row
-- first, so the officers' alerts keep pointing at a template that still
-- exists.
do $blk$
begin
  update public.truck_alerts a
  set template_id = keep.id
  from public.alert_rule_templates dup
  join lateral (
    select t.id from public.alert_rule_templates t
    where t.name = dup.name order by t.created_at, t.id limit 1
  ) keep on true
  where a.template_id = dup.id and dup.id <> keep.id;

  delete from public.alert_rule_templates t
  where exists (
    select 1 from public.alert_rule_templates other
    where other.name = t.name and (other.created_at, other.id) < (t.created_at, t.id)
  );
end $blk$;

alter table public.alert_rule_templates
  drop constraint if exists alert_rule_templates_name_key;
alter table public.alert_rule_templates
  add constraint alert_rule_templates_name_key unique (name);

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
on conflict (name) do nothing;

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
-- nowhere.
--
-- THIS WAS MINTING CREDITS ON EVERY PUSH, and the comment above used to claim
-- it could not. The old guard was "this account has no plan_grant row", which
-- is once per ACCOUNT, not once ever - and every migration file re-runs on
-- every `npm run migrate`. So each account created after the original backfill
-- collected an opening balance the next time anybody ran the migrations.
--
-- It fired three times before anyone noticed: the legitimate backfill (three
-- accounts), then a new account picking up 500 credits four days later, then
-- three trial accounts taking 15 each. 545 credits given away that nobody
-- decided to give, and it would have happened again on the next push.
--
-- The guard is now on the BACKFILL, not on the account: if this has ever run,
-- it never runs again. Matched on its own note text, because plan_grant is
-- also written by settle_payment() for a real plan purchase and must not be
-- confused with it. Purely narrowing - it grants nothing new, and on any
-- database where the backfill has already happened it is now inert.
-- ---------------------------------------------------------------------------
do $blk$
declare r record;
begin
  if exists (
    select 1 from public.credit_transactions
    where reason = 'plan_grant'
      and note = 'Opening balance when credits replaced the old per-day and per-month quotas.'
  ) then
    return;
  end if;

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

-- --------------------------------------------------------------------------
-- officer_effective_limits / officer_overview are defined once, at the end
-- of 0009, on the final column set. Keeping a copy here too would mean two
-- definitions to change every time a limit moves.
-- --------------------------------------------------------------------------

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
