-- ===========================================================================
-- Credits outlive every plan, the trial included.
--
-- The rule, as decided: "make sure koi bhi plan khatam ho jaae (even it is
-- trial plan), credit destroy nahi hone chahiye. sirf auto truck tracking
-- disable ho jaaega. keep manual search as it is."
--
-- So a plan ending - any plan - now costs exactly one thing: automatic
-- tracking stops. The balance is untouched and manual search keeps working
-- until the last credit is spent.
--
-- THIS REVERSES 0050, WHICH IMPLEMENTED THE OPPOSITE RULE ON PURPOSE. That
-- migration was written to a clear instruction ("destroy remaining trial
-- credits... only purchased credits are lifetime credits") and it is being
-- undone by an equally clear one. Both are recorded because the next person to
-- read expire_trial_credits() deserves to know it was deliberate in both
-- directions rather than a bug somebody fixed.
--
-- NOTHING HAS TO BE GIVEN BACK. The sweep never actually took anything from
-- anybody: there is not one credit_transactions row with a trial expiry
-- reason on this database. 0050 shipped, ran on every tick, and found no
-- account that matched - so this is a change to future behaviour only, with no
-- repair to make.
--
-- ---------------------------------------------------------------------------
-- 1 · spend_credits, with the trial cliff removed
--
-- One guard goes and nothing else changes. The rest of the function is
-- reproduced verbatim from the live definition rather than string-patched the
-- way 0049 did it: two layers of surgery on a function body is how a rule
-- ends up somewhere nobody can find it.
--
-- What was there: if the plan is a TRIAL, and it has expired, and the account
-- never paid, then refuse EVERYTHING - including manual_search, and including
-- actions the admin had rated free. A lapsed PAID plan already fell straight
-- through it and went on spending, so the cliff only ever applied to people
-- who had not bought anything yet. That asymmetry is what is being removed:
-- an expired trial now behaves exactly like an expired paid plan.
--
-- The no_active_plan guard below it STAYS, and is now the only thing a plan's
-- end date controls. That is the "auto tracking disable" half of the rule.
-- ---------------------------------------------------------------------------
create or replace function public.spend_credits(
  p_user uuid,
  p_action text,
  p_count integer default 1,
  p_truck text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status  public.account_status;
  v_plan    uuid;
  v_expires date;
  v_rate    numeric(10, 2);
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

comment on function public.spend_credits(uuid, text, integer, text) is
  'The only writer of profiles.credits. Charges on execution, never on outcome. auto_check requires an active plan; nothing else does - credits are a lifetime wallet and survive any plan ending, trial included (0057).';

-- ---------------------------------------------------------------------------
-- 2 · expire_trial_credits becomes a no-op, rather than being dropped
--
-- Dropping it would be tidier and is the wrong call for the few minutes that
-- matter. The tracking sweep calls this on every tick, a deploy is not
-- instant, and a serverless instance still running the previous build would
-- hit "function does not exist" on a path that also does the actual truck
-- checking. A no-op is silent, harmless, and lets the two sides land in
-- either order.
--
-- It keeps its return shape for the same reason: the old caller reads
-- .accounts and .credits_cleared off it and would otherwise log a parse
-- failure every two minutes until the deploy caught up.
--
-- The body is replaced rather than emptied so that anybody running it by hand
-- out of the SQL editor - which is exactly how somebody would "clean up trial
-- accounts" a year from now - takes nothing from anyone either.
-- ---------------------------------------------------------------------------
create or replace function public.expire_trial_credits()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Deliberately does nothing. See 0057: credits survive every plan ending,
  -- so there is no longer any account this is allowed to take from.
  return jsonb_build_object('accounts', 0, 'credits_cleared', 0, 'disabled', true);
end $function$;

comment on function public.expire_trial_credits() is
  'DISABLED in 0057 and kept only so an older deployment calling it does not error. Credits now survive every plan ending, trial included. Safe to drop once nothing calls it.';
