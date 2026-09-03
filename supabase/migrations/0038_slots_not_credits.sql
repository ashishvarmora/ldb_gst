-- ===========================================================================
-- Credits are a wallet for searching. Tracking is a subscription with slots.
--
-- ---------------------------------------------------------------------------
-- 1 · THE ARITHMETIC THAT FORCED THIS FILE
--
-- Measured against the live database before writing a line of it:
--
--     credit_rates.manual_search  units_per_credit = 1.00  ->  1 credit
--     credit_rates.auto_check     units_per_credit = 0.50  ->  2 credits
--     app_settings.revisit_minutes = 15
--
-- A tracked truck on a fifteen-minute beat is checked 96 times a day. At two
-- credits a check that is 192 credits a day, 5,760 a month, FOR ONE TRUCK.
--
-- Now hold that against the plans this file is asked to sell:
--
--     plan            credits   slots    what the credits actually cover
--     Tiny                200       3    1 truck for 1 day, not 7
--     Base                750      10    1 truck for 3.9 days, not 30
--     Professional      1,800      25    1 truck for 9.4 days, not 90
--     Team              6,000     100    1 truck for 31 days, not 90
--
-- Professional sells 25 slots for 90 days. Filling those slots for the term
-- it sells costs 25 x 96 x 2 x 90 = 432,000 credits. It hands over 1,800.
-- Every plan on the grid is priced two to three ORDERS OF MAGNITUDE under
-- what it promises, and a customer who uses the feature they paid for empties
-- their wallet in a day and then finds manual search refused as well.
--
-- The credit amounts are not wrong. They are sized for MANUAL SEARCH - 200
-- searches, 750 searches, 1,800 searches are sensible months of typing
-- registration numbers into a box. What is wrong is that one wallet was
-- paying for two products with a 5,760x difference in appetite.
--
-- So the two are separated, which is the owner's own final design:
--
--   * CREDITS are a lifetime wallet, and they buy MANUAL SEARCH. They never
--     expire and they never freeze. A lapsed plan does not touch them.
--   * AUTO-TRACKING is a subscription feature, governed by the plan: how many
--     trucks at once (tracking slots) and until when (the term). It is not
--     paid for out of the wallet at all.
--
-- ---------------------------------------------------------------------------
-- 2 · AUTO_CHECK COSTS ZERO CREDITS, AND WHY THAT IS THE ONLY ANSWER
--
-- A nominal charge was considered and cannot be made to work. Whatever rate
-- is set, the plan's own headline is the bill:
--
--     rate            Professional's promise (25 slots x 90 days)
--     2 credits       432,000 credits against 1,800 handed over
--     0.1 credits      21,600 credits against 1,800 handed over
--     0.01 credits      2,160 credits against 1,800 handed over
--
-- Even at one paisa a check - a hundredth of the current price - the plan is
-- still short. To make a nominal charge survive its own term the rate has to
-- fall below 0.004 credits, at which point the ledger is writing 240,000 rows
-- a month per Team account to record sums that round to nothing. A price that
-- has to be invisible to be affordable is not a price.
--
-- So the rate is ZERO, and zero is given a meaning in spend_credits() rather
-- than being smuggled in by deleting the row: units_per_credit <= 0 means the
-- action is included in the plan. The action stays in credit_rates, stays on
-- the admin's rate screen, and stays callable - so the worker keeps its single
-- gate (a suspended account is still refused there) and the admin can put a
-- price back on automatic checks from the console without a deploy.
--
-- KNOWN CONSEQUENCE, stated rather than discovered later: a free action writes
-- no ledger row, so officer_overview.tracking_queries_today / _month - which
-- count credit_transactions rows with reason 'auto_check' - report 0 for
-- automatic checks from now on. That is deliberate. The alternative is a
-- zero-delta row per check, which at 100 slots is 9,600 rows a day per account
-- in the table every credit report sums over. The figure that means something
-- now is slots used against slots bought, not checks charged.
--
-- ---------------------------------------------------------------------------
-- 3 · TRACKING_SLOTS AND TRUCK_LIMIT ARE ONE CONCEPT
--
-- Checked before adding a column. officer_effective_limits computes
-- coalesce(override.truck_limit, plan.truck_limit, 0), officer_overview
-- carries it as truck_limit, and truckSlotsLeft() in src/lib/officer.ts is
-- truck_limit minus the count of trucks with is_active - that is, the cap is
-- on trucks being AUTO-TRACKED AT ONCE. That is exactly a tracking slot. Two
-- names, one number.
--
-- So tracking_slots is a GENERATED column over truck_limit rather than a
-- second stored figure. Seventeen files outside this change read truck_limit
-- (the whole admin console, the pricing page, the portal's truck screens), and
-- a second stored column would be a number free to disagree with the one they
-- read - the exact failure this repo's own header comments keep warning about.
-- Generated means it cannot drift, needs no writer to remember it, and gives
-- the product its proper word. Anything wanting to CHANGE the number writes
-- truck_limit, which is where every writer already writes.
--
-- ---------------------------------------------------------------------------
-- 4 · DAYS, BECAUSE 7 IS NOT A NUMBER OF MONTHS
--
-- The grid needs 7-day, 30-day and 90-day terms. duration_months cannot hold
-- 7 days, and its check constraint only admits 1, 3, 6 or 12 because
-- pricePlan() charges price_per_month x months and coerces anything else.
--
-- duration_days is added and is THE authority on how long access lasts.
-- duration_months stays at 1 on every paid plan, and price_per_month becomes
-- the price of ONE TERM - so pricePlan()'s price_per_month x months arithmetic
-- charges Rs 999 once for ninety days rather than Rs 999 three times. The two
-- columns now answer different questions and neither is guessed from the
-- other: months is what is CHARGED, days is what is DELIVERED.
--
-- ---------------------------------------------------------------------------
-- 5 · WHAT HAPPENS TO THE TWO EXISTING CUSTOMERS
--
-- Read live: two officer accounts on Basic, both with plan_expires_on = null,
-- and one active tracked truck between them. Null means no expiry, and every
-- rule below is written so null passes:
--
--   * plan_active already reads (expires is null or expires >= today).
--   * The grace sweep only looks at rows with a date in the PAST, so a null
--     expiry is never in grace and is never torn down.
--   * Their credits were never at risk and are now explicitly untouchable.
--   * Basic is renamed to Base and repriced, but a plan's row is what an
--     account points at - they keep the row, and get its new 10 slots.
--
-- They lose nothing and gain free automatic checks. Nobody is cut off by this
-- file.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · A plan's term, in days
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists duration_days integer;

comment on column public.plans.duration_days is
  'How many days access lasts once bought. THE authority on the term - duration_months is only what pricePlan() multiplies price_per_month by, and is 1 on every paid plan so the charge is one term''s price. Null with duration_months null means no expiry, which is what the two founding customers have.';

comment on column public.plans.price_per_month is
  'The price of ONE TERM, not of a month. Named for the arithmetic pricePlan() does - price_per_month x duration_months - which with duration_months 1 charges this figure once. Read duration_days for how long that term runs.';

-- Days belong to paid plans, trial_days to the trial. Keeping each on its own
-- side of the line is what stopped "7" being read as seven months in 0035, and
-- it is the same reason here.
alter table public.plans drop constraint if exists plans_duration_days_range;
alter table public.plans
  add constraint plans_duration_days_range
  check (
    duration_days is null
    or (not is_trial and duration_days between 1 and 3650)
  );


-- ---------------------------------------------------------------------------
-- 2 · Tracking slots, by its proper name
-- ---------------------------------------------------------------------------
-- Generated, not stored. See section 3 of the header: this is truck_limit
-- under the word the product uses, and a second stored figure would be free to
-- disagree with the one seventeen other files already read.
alter table public.plans
  add column if not exists tracking_slots integer
  generated always as (truck_limit) stored;

comment on column public.plans.tracking_slots is
  'How many trucks this plan may auto-track at once. The same number as truck_limit, which is what every reader and every writer already uses - this is the product''s word for it. -1 means no cap. Change it by writing truck_limit.';

comment on column public.plans.truck_limit is
  'Storage for tracking_slots: trucks auto-tracked at once. -1 is uncapped. Write here; read either.';


-- ---------------------------------------------------------------------------
-- 3 · The grid
-- ---------------------------------------------------------------------------
-- Guarded on what is being replaced, like 0035's, because this file runs again
-- on every push and must not reset a price the admin has since edited.
--
-- Slots are sized against the plan's job rather than against credits, now that
-- checks are free: one truck to try it, three for an owner-driver, ten for a
-- small fleet, twenty-five for a transport office, a hundred for a team.
--
-- Credits are sized as manual searches, which is now all they buy:
-- 15 / 200 / 750 / 1,800 / 6,000 searches.

-- Free trial: its numbers are already right live (1 truck, 15 credits, 7
-- days). Only the sentence changes, and it is guarded on the old sentence so a
-- second push cannot overwrite a description the admin has since edited.
update public.plans
set description = 'One truck, seven days. No payment, no card, and it cannot be renewed.'
where is_trial
  and description = 'One truck, seven days. No payment, no card.';

-- Tiny is new. Rs 149 for a week is the rung under Base, for somebody with
-- three lorries who wants a week's proof before committing to a month. No
-- follow-up update: once it exists it is the admin's to edit.
insert into public.plans
  (name, description, truck_limit, included_credits, price_per_month,
   duration_months, duration_days, is_active, sort_order)
values
  ('Tiny', 'Three trucks for a week. The smallest thing worth buying.',
   3, 200, 149, 1, 7, true, 10)
on conflict (name) do nothing;

-- Basic becomes Base. The two live customers point at this row by id, so
-- renaming it keeps them on it - and the rename runs only once, guarded on
-- Base not already existing.
update public.plans
set name = 'Base'
where name = 'Basic'
  and not exists (select 1 from public.plans where name = 'Base');

-- Each guarded on duration_days still being null, which is the one condition
-- that is true exactly once. This file is the only thing in the schema that
-- ever sets that column, so the guard fires on the first push and never again
-- - which matters more than it looks: the owner was editing these prices in
-- the console WHILE this was being written (299 became 499 mid-task), and a
-- guard on the old price would have silently missed. A guard on "this row has
-- not been converted yet" cannot.
update public.plans
set price_per_month = 499, included_credits = 750, truck_limit = 10,
    duration_months = 1, duration_days = 30,
    description = 'Ten trucks for a month. A small fleet, watched properly.',
    sort_order = 20, is_active = true
where name = 'Base' and duration_days is null;

update public.plans
set price_per_month = 999, included_credits = 1800, truck_limit = 25,
    duration_months = 1, duration_days = 90,
    description = 'Twenty-five trucks for three months. A working transport office.',
    sort_order = 30, is_active = true
where name = 'Professional' and duration_days is null;

-- Team was the old 'Unlimited' row renamed in the console; truck_limit = -1
-- becomes a real number, because an uncapped slot count is an uncapped bill
-- for upstream calls now that checks are not metered.
update public.plans
set price_per_month = 2999, included_credits = 6000, truck_limit = 100,
    duration_months = 1, duration_days = 90,
    description = 'A hundred trucks for three months. For a team.',
    sort_order = 40, is_active = true
where name = 'Team' and duration_days is null;

-- Any plan this file did not name is left alone but must not carry a term it
-- cannot express, or it would sell access for ever by omission.
update public.plans
set duration_days = 30
where not is_trial and duration_days is null and duration_months is not null
  and name not in ('Tiny', 'Base', 'Professional', 'Team');

-- Superseded rows come off the public grid.
--
-- This is not hypothetical tidying. Applying this file turned up 'Basic'
-- (Rs 199) and 'Unlimited' (Rs 1,499) sitting active alongside the new grid -
-- 0035's original seed values, resurrected by a concurrent migration run while
-- this was being written. Both were on the pricing page at the wrong price
-- with the wrong slot count, and both were buyable.
--
-- is_active = false, never a delete: payments.plan_id and profiles.plan_id
-- point at these rows, and a receipt has to keep saying what it bought. And
-- only where NOBODY HOLDS IT - an account still on a retired plan keeps a live
-- plan until it lapses, because pulling the row out from under them would
-- switch their trucks off tonight.
update public.plans
set is_active = false
where is_active
  and not is_trial
  and name in ('Basic', 'Unlimited')
  and not exists (select 1 from public.profiles pr where pr.plan_id = plans.id);


-- ---------------------------------------------------------------------------
-- 4 · Automatic checks are included in the plan
-- ---------------------------------------------------------------------------
-- The column refuses zero today: credit_rates_units_per_credit_check is
-- `> 0`, written when every action was chargeable and zero could only be a
-- mistake. It now has a meaning, so the constraint is widened to >= 0 rather
-- than dropped - a NEGATIVE rate still has no reading at all, and would make
-- ceil(count / rate) a negative cost, which is a credit refund per search.
alter table public.credit_rates drop constraint if exists credit_rates_units_per_credit_check;
alter table public.credit_rates
  add constraint credit_rates_units_per_credit_check
  check (units_per_credit >= 0);

-- Zero, with the meaning defined in spend_credits() below. The label and
-- description are what the admin reads on the rate screen, so they have to say
-- what zero means rather than leaving it to be inferred from a number.
update public.credit_rates
set units_per_credit = 0,
    description = 'One background check of a tracked truck. Included in the plan and charged nothing - '
                  || 'how many trucks may be checked at once is the plan''s tracking slots, not the balance. '
                  || 'Set a rate above zero to start charging for these again.'
-- Guarded on the rate it is replacing - the live 0.50 - so that an admin who
-- later decides to charge for automatic checks again keeps their number
-- through the next push. This file must not become the authority on a price
-- that is theirs.
where action = 'auto_check' and units_per_credit > 0;

comment on column public.credit_rates.units_per_credit is
  'How many of this action one credit buys; the cost is the reciprocal, rounded up. ZERO MEANS FREE - the action is included in the plan, spend_credits() allows it, charges nothing and writes no ledger row.';


-- ---------------------------------------------------------------------------
-- 5 · spend_credits learns what free means
-- ---------------------------------------------------------------------------
-- Rebuilt from 0008's version. Same signature, same returned keys. Two changes
-- and nothing else: a rate of zero or less is free, and the suspension check
-- still runs first so a free action cannot be used by a suspended account.
--
-- The free branch returns BEFORE the row lock and before the ledger insert.
-- That is the point of it: 96 checks a day per truck must not take a row lock
-- on profiles or write a row that sums to nothing.
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

  /*
   * Included in the plan. Allowed, costs nothing, changes no balance and
   * writes no ledger row - see the header: a metered automatic check is
   * priced two orders of magnitude above what any plan can carry, and a
   * zero-delta row per check would put 9,600 rows a day per Team account into
   * the table every credit report sums over.
   *
   * The balance is deliberately NOT read here. A free action must work on an
   * empty wallet, or "credits never freeze tracking" would be untrue the
   * moment somebody spent their last credit on a search.
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
end $fn$;

comment on function public.spend_credits(uuid, text, integer, text) is
  'Debits one action against the wallet, atomically. A credit_rates rate of zero or less means the action is included in the plan: allowed, charged nothing, no ledger row.';

-- The sweep 0025 applies to every security-definer function. Recreating one
-- resets its privileges to the schema default, and Supabase's default hands
-- anon and authenticated an EXECUTE grant - so a bare revoke from public would
-- leave a signed-in customer able to spend somebody else's balance. This repo
-- has been bitten by exactly that twice.
revoke all on function public.spend_credits(uuid, text, integer, text) from public;
revoke all on function public.spend_credits(uuid, text, integer, text) from anon, authenticated;
grant execute on function public.spend_credits(uuid, text, integer, text) to service_role;


-- ---------------------------------------------------------------------------
-- 6 · A truck can be stopped because the plan lapsed
-- ---------------------------------------------------------------------------
-- The worker already skips a truck whose plan has run out. What it could not
-- do was say so on the row, so a customer whose plan lapsed saw trucks that
-- were switched on and were not being checked, with nothing anywhere
-- explaining it. 'plan_expired' is that explanation, written after the grace
-- period by the sweep in src/lib/tracking.ts.
alter table public.tracked_trucks drop constraint if exists tracked_trucks_paused_reason_known;
alter table public.tracked_trucks
  add constraint tracked_trucks_paused_reason_known
  check (
    paused_reason is null
    or paused_reason = any (array[
      'manual', 'repeated_failures', 'account_suspended',
      'schedule', 'inactive', 'plan_expired'
    ])
  );


-- ---------------------------------------------------------------------------
-- 7 · Settlement counts the term in days
-- ---------------------------------------------------------------------------
-- Rebuilt from 0036's version. ONE block changes - where v_expires is computed
-- - and everything else, including the whole combined plan-plus-top-up
-- settlement 0036 added and 0035's rules about where the term is counted from,
-- is that file's code unchanged. Same signature, same returned keys, so the
-- webhook, confirmCheckout and record_offline_payment see what they saw.
--
-- Why duration_days and not duration_months: a 7-day plan cannot be expressed
-- in months, and the months column is now only what the charge is multiplied
-- by. Falling back to months when days is null keeps any plan row this file
-- did not touch settling exactly as it did before.
create or replace function public.settle_payment(p_order_id text, p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id      uuid;
  v_user    uuid;
  v_credits numeric(12, 2);
  v_amount  numeric(10, 2);
  v_kind    text;
  v_plan    uuid;
  v_months  integer;
  v_topup   numeric(12, 2);
  v_plan_credits numeric(12, 2);
  v_term    integer;
  v_days    integer;
  v_trial   boolean;
  v_trial_days integer;
  v_from    date;
  v_expires date;
  v_referral jsonb;
  v_grant   jsonb;
  v_topup_grant jsonb;
begin
  update public.payments
  set status = 'paid',
      razorpay_payment_id = p_payment_id,
      paid_at = now()
  where razorpay_order_id = p_order_id
    and status = 'created'
  returning id, user_id, credits, amount_inr, kind, plan_id, months, topup_credits
  into v_id, v_user, v_credits, v_amount, v_kind, v_plan, v_months, v_topup;

  /*
   * Nothing moved from 'created' to 'paid', so this payment was settled
   * already - almost always because the webhook won the race with the
   * browser, which is the normal case rather than an error.
   */
  if v_user is null then
    select id into v_id
    from public.payments
    where razorpay_order_id = p_order_id;

    return jsonb_build_object(
      'ok', true, 'granted', false, 'reason', 'not_pending',
      'payment_id', v_id);
  end if;

  perform public.settle_coupon(v_id, true);

  if v_kind = 'plan' and v_plan is not null then
    select included_credits, duration_months, duration_days, is_trial, trial_days
    into v_plan_credits, v_term, v_days, v_trial, v_trial_days
    from public.plans where id = v_plan;

    -- v_months is deliberately not read here. It is still the record of the
    -- term that was CHARGED - price_per_month x months - but the plan row is
    -- the authority on when access ends, and reading both would be two answers.
    select
      case
        when pr.plan_id is null then public.ist_today()
        when coalesce(cur.is_trial, false) then public.ist_today()
        else greatest(coalesce(pr.plan_expires_on, public.ist_today()), public.ist_today())
      end
    into v_from
    from public.profiles pr
    left join public.plans cur on cur.id = pr.plan_id
    where pr.id = v_user;

    /*
     * Days first, months only as the fallback for a plan row this file did not
     * set - and the trial ahead of both, because record_offline_payment() takes
     * any plan id an admin types and a free row reaching here must still end.
     */
    v_expires := case
      when coalesce(v_trial, false) then v_from + coalesce(v_trial_days, 7)
      when v_days is not null then v_from + v_days
      when v_term is null then null
      else (v_from + (v_term || ' months')::interval)::date
    end;

    update public.profiles
    set plan_id = v_plan,
        plan_assigned_at = coalesce(plan_assigned_at, now()),
        plan_expires_on = v_expires
    where id = v_user;

    if coalesce(v_plan_credits, 0) > 0 then
      v_grant := public.grant_credits(
        v_user, v_plan_credits, 'plan_grant', null,
        format('Included with the plan, order %s', p_order_id), v_id);
    end if;

    /*
     * The top-up bought in the same payment, as its own ledger row with the
     * same payment_id. 0036's code and 0036's reasoning, unchanged.
     */
    if coalesce(v_topup, 0) > 0 then
      v_topup_grant := public.grant_credits(
        v_user, v_topup, 'purchase', null,
        format('Credits topped up with the plan, order %s', p_order_id), v_id);
    end if;
  else
    v_grant := public.grant_credits(
      v_user, v_credits, 'purchase', null,
      format('Paid %s rupees, order %s', v_amount, p_order_id), v_id);
  end if;

  -- Whichever it was, this is money in - so it can be someone's first payment.
  v_referral := public.reward_referral(v_user, v_amount);

  return jsonb_build_object(
    'ok', true, 'granted', true, 'kind', coalesce(v_kind, 'credits'),
    'credits', case
      when v_kind = 'plan' then coalesce(v_plan_credits, 0) + coalesce(v_topup, 0)
      else v_credits
    end,
    'plan_credits', case when v_kind = 'plan' then coalesce(v_plan_credits, 0) end,
    'topup_credits', case when v_kind = 'plan' then coalesce(v_topup, 0) end,
    'user_id', v_user,
    'payment_id', v_id,
    'plan_expires_on', v_expires,
    'balance_before', coalesce(v_grant -> 'balance_before', v_topup_grant -> 'balance_before'),
    'balance_after', coalesce(v_topup_grant -> 'balance', v_grant -> 'balance'),
    'referral', v_referral);
end $fn$;

comment on function public.settle_payment(text, text) is
  'Hands over what a payment bought, exactly once. A plan payment grants the plan - term from plans.duration_days, falling back to duration_months - its included credits, and any top-up bought in the same payment, as separate ledger rows sharing the payment_id.';

revoke all on function public.settle_payment(text, text) from public;
revoke all on function public.settle_payment(text, text) from anon, authenticated;
grant execute on function public.settle_payment(text, text) to service_role;


-- ---------------------------------------------------------------------------
-- 8 · The grace period, as a number the database owns
-- ---------------------------------------------------------------------------
-- Seven days after a plan ends, the trucks are switched off with
-- 'plan_expired' on the row. Between the two dates nothing is checked and no
-- alert is sent - the plan has ended - but every truck stays switched on, so
-- renewing puts the account back exactly as it was with nothing to re-enable.
--
-- A function rather than a constant in TypeScript because two things need the
-- same answer: the sweep that tears tracking down, and the portal that
-- promises how long there is left. A constant in one of them is a promise the
-- other can break.
--
-- Not SECURITY DEFINER - it takes no arguments, reads nothing and returns a
-- constant - so there is no privilege sweep to apply to it, and the portal's
-- own queries may call it.
create or replace function public.plan_grace_days()
returns integer
language sql
immutable
parallel safe
as $fn$ select 7 $fn$;

comment on function public.plan_grace_days() is
  'Days after a plan expires before its trucks are actually switched off. Tracking and alerts stop on day zero; this is only how long the account has to renew and find everything as it left it.';
