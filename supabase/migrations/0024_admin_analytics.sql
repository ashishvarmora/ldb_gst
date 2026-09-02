-- ===========================================================================
-- The admin console as an analysis tool rather than a scoreboard.
--
-- Three things were wrong, and all three are database problems:
--
-- 1. REVENUE WAS ALWAYS ZERO. settle_payment() writes status = 'paid'. Two
--    screens summed `status = 'captured'`, a value this schema has never
--    stored. Every rupee figure in the console read Rs 0 and had done since
--    the day payments were added. The screens are fixed alongside this file;
--    a check constraint is added here so a third spelling cannot be invented.
--
-- 2. MONEY THAT DID NOT COME THROUGH RAZORPAY HAD NOWHERE TO GO. Cash, a bank
--    transfer, a UPI payment made directly - all real, none recordable. One
--    screen inferred "recorded by hand" from a missing razorpay_payment_id,
--    which is a guess, not a record. There is a method column now, and an RPC
--    that logs an offline payment through exactly the same settlement path as
--    a gateway one, so the credits, the plan and any referral reward all
--    happen the same way.
--
-- 3. EVERY AGGREGATE WAS COMPUTED IN TYPESCRIPT. Each screen pulled a month of
--    rows over PostgREST and reduced them in JavaScript, which caps at the
--    project's max-rows, cannot group by anything the caller did not think of,
--    and gives two screens two chances to disagree about one number. The
--    grouping moves into the database, behind functions that take a date range
--    and a bucket, so "per day", "per week", "per user", "per source" are one
--    argument rather than one more page of reduce().
--
-- The functions are SECURITY INVOKER and EXECUTE is granted to service_role
-- only. The admin console reads them with the service key from a Server
-- Component; nothing signed in as a customer can call them at all.
--
-- Run after 0023_referral_code_without_pgcrypto.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. What a payment is worth, and where it came from
--
-- method is the dimension the owner actually asked for: how much arrived by
-- Razorpay, how much in cash, how much by bank transfer. Backfilled from the
-- one signal that existed before - a payment with a Razorpay payment id came
-- through the gateway, anything else was entered by hand.
--
-- recorded_by names the administrator who entered an offline payment. Null for
-- a gateway payment, because nobody entered it.
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists method text not null default 'razorpay',
  add column if not exists recorded_by uuid references public.profiles (id) on delete set null,
  add column if not exists note text;

update public.payments
set method = case when razorpay_payment_id is null then 'manual' else 'razorpay' end
where method is null
   or method not in ('razorpay', 'cash', 'bank_transfer', 'upi', 'cheque', 'manual', 'other');

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method in ('razorpay', 'cash', 'bank_transfer', 'upi', 'cheque', 'manual', 'other'));

-- The status spelling that caused the zeroes. 'captured' was never one of
-- these; with the constraint in place, a query for it now fails loudly at
-- write time instead of quietly matching nothing at read time.
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('created', 'paid', 'failed'));

-- Every analytical query below slices payments by settled date and by method,
-- and the console's busiest list is one account's payments newest first.
create index if not exists payments_paid_at_idx
  on public.payments (paid_at desc) where status = 'paid';
create index if not exists payments_user_created_idx
  on public.payments (user_id, created_at desc);
create index if not exists credit_transactions_created_idx
  on public.credit_transactions (created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Recording money that did not come through the gateway
--
-- Everything a gateway payment does, an offline one must do too: mark the row
-- paid, hand over the credits or assign the plan, extend the expiry, settle any
-- coupon, and let it count as somebody's first payment for a referral. Rather
-- than reimplement that, this inserts the payment row and then calls
-- settle_payment(), which is the single place all of it lives.
--
-- The synthetic order id is what makes that possible: settle_payment() finds a
-- payment by order id, and payments.razorpay_order_id is unique, so an offline
-- receipt gets an id of its own that cannot collide with a real Razorpay one.
-- ---------------------------------------------------------------------------
create or replace function public.record_offline_payment(
  p_user     uuid,
  p_amount   numeric,
  p_method   text,
  p_kind     text default 'credits',
  p_credits  numeric default 0,
  p_plan     uuid default null,
  p_months   integer default 1,
  p_actor    uuid default null,
  p_note     text default null,
  p_paid_at  timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_order  text;
  v_result jsonb;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'amount_must_be_positive');
  end if;
  if p_method not in ('cash', 'bank_transfer', 'upi', 'cheque', 'manual', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'bad_method');
  end if;
  if p_kind not in ('credits', 'plan') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if p_kind = 'plan' and p_plan is null then
    return jsonb_build_object('ok', false, 'reason', 'plan_required');
  end if;
  if p_kind = 'credits' and coalesce(p_credits, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'credits_required');
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_user');
  end if;

  -- "off_" so it is obvious in a log that this never went near Razorpay, and
  -- a uuid so two administrators recording at the same second cannot clash.
  v_order := 'off_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.payments
    (user_id, razorpay_order_id, amount_inr, credits, status, kind,
     plan_id, months, method, recorded_by, note)
  values
    (p_user, v_order, p_amount, coalesce(p_credits, 0), 'created', p_kind,
     p_plan, greatest(coalesce(p_months, 1), 1), p_method, p_actor, p_note);

  -- Null payment id: there is no gateway reference, and inventing one would
  -- make a hand-entered receipt indistinguishable from a real capture.
  v_result := public.settle_payment(v_order, null);

  -- paid_at is overwritten only when the administrator says the money actually
  -- arrived on an earlier date, so a receipt entered a week late lands in the
  -- week it belongs to rather than the week it was typed.
  if p_paid_at is not null then
    update public.payments set paid_at = p_paid_at where razorpay_order_id = v_order;
  end if;

  return v_result || jsonb_build_object('order_id', v_order, 'method', p_method);
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. Where every account stands
--
-- One row per customer, with the lifecycle stage spelled out. The stages are
-- the questions the owner asked, in order: who is paying, who signed up and
-- never bought, whose plan has run out, who has gone quiet.
--
-- Stage is a single case expression evaluated top to bottom, so an account is
-- in exactly one stage and the counts always add up to the account total -
-- which is what stops a funnel from double-counting somebody.
-- ---------------------------------------------------------------------------
drop view if exists public.account_lifecycle;
create view public.account_lifecycle with (security_invoker = on) as
with money as (
  select user_id,
         sum(amount_inr)                    as paid_inr,
         sum(coalesce(discount_inr, 0))     as discount_inr,
         count(*)                           as payments,
         min(coalesce(paid_at, created_at)) as first_paid_at,
         max(coalesce(paid_at, created_at)) as last_paid_at
  from public.payments
  where status = 'paid'
  group by user_id
),
spend as (
  select user_id,
         sum(-delta) filter (where delta < 0)     as credits_spent,
         sum(delta)  filter (where delta > 0)     as credits_issued,
         max(created_at) filter (where delta < 0) as last_spend_at
  from public.credit_transactions
  group by user_id
)
select
  p.id,
  p.email,
  p.full_name,
  p.phone,
  p.district,
  p.office,
  p.status,
  p.created_at,
  (p.created_at at time zone 'Asia/Kolkata')::date as signed_up_on,
  p.last_active_at,
  p.plan_id,
  pl.name                                          as plan_name,
  p.plan_expires_on,
  p.credits,
  p.referred_by,
  coalesce(m.paid_inr, 0)                          as paid_inr,
  coalesce(m.discount_inr, 0)                      as discount_inr,
  coalesce(m.payments, 0)                          as payments,
  m.first_paid_at,
  m.last_paid_at,
  coalesce(s.credits_issued, 0)                    as credits_issued,
  coalesce(s.credits_spent, 0)                     as credits_spent,
  s.last_spend_at,
  case
    when p.status <> 'active'                                  then 'suspended'
    when coalesce(m.payments, 0) = 0 and p.plan_id is null     then 'never_bought'
    when p.plan_id is null                                     then 'credits_only'
    when p.plan_expires_on is not null
     and p.plan_expires_on < public.ist_today()                then 'expired'
    when p.last_active_at is null                              then 'never_signed_in'
    when p.last_active_at < now() - interval '30 days'         then 'dormant'
    else 'active'
  end                                              as stage
from public.profiles p
left join public.plans pl on pl.id = p.plan_id
left join money m on m.user_id = p.id
left join spend s on s.user_id = p.id
where p.role = 'officer';

-- ---------------------------------------------------------------------------
-- 4. The analytical readers
--
-- Each takes an inclusive IST date range and, where a series makes sense, a
-- bucket of 'day', 'week' or 'month'. The range is in IST dates rather than
-- timestamps because that is the only boundary an Indian business day has, and
-- because a screen that offers a date picker should not have to reason about
-- where UTC midnight falls.
--
-- A helper keeps that conversion in exactly one place: an IST date range
-- becomes the half-open UTC interval [from 00:00 IST, to+1 day 00:00 IST).
-- ---------------------------------------------------------------------------
create or replace function public.ist_range(p_from date, p_to date)
returns tstzrange
language sql
immutable
set search_path = pg_catalog
as $fn$
  select tstzrange(
    (p_from::timestamp at time zone 'Asia/Kolkata'),
    ((p_to + 1)::timestamp at time zone 'Asia/Kolkata'),
    '[)');
$fn$;

-- The bucket a timestamp falls in, as an IST date. 'week' starts on Monday,
-- which is what date_trunc does and what an Indian working week looks like.
create or replace function public.ist_bucket(p_at timestamptz, p_bucket text)
returns date
language sql
immutable
set search_path = pg_catalog
as $fn$
  select (date_trunc(
    case when p_bucket in ('day', 'week', 'month') then p_bucket else 'day' end,
    p_at at time zone 'Asia/Kolkata'))::date;
$fn$;

-- Money in, bucketed. One row per bucket per method per kind, so a caller can
-- chart the total, split it by how it arrived, or split it by what was bought,
-- without three round trips.
--
-- Joined to profiles on role = 'officer', which every reader here does. The
-- console has always had two populations in one set of tables: customers, and
-- the administrators testing against their own accounts. account_lifecycle and
-- officer_overview both filter to customers; the credit and revenue totals did
-- not, so "credits held by accounts" and "issued minus spent" were computed
-- over different populations and disagreed by exactly one admin's plan grant.
-- Every function in this file now counts the same people.
create or replace function public.admin_revenue_series(
  p_from date, p_to date, p_bucket text default 'day')
returns table (
  bucket date, method text, kind text,
  gross_inr numeric, discount_inr numeric, payments bigint,
  credits_sold numeric, accounts bigint)
language sql
stable
set search_path = public, pg_catalog
as $fn$
  select public.ist_bucket(coalesce(p.paid_at, p.created_at), p_bucket) as bucket,
         p.method,
         p.kind,
         sum(p.amount_inr)::numeric,
         sum(coalesce(p.discount_inr, 0))::numeric,
         count(*)::bigint,
         sum(coalesce(p.credits, 0))::numeric,
         count(distinct p.user_id)::bigint
  from public.payments p
  join public.profiles pr on pr.id = p.user_id and pr.role = 'officer'
  where p.status = 'paid'
    and coalesce(p.paid_at, p.created_at) <@ public.ist_range(p_from, p_to)
  group by 1, 2, 3
  order by 1, 2, 3;
$fn$;

-- Credits in and out, bucketed and split by the source the database already
-- classifies. This is the answer to "how many credits did I give away as a
-- bonus, and how does that compare with what was bought".
-- Dropped rather than replaced: p_user was added after the fact, and a
-- create-or-replace with an extra defaulted argument leaves the old three-
-- argument version in place as an overload, which makes every existing call
-- ambiguous rather than upgraded.
drop function if exists public.admin_credit_series(date, date, text);

create or replace function public.admin_credit_series(
  p_from date, p_to date, p_bucket text default 'day', p_user uuid default null)
returns table (
  bucket date, source text, reason text,
  credits numeric, entries bigint, accounts bigint)
language sql
stable
set search_path = public, pg_catalog
as $fn$
  select public.ist_bucket(t.created_at, p_bucket) as bucket,
         public.credit_source(t.reason, t.delta, t.actor_id) as source,
         t.reason,
         sum(t.delta)::numeric,
         count(*)::bigint,
         count(distinct t.user_id)::bigint
  from public.credit_transactions t
  join public.profiles pr on pr.id = t.user_id and pr.role = 'officer'
  where t.created_at <@ public.ist_range(p_from, p_to)
    -- One account, or all of them. The same function serves the platform
    -- chart and an account's own, so the two cannot count differently.
    and (p_user is null or t.user_id = p_user)
  group by 1, 2, 3
  order by 1, 2, 3;
$fn$;

-- New accounts, bucketed, split by whether the person was invited by someone.
create or replace function public.admin_signup_series(
  p_from date, p_to date, p_bucket text default 'day')
returns table (bucket date, signups bigint, referred bigint, converted bigint)
language sql
stable
set search_path = public, pg_catalog
as $fn$
  select public.ist_bucket(p.created_at, p_bucket) as bucket,
         count(*)::bigint,
         count(*) filter (where p.referred_by is not null)::bigint,
         -- Converted means this account has since paid for something, not that
         -- it paid on the day it registered - a signup that buys a month later
         -- is still a conversion of that day's cohort.
         count(*) filter (where exists (
           select 1 from public.payments pay
           where pay.user_id = p.id and pay.status = 'paid'))::bigint
  from public.profiles p
  where p.role = 'officer'
    and p.created_at <@ public.ist_range(p_from, p_to)
  group by 1
  order by 1;
$fn$;

-- Every account with what it did inside the window, for the league tables and
-- the per-user grouping. Ordering and slicing are left to the caller so one
-- function serves "top spenders", "top payers" and "who went quiet".
create or replace function public.admin_account_activity(p_from date, p_to date)
returns table (
  id uuid, email text, full_name text, district text,
  stage text, status text, plan_name text, credits numeric,
  signed_up_on date, last_active_at timestamptz,
  paid_inr numeric, payments bigint,
  credits_bought numeric, credits_free numeric, credits_admin numeric,
  credits_spent numeric, searches bigint, auto_checks bigint)
language sql
stable
set search_path = public, pg_catalog
as $fn$
  with window_money as (
    select user_id, sum(amount_inr)::numeric as paid_inr, count(*)::bigint as payments
    from public.payments
    where status = 'paid'
      and coalesce(paid_at, created_at) <@ public.ist_range(p_from, p_to)
    group by user_id
    -- No role join needed: this is joined to account_lifecycle below, which is
    -- already officers only, so an administrator's own row cannot survive it.
  ),
  window_credits as (
    select t.user_id,
           sum(t.delta) filter (
             where public.credit_source(t.reason, t.delta, t.actor_id) = 'paid')::numeric  as bought,
           sum(t.delta) filter (
             where public.credit_source(t.reason, t.delta, t.actor_id) = 'free')::numeric  as free,
           sum(t.delta) filter (
             where public.credit_source(t.reason, t.delta, t.actor_id) = 'admin')::numeric as by_admin,
           sum(-t.delta) filter (where t.delta < 0)::numeric                               as spent,
           count(*) filter (where t.reason = 'manual_search')::bigint                      as searches,
           count(*) filter (where t.reason = 'auto_check')::bigint                         as auto_checks
    from public.credit_transactions t
    where t.created_at <@ public.ist_range(p_from, p_to)
    group by t.user_id
  )
  select a.id, a.email, a.full_name, a.district,
         a.stage, a.status::text, a.plan_name, a.credits,
         a.signed_up_on, a.last_active_at,
         coalesce(m.paid_inr, 0), coalesce(m.payments, 0),
         coalesce(c.bought, 0), coalesce(c.free, 0), coalesce(c.by_admin, 0),
         coalesce(c.spent, 0), coalesce(c.searches, 0), coalesce(c.auto_checks, 0)
  from public.account_lifecycle a
  left join window_money m on m.user_id = a.id
  left join window_credits c on c.user_id = a.id;
$fn$;

-- The funnel, as counts. Returned as one object of named keys rather than a
-- stage/count list because a screen wants to name each number anyway, and a
-- missing stage would otherwise silently vanish instead of showing zero.
create or replace function public.admin_user_funnel()
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $fn$
  select jsonb_build_object(
    'total',           count(*),
    'active',          count(*) filter (where stage = 'active'),
    'never_bought',    count(*) filter (where stage = 'never_bought'),
    'credits_only',    count(*) filter (where stage = 'credits_only'),
    'expired',         count(*) filter (where stage = 'expired'),
    'dormant',         count(*) filter (where stage = 'dormant'),
    'never_signed_in', count(*) filter (where stage = 'never_signed_in'),
    'suspended',       count(*) filter (where stage = 'suspended'),
    'paying',          count(*) filter (where payments > 0),
    'on_plan',         count(*) filter (where plan_id is not null),
    'lifetime_inr',    coalesce(sum(paid_inr), 0),
    'credits_held',    coalesce(sum(credits), 0)
  )
  from public.account_lifecycle;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Who may read any of this
--
-- These functions answer questions about every account on the platform. They
-- run as the caller, and EXECUTE is taken away from everyone but service_role,
-- so the only thing that can reach them is the admin console's server-side
-- client. A signed-in customer calling them through PostgREST is refused
-- before a row is read.
--
-- record_offline_payment is SECURITY DEFINER because it has to write, but it
-- is locked to service_role for the same reason: it grants credits, and a
-- customer who could call it could grant themselves any number of them.
-- ---------------------------------------------------------------------------
do $blk$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_revenue_series(date, date, text)',
    'public.admin_credit_series(date, date, text, uuid)',
    'public.admin_signup_series(date, date, text)',
    'public.admin_account_activity(date, date)',
    'public.admin_user_funnel()',
    'public.record_offline_payment(uuid, numeric, text, text, numeric, uuid, integer, uuid, text, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $blk$;

-- account_lifecycle carries every customer's contact details and lifetime
-- value. security_invoker means it is read with the caller's own permissions,
-- and the grants make that caller service_role or nobody.
revoke all on public.account_lifecycle from anon, authenticated;
grant select on public.account_lifecycle to service_role;
