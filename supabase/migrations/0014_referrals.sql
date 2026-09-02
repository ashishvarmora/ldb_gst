-- ===========================================================================
-- Refer someone, and earn when they actually pay.
--
-- The rule that makes this worth anything: a referral counts on the referred
-- person's FIRST PAYMENT, not on their sign-up. Sign-ups are free to
-- manufacture; a payment is not. So a referral sits at 'pending' - visible to
-- both sides, earning nothing - until money arrives.
--
-- Two rewards, both set by the admin:
--
--   percent      a share of that first payment, as credits to the referrer.
--   milestone    an extra lump once N referrals have paid.
--
-- Everything is granted through grant_credits, so a referral reward appears in
-- the same ledger as everything else and a balance can still be explained line
-- by line.
--
-- Run after 0013_credit_ladder_percent.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Who referred whom
--
-- referral_code is on the profile because it is the thing people share, and it
-- has to survive a name change. Generated from the id rather than randomly, so
-- it cannot collide and needs no retry loop.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.profiles (id) on delete set null;

create or replace function public.make_referral_code(p_id uuid)
returns text
language sql
immutable
as $fn$
  -- Eight characters from the id's own digest: stable, collision-free in any
  -- realistic account count, and nothing about the person is recoverable.
  select upper(substr(encode(digest(p_id::text, 'sha256'), 'hex'), 1, 8));
$fn$;

do $blk$
begin
  -- pgcrypto supplies digest(). It is already present on Supabase, but a bare
  -- create keeps this file runnable on a plain Postgres too.
  create extension if not exists pgcrypto;
exception when insufficient_privilege then null;
end $blk$;

update public.profiles
set referral_code = public.make_referral_code(id)
where referral_code is null;

alter table public.profiles
  drop constraint if exists profiles_referral_code_key;
alter table public.profiles
  add constraint profiles_referral_code_key unique (referral_code);

create or replace function public.set_referral_code()
returns trigger
language plpgsql
as $fn$
begin
  if new.referral_code is null then
    new.referral_code := public.make_referral_code(new.id);
  end if;
  return new;
end $fn$;

drop trigger if exists set_referral_code_trg on public.profiles;
create trigger set_referral_code_trg
  before insert on public.profiles
  for each row execute function public.set_referral_code();

-- ---------------------------------------------------------------------------
-- 2. The referral itself
--
-- referred_id is unique: a person can be referred once, by one person, ever.
-- Without that, two referrers could both claim the same first payment.
-- ---------------------------------------------------------------------------
create table if not exists public.referrals (
  id             uuid primary key default gen_random_uuid(),
  referrer_id    uuid not null references public.profiles (id) on delete cascade,
  referred_id    uuid not null unique references public.profiles (id) on delete cascade,
  -- pending  -> signed up, has not paid, earns nothing yet
  -- rewarded -> first payment arrived and the referrer was credited
  status         text not null default 'pending',
  reward_credits numeric(12, 2) not null default 0,
  first_amount   numeric(10, 2),
  rewarded_at    timestamptz,
  created_at     timestamptz not null default now(),
  -- Nobody refers themselves.
  constraint referrals_not_self check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id, status);

-- Backfill anyone already carrying a referred_by.
insert into public.referrals (referrer_id, referred_id)
select p.referred_by, p.id
from public.profiles p
where p.referred_by is not null
  and p.referred_by <> p.id
on conflict (referred_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. What a referral is worth
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('referral_enabled',          'true'::jsonb),
  ('referral_percent',          '10'::jsonb),
  ('referral_milestone_count',  '5'::jsonb),
  ('referral_milestone_bonus',  '500'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. reward_referral - called when a payment settles
--
-- Idempotent twice over: the update only matches a referral still 'pending',
-- and the milestone is only paid when the ledger has no milestone row for that
-- referrer yet. A webhook delivered twice therefore pays nothing twice.
-- ---------------------------------------------------------------------------
create or replace function public.reward_referral(
  p_user   uuid,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_referrer  uuid;
  v_percent   numeric;
  v_reward    numeric(12, 2);
  v_need      integer;
  v_bonus     numeric;
  v_qualified integer;
  v_paid      boolean;
begin
  if coalesce((select (value #>> '{}')::boolean from public.app_settings
               where key = 'referral_enabled'), true) is not true then
    return jsonb_build_object('ok', true, 'rewarded', false, 'reason', 'disabled');
  end if;

  -- Only the FIRST payment counts, which is what the pending status means.
  select referrer_id into v_referrer
  from public.referrals
  where referred_id = p_user and status = 'pending'
  for update;

  if v_referrer is null then
    return jsonb_build_object('ok', true, 'rewarded', false, 'reason', 'no_pending_referral');
  end if;

  select coalesce((value #>> '{}')::numeric, 0) into v_percent
  from public.app_settings where key = 'referral_percent';

  v_reward := floor(coalesce(p_amount, 0) * coalesce(v_percent, 0) / 100);

  update public.referrals
  set status = 'rewarded',
      reward_credits = v_reward,
      first_amount = p_amount,
      rewarded_at = now()
  where referred_id = p_user and status = 'pending';

  if v_reward > 0 then
    perform public.grant_credits(
      v_referrer, v_reward, 'referral', null,
      format('Referral reward, %s%% of a %s rupee payment', v_percent, p_amount));
  end if;

  -- Milestone: paid once, the moment the count is reached.
  select coalesce((value #>> '{}')::int, 0) into v_need
  from public.app_settings where key = 'referral_milestone_count';
  select coalesce((value #>> '{}')::numeric, 0) into v_bonus
  from public.app_settings where key = 'referral_milestone_bonus';

  if v_need > 0 and v_bonus > 0 then
    select count(*) into v_qualified
    from public.referrals where referrer_id = v_referrer and status = 'rewarded';

    select exists (
      select 1 from public.credit_transactions
      where user_id = v_referrer and reason = 'referral_milestone'
    ) into v_paid;

    if v_qualified >= v_need and not v_paid then
      perform public.grant_credits(
        v_referrer, v_bonus, 'referral_milestone', null,
        format('Bonus for %s referrals who paid', v_qualified));
      return jsonb_build_object(
        'ok', true, 'rewarded', true, 'credits', v_reward,
        'milestone', v_bonus, 'referrer', v_referrer);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'rewarded', true, 'credits', v_reward, 'referrer', v_referrer);
end $fn$;

revoke all on function public.reward_referral(uuid, numeric) from public;
grant execute on function public.reward_referral(uuid, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Hook it into settle_payment
--
-- The referral is rewarded from inside the settle, so there is exactly one
-- path from "money arrived" to "everyone who should be credited was".
-- ---------------------------------------------------------------------------
create or replace function public.settle_payment(
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
  v_kind    text;
  v_plan    uuid;
  v_months  integer;
  v_plan_credits numeric(12, 2);
  v_from    date;
  v_referral jsonb;
begin
  update public.payments
  set status = 'paid',
      razorpay_payment_id = p_payment_id,
      paid_at = now()
  where razorpay_order_id = p_order_id
    and status = 'created'
  returning user_id, credits, amount_inr, kind, plan_id, months
  into v_user, v_credits, v_amount, v_kind, v_plan, v_months;

  if v_user is null then
    return jsonb_build_object('ok', true, 'granted', false, 'reason', 'not_pending');
  end if;

  if v_kind = 'plan' and v_plan is not null then
    select included_credits into v_plan_credits from public.plans where id = v_plan;

    select greatest(coalesce(plan_expires_on, public.ist_today()), public.ist_today())
    into v_from from public.profiles where id = v_user;

    update public.profiles
    set plan_id = v_plan,
        plan_assigned_at = coalesce(plan_assigned_at, now()),
        plan_expires_on = v_from + (coalesce(v_months, 1) || ' months')::interval
    where id = v_user;

    if coalesce(v_plan_credits, 0) > 0 then
      perform public.grant_credits(
        v_user, v_plan_credits, 'plan_grant', null,
        format('Included with the plan, order %s', p_order_id));
    end if;
  else
    perform public.grant_credits(
      v_user, v_credits, 'purchase', null,
      format('Paid %s rupees, order %s', v_amount, p_order_id));
  end if;

  -- Whichever it was, this is money in - so it can be someone's first payment.
  v_referral := public.reward_referral(v_user, v_amount);

  return jsonb_build_object(
    'ok', true, 'granted', true, 'kind', coalesce(v_kind, 'credits'),
    'credits', case when v_kind = 'plan' then coalesce(v_plan_credits, 0) else v_credits end,
    'user_id', v_user,
    'referral', v_referral);
end $fn$;

revoke all on function public.settle_payment(text, text) from public;
grant execute on function public.settle_payment(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. What each side sees
--
-- One row per referrer, so neither the admin table nor the customer's own page
-- has to count across joins.
-- ---------------------------------------------------------------------------
drop view if exists public.referral_summary;
create view public.referral_summary with (security_invoker = on) as
select
  p.id as referrer_id,
  p.email,
  p.full_name,
  p.referral_code,
  count(r.id)                                        as invited,
  count(r.id) filter (where r.status = 'rewarded')    as paid,
  count(r.id) filter (where r.status = 'pending')     as waiting,
  coalesce(sum(r.reward_credits), 0)                  as credits_earned
from public.profiles p
left join public.referrals r on r.referrer_id = p.id
group by p.id, p.email, p.full_name, p.referral_code;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.referrals enable row level security;

drop policy if exists referrals_read on public.referrals;
-- Both sides of a referral may see it, and only the service role writes.
create policy referrals_read on public.referrals for select to authenticated
  using (referrer_id = auth.uid() or referred_id = auth.uid() or public.is_super_admin());

comment on table public.referrals is
  'One row per referred person. Stays pending, earning nothing, until their first payment arrives - a sign-up is free to manufacture, a payment is not.';
