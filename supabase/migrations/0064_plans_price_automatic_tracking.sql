-- 0064: plans priced by how cheap automatic tracking is.
--
-- Owner's model (16 Nov 2026):
--   * A PLAN is for features: how many trucks can be tracked automatically,
--     and how many automatic checks one credit buys. It expires.
--   * CREDITS never expire and are bought as top-ups - with or without a plan.
--   * Manual search costs the same for everyone (credit_rates.manual_search,
--     set by the admin).
--   * The best rate is 1 credit = 10 automatic checks, on Pro and Team.
--
-- The four paid plans are renamed IN PLACE (same ids), so everyone who holds
-- one moves to its successor automatically, keeping their expiry and credits.
-- All current holders are internal accounts with at most 2 trucks, so the new
-- truck limits take nothing away from anyone.

alter table public.plans
  add column if not exists auto_checks_per_credit numeric(10, 2)
    check (auto_checks_per_credit is null or auto_checks_per_credit > 0);

comment on column public.plans.auto_checks_per_credit is
  'How many automatic checks one credit buys on this plan (0064). Null = the global credit_rates.auto_check rate.';

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

  if v_balance < v_cost then
    return jsonb_build_object(
      'allowed', false, 'reason', 'out_of_credits',
      'balance', v_balance, 'cost', v_cost);
  end if;

  update public.profiles set credits = credits - v_cost where id = p_user
  returning credits into v_balance;

  insert into public.credit_transactions (user_id, delta, balance_after, reason, truck_number)
  values (p_user, -v_cost, v_balance, p_action, p_truck);

  return jsonb_build_object('allowed', true, 'cost', v_cost, 'balance', v_balance);
end $function$;


-- The plan list.
update public.plans set
  auto_checks_per_credit = 5,
  description = 'Try automatic tracking free: one truck for seven days, with 51 credits. Once per customer.'
where is_trial;

update public.plans set
  name = 'Starter', truck_limit = 3, auto_checks_per_credit = 5,
  description = 'For trying Rahdari safely: 3 trucks tracked automatically for 30 days. 1 credit = 5 automatic checks.'
where name = 'Mini';

update public.plans set
  name = 'Growth', truck_limit = 6, auto_checks_per_credit = 8,
  description = 'For regular use: 6 trucks tracked automatically for 90 days. 1 credit = 8 automatic checks.'
where name = 'Base';

update public.plans set
  name = 'Pro', truck_limit = 12, auto_checks_per_credit = 10,
  description = 'For the owner who tracks every day: 12 trucks for 90 days at the best rate, 1 credit = 10 automatic checks.'
where name = 'Professional';

update public.plans set
  truck_limit = 20, auto_checks_per_credit = 10,
  description = 'For a transport office: 20 trucks for 90 days at the best rate, 1 credit = 10 automatic checks, and the most credits.'
where name = 'Team';
