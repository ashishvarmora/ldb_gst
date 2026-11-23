-- ===========================================================================
-- 0073: credit holds - hold / consume / release for manual searches.
--
-- Applied 23 Nov 2026 on the owner's go-ahead. spend_credits below is the LIVE
-- 0064 definition (plan-priced auto checks) with only the held-credits test added.
-- Design and rollout plan: docs/CREDIT-HOLD-DESIGN.md. Review it before
-- running this, and deploy the app change described there right after.
--
-- Owner's rule (20 Nov 2026): a manual search HOLDS its credit when it starts,
-- CONSUMES it when it succeeds and RELEASES it when it fails. Today a search is
-- charged up front by spend_credits() and a failure is given back with a
-- separate 'search_refund' grant (0062), so every failure leaves two ledger
-- rows behind. With holds a failed search never reaches the ledger at all.
--
-- Shape:
--   credit_holds              one row per started search; the audit trail of
--                             holds, including the ones that were released.
--   profiles.credits          unchanged meaning: the LEDGER balance. A hold
--                             does not move it; consuming does.
--   available                 credits - sum(active, unexpired holds). What a
--                             new hold or an automatic check may spend.
--   credit_transactions       gets hold_id: the consumed hold behind a charge.
--
-- Everything here is additive except spend_credits(), which learns to leave
-- held credits alone. With no holds in the table it behaves exactly as 0057.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 · the table
-- ---------------------------------------------------------------------------
create table if not exists public.credit_holds (
  id               bigserial primary key,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  action           text not null default 'manual_search',
  truck_number     text,
  amount           numeric(12, 2) not null check (amount > 0),
  -- active -> consumed | released | expired. Never back to active.
  status           text not null default 'active'
                     check (status in ('active', 'consumed', 'released', 'expired')),
  -- Supplied by the caller (one per search attempt), so a retried request
  -- finds its first hold instead of taking a second one.
  idempotency_key  text not null check (length(idempotency_key) between 8 and 120),
  -- The charge this hold became, once consumed.
  ledger_id        bigint references public.credit_transactions (id) on delete set null,
  -- Why it was released (the portal's error, shortened), for support.
  note             text,
  created_at       timestamptz not null default now(),
  -- A hold nobody settles stops counting against the balance after this.
  expires_at       timestamptz not null default now() + interval '5 minutes',
  settled_at       timestamptz,
  unique (user_id, idempotency_key),
  check ((status = 'active') = (settled_at is null)),
  check (status <> 'consumed' or ledger_id is not null)
);

comment on table public.credit_holds is
  'Credits reserved by a started manual search (0073). active holds reduce the available balance; consumed holds become a manual_search ledger row; released/expired holds never touch the ledger. Written only by hold_credits / consume_hold / release_hold / expire_credit_holds.';

-- The hot read: an account's active holds, inside spend/hold.
create index if not exists credit_holds_active_idx
  on public.credit_holds (user_id, expires_at)
  where status = 'active';

-- Support and the admin: an account's holds, newest first.
create index if not exists credit_holds_user_time_idx
  on public.credit_holds (user_id, created_at desc);

alter table public.credit_transactions
  add column if not exists hold_id bigint references public.credit_holds (id) on delete set null;

-- One charge per hold, ever.
create unique index if not exists credit_transactions_hold_uidx
  on public.credit_transactions (hold_id)
  where hold_id is not null;

alter table public.credit_holds enable row level security;
revoke all on public.credit_holds from public, anon, authenticated;
grant select, insert, update on public.credit_holds to service_role;
grant usage, select on sequence public.credit_holds_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 2 · what is held right now
-- ---------------------------------------------------------------------------
create or replace function public.credits_held(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(12, 2)
  from public.credit_holds
  where user_id = p_user and status = 'active' and expires_at > now();
$$;

revoke all on function public.credits_held(uuid) from public, anon, authenticated;
grant execute on function public.credits_held(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3 · hold_credits: reserve the cost of one action
-- ---------------------------------------------------------------------------
create or replace function public.hold_credits(
  p_user  uuid,
  p_key   text,
  p_action text default 'manual_search',
  p_truck text default null
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
  v_held    numeric(12, 2);
  v_hold    public.credit_holds%rowtype;
begin
  -- Same refusals as spend_credits(), in the same order.
  select status into v_status from public.profiles where id = p_user;
  if v_status is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_such_user');
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'account_suspended');
  end if;
  if p_action <> 'manual_search' then
    -- Automatic checks stay charge-on-execution (spend_credits); a hold is
    -- only for the action whose outcome the customer is waiting on.
    return jsonb_build_object('allowed', false, 'reason', 'unknown_action');
  end if;

  select units_per_credit into v_rate from public.credit_rates where action = p_action;
  if v_rate is null then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_action');
  end if;
  if v_rate <= 0 then
    -- Free: nothing to hold (mirrors spend_credits' free branch).
    select credits into v_balance from public.profiles where id = p_user;
    return jsonb_build_object('allowed', true, 'cost', 0, 'balance', v_balance, 'free', true);
  end if;
  v_cost := ceil((1::numeric / v_rate) * 100) / 100;

  -- The profile row is THE lock for everything that spends this balance:
  -- spend_credits, hold_credits and consume_hold all take it first.
  select credits into v_balance from public.profiles where id = p_user for update;

  -- Idempotent: the same key returns the same hold, whatever became of it.
  select * into v_hold from public.credit_holds where user_id = p_user and idempotency_key = p_key;
  if found then
    return jsonb_build_object(
      'allowed', v_hold.status in ('active', 'consumed'),
      'hold_id', v_hold.id, 'status', v_hold.status, 'cost', v_hold.amount, 'replayed', true);
  end if;

  v_held := public.credits_held(p_user);
  if v_balance - v_held < v_cost then
    return jsonb_build_object(
      'allowed', false, 'reason', 'out_of_credits',
      'balance', v_balance - v_held, 'cost', v_cost);
  end if;

  insert into public.credit_holds (user_id, action, truck_number, amount, idempotency_key)
  values (p_user, p_action, p_truck, v_cost, p_key)
  returning * into v_hold;

  return jsonb_build_object(
    'allowed', true, 'hold_id', v_hold.id, 'cost', v_cost,
    'balance', v_balance - v_held - v_cost);
end $fn$;

-- ---------------------------------------------------------------------------
-- 4 · consume_hold: the search succeeded - the hold becomes the charge
-- ---------------------------------------------------------------------------
create or replace function public.consume_hold(p_user uuid, p_hold bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hold    public.credit_holds%rowtype;
  v_balance numeric(12, 2);
  v_ledger  bigint;
begin
  perform 1 from public.profiles where id = p_user for update;
  select * into v_hold from public.credit_holds where id = p_hold and user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_hold');
  end if;
  if v_hold.status = 'consumed' then
    return jsonb_build_object('ok', true, 'ledger_id', v_hold.ledger_id, 'replayed', true);
  end if;
  if v_hold.status <> 'active' then
    -- Released or expired: the credit is already back. Do not charge late.
    return jsonb_build_object('ok', false, 'reason', 'hold_' || v_hold.status);
  end if;

  -- Reserved against the available balance when taken, so this cannot go
  -- below zero; greatest() is a guard, not a rule.
  update public.profiles set credits = greatest(credits - v_hold.amount, 0) where id = p_user
  returning credits into v_balance;

  insert into public.credit_transactions (user_id, delta, balance_after, reason, truck_number, hold_id)
  values (p_user, -v_hold.amount, v_balance, v_hold.action, v_hold.truck_number, v_hold.id)
  returning id into v_ledger;

  update public.credit_holds
  set status = 'consumed', ledger_id = v_ledger, settled_at = now()
  where id = v_hold.id;

  return jsonb_build_object('ok', true, 'ledger_id', v_ledger, 'balance', v_balance);
end $fn$;

-- ---------------------------------------------------------------------------
-- 5 · release_hold: the search failed - nothing is charged
-- ---------------------------------------------------------------------------
create or replace function public.release_hold(p_user uuid, p_hold bigint, p_why text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
begin
  update public.credit_holds
  set status = 'released', settled_at = now(), note = left(p_why, 200)
  where id = p_hold and user_id = p_user and status = 'active'
  returning status into v_status;

  if v_status is null then
    select status into v_status from public.credit_holds where id = p_hold and user_id = p_user;
    if v_status is null then
      return jsonb_build_object('ok', false, 'reason', 'no_such_hold');
    end if;
    -- Already released / expired: idempotent. Already consumed: too late.
    return jsonb_build_object('ok', v_status <> 'consumed', 'status', v_status, 'replayed', true);
  end if;
  return jsonb_build_object('ok', true, 'status', 'released');
end $fn$;

-- ---------------------------------------------------------------------------
-- 6 · expire_credit_holds: the sweep for holds nobody settled
-- ---------------------------------------------------------------------------
create or replace function public.expire_credit_holds()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    update public.credit_holds
    set status = 'expired', settled_at = now(), note = coalesce(note, 'not settled in time')
    where status = 'active' and expires_at <= now()
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.hold_credits(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.consume_hold(uuid, bigint) from public, anon, authenticated;
revoke all on function public.release_hold(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.expire_credit_holds() from public, anon, authenticated;
grant execute on function public.hold_credits(uuid, text, text, text) to service_role;
grant execute on function public.consume_hold(uuid, bigint) to service_role;
grant execute on function public.release_hold(uuid, bigint, text) to service_role;
grant execute on function public.expire_credit_holds() to service_role;

-- ---------------------------------------------------------------------------
-- 7 · spend_credits leaves held credits alone
--
-- Identical to the live 0064 definition except the affordability test, which now compares with
-- the AVAILABLE balance (credits - active holds). Without this an automatic
-- check could spend a credit a running search is holding, and the search's
-- consume would then take the balance below what was reserved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_credits(p_user uuid, p_action text, p_count integer DEFAULT 1, p_truck text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status  public.account_status;
  v_plan    uuid;
  v_expires date;
  v_rate    numeric(10, 2);
  v_plan_rate numeric(10, 2);
  v_cost    numeric(12, 2);
  v_balance numeric(12, 2);
  v_held    numeric(12, 2);
begin
  -- The plan and its end date are still read: the auto_check guard below
  -- needs both, and it is the same row lookup either way.
  select status, plan_id, plan_expires_on
  into v_status, v_plan, v_expires
  from public.profiles where id = p_user;

  if v_status is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_such_user');
  end if;
  if v_status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'account_suspended');
  end if;

  select units_per_credit into v_rate from public.credit_rates where action = p_action;

  /*
   * AUTOMATIC CHECKS ARE PRICED BY THE PLAN (0064). The plan is what decides
   * how many automatic checks one credit buys - the bigger the plan, the
   * cheaper tracking is. Manual search stays on the one admin-set rate in
   * credit_rates, the same for every customer. A plan without its own rate
   * (null) falls back to that global rate.
   */
  if p_action = 'auto_check' and v_plan is not null then
    -- Into its own variable: a missing plan row must not null the rate.
    select auto_checks_per_credit into v_plan_rate
    from public.plans where id = v_plan;
    v_rate := coalesce(v_plan_rate, v_rate);
  end if;
  if v_rate is null then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_action');
  end if;

  /*
   * THE TRIAL CLIFF USED TO BE HERE and is deliberately gone. An expired
   * trial is now just an expired plan: it stops automatic checking at the
   * guard below and does nothing else. Credits are a wallet, and how somebody
   * came by them - bought, granted, or given with a trial - does not change
   * whose they are.
   */

  /*
   * Automatic tracking needs an active plan. Manual search deliberately does
   * not: credits are a lifetime wallet, and a lapsed or plan-less account may
   * still search while it has any. A live trial counts as active, which is
   * what lets a trial truck be tracked at all.
   *
   * This is now the ONLY consequence of a plan running out.
   */
  if p_action = 'auto_check'
     and not (v_plan is not null
              and (v_expires is null or v_expires >= public.ist_today()))
  then
    select credits into v_balance from public.profiles where id = p_user;
    return jsonb_build_object(
      'allowed', false, 'reason', 'no_active_plan',
      'balance', v_balance, 'cost', 0);
  end if;

  /*
   * Included in the plan: allowed, costs nothing, changes no balance and
   * writes no ledger row. Dormant as of 0041 - both rates are 1 - and kept
   * because the rate is the admin's, editable without a deploy, and this is
   * the only place that gives a zero any meaning.
   *
   * The balance is deliberately NOT read for the verdict. A free action must
   * work on an empty wallet, or an admin who set a rate to zero would find it
   * still refused the moment somebody spent their last credit.
   */
  if v_rate <= 0 then
    select credits into v_balance from public.profiles where id = p_user;
    return jsonb_build_object('allowed', true, 'cost', 0, 'balance', v_balance, 'free', true);
  end if;

  -- Round up: a part-used credit is a used credit, and rounding down would let
  -- a cheap action be free for ever.
  v_cost := ceil((p_count::numeric / v_rate) * 100) / 100;

  -- Lock the row so the read and the write cannot be interleaved.
  select credits into v_balance from public.profiles where id = p_user for update;
  -- 0073: credits a running manual search is holding are not spendable.
  v_held := public.credits_held(p_user);

  if v_balance - v_held < v_cost then
    return jsonb_build_object(
      'allowed', false, 'reason', 'out_of_credits',
      'balance', v_balance - v_held, 'cost', v_cost);
  end if;

  update public.profiles set credits = credits - v_cost where id = p_user
  returning credits into v_balance;

  insert into public.credit_transactions (user_id, delta, balance_after, reason, truck_number)
  values (p_user, -v_cost, v_balance, p_action, p_truck);

  return jsonb_build_object('allowed', true, 'cost', v_cost, 'balance', v_balance - v_held);
end $function$;

comment on function public.spend_credits(uuid, text, integer, text) is
  'Charges on execution (automatic checks). Spends only the available balance - credits minus active holds (0073). auto_check requires an active plan; nothing else does.';

revoke all on function public.spend_credits(uuid, text, integer, text) from public;
revoke all on function public.spend_credits(uuid, text, integer, text) from anon, authenticated;
grant execute on function public.spend_credits(uuid, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8 · optional index for /portal/activity and /portal/credits
--
-- Both read credit_ledger_daily filtered by IST day. The view groups on
-- (created_at at time zone 'Asia/Kolkata')::date, which the existing
-- (user_id, created_at) index cannot serve, so a date filter scans every row
-- the account has. Matters only for accounts with many trucks over months
-- (96 auto checks a truck a day). Independent of the holds above - it can be
-- split out and applied on its own.
-- ---------------------------------------------------------------------------
create index if not exists credit_transactions_user_ist_day_idx
  on public.credit_transactions (user_id, ((created_at at time zone 'Asia/Kolkata')::date));
