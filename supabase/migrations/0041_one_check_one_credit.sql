-- ===========================================================================
-- One check is one credit, whoever asked for it.
--
-- ---------------------------------------------------------------------------
-- 1 · WHAT THIS REVERSES, AND WHOSE DECISION IT IS
--
-- 0038 made automatic checking free: auto_check rated 0, spend_credits()
-- reading a zero rate as "included in the plan", no charge and no ledger row.
-- Its reasoning is in that file and it was sound arithmetic. The owner has
-- reversed it anyway, in their own words:
--
--     "auto check 1 check = 1 credit, manual 1 check = 1 credit"
--
-- So both actions cost one credit, and an automatic check charges and is
-- recorded exactly like a search. The zero-rate MEANING is kept - it is the
-- admin's lever, editable on the rate screen without a deploy - but nothing in
-- the schema relies on it any more.
--
-- What the reversal buys is honesty about where the cost sits. A tracked truck
-- makes a real upstream call every revisit whether or not anybody is charged
-- for it, and under 0038 the customer had no reason to care: a faster beat was
-- free and pausing a truck saved nothing. It now costs, which is what makes
-- pausing a truck worth doing and the alert interval worth choosing.
--
-- ---------------------------------------------------------------------------
-- 2 · THE ARITHMETIC, STATED RATHER THAN BURIED
--
-- Read live before writing this file: app_settings.revisit_minutes = 15, so a
-- tracked truck is checked 96 times a day. At one credit a check that is 96
-- credits a day PER TRUCK, and the grid below reads:
--
--     plan            credits   term       one truck lasts
--     Free trial           15   7 days     3.75 HOURS
--     Mini                200   1 month    2.1 days
--     Base                800   3 months   8.3 days
--     Professional      2,000   3 months   20.8 days
--     Team              7,000   3 months   72.9 days
--
-- No plan's included credits cover its own term for even one truck. That is
-- implemented as asked and is not a bug in this file - the numbers are the
-- owner's - but it is written down here so the next person to read it does not
-- have to rediscover it. The lever is revisit_minutes, which is a setting and
-- is DELIBERATELY NOT TOUCHED HERE: at 60 minutes the same truck is 24 credits
-- a day and Professional's 2,000 covers 83 days, which is its term. Changing a
-- live polling interval is the owner's call, not a migration's.
--
-- The plans sell access - how many trucks at once, and until when. Top-ups
-- sell volume, and deliberately sell it cheaper than the same money inside a
-- plan (Rs 499 buys 1,000 credits as a top-up against 800 inside Base). That
-- asymmetry is the owner's intent and is not corrected here.
--
-- ---------------------------------------------------------------------------
-- 3 · PLAN EXPIRY GOVERNS AUTO-SEARCH ONLY, AND THE TRIAL IS THE EXCEPTION
--
-- The owner: "plan is providing auto search and etc timing, not credit limit
-- ... each plan: no timelimit for credit expiry and manual search. plan can
-- stop auto searching only. only free trial expire all."
--
-- Three of those four rules were already true and needed nothing:
--
--   * Credits never expire. Nothing in the schema reduces a balance except
--     spend_credits(), and no sweep clears one on lapse.
--   * Manual search is not gated on the plan. blockedReason() in
--     src/lib/officer.ts tests the balance alone - 0038 removed the plan gate.
--   * A lapsed plan stops automatic checking. The worker's candidate query
--     filters on plan_expires_on, so a lapsed account makes no upstream call.
--
-- The fourth was not implemented at all: a lapsed FREE TRIAL still spent its
-- leftover credits on manual searches for ever. A trial is not a purchase, so
-- when it ends it ends - and the fifteen credits it handed over stop being
-- spendable. That rule goes into spend_credits() in section 5, because
-- spend_credits() is the one gate both the portal and the worker pass through.
--
-- WITH ONE ESCAPE, which is the whole reason the rule is not a two-line test:
-- a lapsed-trial account can still buy a top-up (the panel is open to lapsed
-- accounts by design), and refusing to let somebody spend credits they have
-- just PAID for would be taking their money. So the refusal applies only while
-- the account has never made a paid payment. The predicate is copied verbatim
-- from start_free_trial()'s own 'has_paid' check, so "has this account ever
-- paid" has one reading in the schema rather than two.
--
-- ---------------------------------------------------------------------------
-- 4 · WHAT HAPPENS TO THE ACCOUNTS THAT EXIST
--
-- Read live before writing, not assumed:
--
--   * TWO customers on Base, both with plan_expires_on = null. Null is no
--     expiry, so the trial rule cannot touch them, the grace sweep never sees
--     them, and their 438 and 312 credits are untouched. Base is repriced
--     under them - included_credits 750 -> 800, term 30 -> 90 days - and a
--     plan's row is what an account points at, so they keep the row and gain
--     by it. Their next automatic check now costs a credit, which is the
--     reversal working as intended and is the one thing they will notice.
--   * THREE customers on the Free trial, expiring 9 and 10 September, holding
--     14, 2 and 14 credits. Those balances stop being spendable on the day the
--     trial ends. That is the owner's rule; it is named here because it is the
--     only place in this change where anybody loses something.
--   * NOBODY holds Tiny, Basic, Unlimited or Professional or Team. Tiny is the
--     only active leftover, and retiring it strands no account.
--   * ONE payment references the Rs 199 top-up rung being repriced to Rs 149.
--     payments carry their own amount_inr and credits, so that receipt still
--     says what was actually paid and bought.
--
-- Superseded rows are is_active = false and never deleted: payments.plan_id,
-- payments.pack_id and profiles.plan_id point at them and a receipt has to
-- keep saying what it bought.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · An automatic check costs a credit again
-- ---------------------------------------------------------------------------
-- Guarded on the zero it is replacing, exactly the way 0038 guarded on the
-- 0.50 it replaced: this file must not become the authority on a price that
-- belongs to the admin. An admin who later decides checks should be free again
-- sets the rate to 0 on the rate screen and keeps that through every push.
update public.credit_rates
set units_per_credit = 1,
    description = 'One background check of a tracked truck, at the same price as a search. '
                  || 'A truck on a 15-minute alert is checked 96 times a day, so this is the rate '
                  || 'that decides what tracking costs - pausing a truck is how a customer stops it.'
where action = 'auto_check' and units_per_credit = 0;

-- The column comment still has to explain zero, because zero is still a legal
-- and meaningful setting - it is just no longer the one in force.
comment on column public.credit_rates.units_per_credit is
  'How many of this action one credit buys; the cost is the reciprocal, rounded up. Both actions are 1 as of 0041. ZERO STILL MEANS FREE - spend_credits() allows the action, charges nothing and writes no ledger row - and is kept as the admin''s lever for including an action in the plan.';


-- ---------------------------------------------------------------------------
-- 2 · Exactly five plans, and nothing else buyable
-- ---------------------------------------------------------------------------
-- Free trial   Rs     0   7 days    15 credits   never renews
-- Mini         Rs   149   1 month   200 credits
-- Base         Rs   499   3 months  800 credits
-- Professional Rs   999   3 months  2,000 credits
-- Team         Rs 2,999   3 months  7,000 credits
--
-- duration_days stays THE term and duration_months stays 1 on every paid plan,
-- which is 0038's split and the reason a 3-month plan charges Rs 499 once
-- rather than three times: pricePlan() charges price_per_month x months.
-- Ninety days rather than three calendar months because duration_days is what
-- settle_payment() adds, and 90 is what "3 months" is sold as everywhere else
-- on the grid.

-- Mini is the rung Tiny was reaching for and got wrong: the same Rs 149 and
-- the same 200 credits, but a month rather than a week, which is what the
-- owner's grid asks for. Three tracking slots - one truck is the trial's job,
-- and ten is Base's - and no follow-up update, because once the row exists the
-- numbers on it are the admin's to edit.
insert into public.plans
  (name, description, truck_limit, included_credits, price_per_month,
   duration_months, duration_days, is_active, sort_order)
values
  ('Mini', 'Three trucks for a month. The smallest paid plan.',
   3, 200, 149, 1, 30, true, 10)
on conflict (name) do nothing;

-- Each guarded on the figures it replaces rather than on "not yet converted",
-- because unlike 0038 there is no single column here that is null exactly once.
-- A guard on the old values means an admin who has since edited a price or a
-- credit count in the console keeps their number through the next push, which
-- is the behaviour this repo has settled on for every seeded price.
update public.plans
set included_credits = 800, duration_days = 90,
    description = 'Ten trucks for three months. A small fleet, watched properly.',
    sort_order = 20, is_active = true
where name = 'Base' and included_credits = 750 and duration_days = 30;

update public.plans
set included_credits = 2000,
    description = 'Twenty-five trucks for three months. A working transport office.',
    sort_order = 30, is_active = true
where name = 'Professional' and included_credits = 1800 and duration_days = 90;

update public.plans
set included_credits = 7000,
    description = 'A hundred trucks for three months. For a team.',
    sort_order = 40, is_active = true
where name = 'Team' and included_credits = 6000 and duration_days = 90;

-- Everything that is not one of the five comes off the grid.
--
-- Tiny is the live one: Rs 149 for SEVEN days, which sits underneath Mini at
-- the same price for a quarter of the term and would be the cheaper-looking
-- row next to it. Basic and Unlimited are 0035's originals and are already
-- inactive; they are named so a database where a concurrent run resurrected
-- them heals itself, which is exactly what happened to 0038.
--
-- Only where NOBODY HOLDS IT. An account still pointing at a retired row keeps
-- a live plan until it lapses, because pulling the row out from under them
-- would switch their trucks off tonight. Verified live: none of these three
-- has a holder, so all three retire on the first push.
update public.plans
set is_active = false
where is_active
  and not is_trial
  and name in ('Tiny', 'Basic', 'Unlimited')
  and not exists (select 1 from public.profiles pr where pr.plan_id = plans.id);

-- The trial's numbers are already right live - 1 truck, 15 credits, 7 days -
-- so only the sentence changes, and only while it is still 0038's sentence.
-- "It cannot be renewed" is the load-bearing half: the trial is refused a
-- second time by three separate guards (plan_id set, plan_assigned_at set, and
-- a unique claim row) and priced at zero, which pricePlan() refuses outright.
update public.plans
set description = 'One truck, seven days, 15 credits. No payment, no card, once per account - and when it ends, it ends.'
where is_trial
  and description = 'One truck, seven days. No payment, no card, and it cannot be renewed.';


-- ---------------------------------------------------------------------------
-- 3 · The top-up ladder
-- ---------------------------------------------------------------------------
-- Rs   149 ->   300 credits   Rs 0.497 each
-- Rs   499 -> 1,000 credits   Rs 0.499 each
-- Rs   999 -> 2,500 credits   Rs 0.400 each
-- Rs 2,499 -> 7,000 credits   Rs 0.357 each
-- Rs 3,000 and above -> 300% of the amount   Rs 0.333 each
--
-- The open tier is a flat percentage, so its rate is identical at every
-- amount, which means it has to be the BEST rate on the ladder and its minimum
-- has to sit above every fixed rung. Rs 3,000 clears Rs 2,499 and 300% of a
-- rupee at credits_per_rupee = 1 is 3 credits, so it is 33.3 paise a credit -
-- the cheapest row, as it must be.
--
-- ONE RUNG IS NOT MONOTONIC, and it is left alone on purpose because the
-- figures are the owner's: Rs 499 is 49.9 paise a credit against Rs 149's
-- 49.67, so the second rung is fractionally WORSE value than the first. It is
-- a 0.5% difference - three Rs 149 packs are Rs 447 for 900 credits against
-- Rs 499 for 1,000 - so nobody is going to work it out at the counter, but it
-- is a real inversion and this is where it is recorded rather than discovered.

-- The Rs 199 rung becomes the Rs 149 one the grid asks for. Same 300 credits,
-- so it is the same rung repriced rather than a new one, and repricing keeps
-- the one payment that references it pointing at a row that still exists.
--
-- Renamed at the same time, and only because of the collision: a pack called
-- 'mini' at Rs 149 would sit on the buy panel next to a PLAN called 'Mini' at
-- Rs 149, buying a different number of credits. Pack names are rendered to
-- customers, so two things with one name at one price is a support call. The
-- rename fires only while 'Small' does not already exist, or a second push
-- would be a unique-key violation on credit_packs_name_key - which is exactly
-- how 0013 and 0035 once deadlocked every migration after them.
update public.credit_packs
set name = 'Small', price_inr = 149, sort_order = 5
where name = 'mini' and price_inr = 199 and credits = 300
  and not exists (select 1 from public.credit_packs where name = 'Small');

-- Starter (Rs 499 -> 1,000), Standard (Rs 999 -> 2,500) and Plus
-- (Rs 2,499 -> 7,000) are already exactly the grid live. Deliberately no
-- update statements for them: a guarded update that changes nothing is still a
-- claim on numbers this file does not own.

-- The open tier's minimum moves to Rs 3,000. Its `credits` column is the
-- placeholder 0012 describes - what the MINIMUM buys - and is moved with it so
-- the two cannot disagree; nothing reads it for an open pack (credits_for_amount
-- returns early for a fixed rung only, and the UI branches on is_open_ended),
-- but a stale figure there is a trap for whoever next writes a screen that does.
update public.credit_packs
set price_inr = 3000, credits = 9000, credit_percent = 300, sort_order = 40
where is_open_ended and is_active and price_inr = 2000 and credit_percent = 300;

-- Any other rung comes off the panel, on the same "only if nothing bought it"
-- rule the plans use. No row matches live; this is here so a pack added in the
-- console between deploys does not quietly stay on sale.
update public.credit_packs
set is_active = false
where is_active
  and name not in ('Small', 'Starter', 'Standard', 'Plus', 'Any amount')
  and not exists (select 1 from public.payments pay where pay.pack_id = credit_packs.id);


-- ---------------------------------------------------------------------------
-- 4 · The overview says whether the plan is a trial
-- ---------------------------------------------------------------------------
-- Rebuilt from 0017's copy, which is what is live - checked with
-- pg_get_viewdef before writing this, not assumed from the newest file that
-- mentions the view. ONE column is appended and nothing else moves.
--
-- Why the view and not a lookup at the call site: a lapsed trial is now the one
-- account state where manual search is refused, and blockedReason() has to be
-- able to say so BEFORE the officer taps rather than after. officer_overview is
-- already "profile + plan + limits + usage" and every screen reads it once per
-- request, so a plan fact the portal needs belongs in it. plan_name is the only
-- other route and it is a name the admin may edit.
--
-- Appended rather than inserted, because create or replace view demands the
-- existing columns unchanged and in order. security_invoker stays on: 0025
-- relies on these views running as the caller.
create or replace view public.officer_overview with (security_invoker = on) as
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
  ev.last_event_at,
  -- False when there is no plan at all, so a caller may treat this as "is this
  -- account's access a trial" without also testing plan_id. Paired with
  -- plan_active above: trial AND not active is the one state where the wallet
  -- is frozen, and it is the only state in the product where that is true.
  coalesce(pl.is_trial, false) as plan_is_trial
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

comment on view public.officer_overview is
  'One row per account: profile, plan, effective limits and usage. plan_active is the gate on automatic checking; plan_is_trial with plan_active false is the one state in which the wallet itself is frozen.';


-- ---------------------------------------------------------------------------
-- 5 · spend_credits learns that a trial ends
-- ---------------------------------------------------------------------------
-- Rebuilt from the LIVE definition (pg_get_functiondef, confirmed identical to
-- 0038's file copy - no console drift). Same signature, same returned keys plus
-- one new refusal reason, so the worker, runManualLookup() and every caller in
-- between see what they saw.
--
-- ONE rule is added and nothing else changes:
--
--   A LAPSED FREE TRIAL REFUSES EVERYTHING, unless the account has paid.
--
-- Why it belongs here rather than in blockedReason(). This is the single gate
-- both halves of the product pass through - the portal's manual search and the
-- worker's automatic check - so one test covers both, and it cannot be argued
-- with by anybody who can reach a Server Action. blockedReason() gets the same
-- rule in the same commit, but as a SCREEN: it exists so the refusal is on the
-- page before the tap, and it is not what enforces it.
--
-- Why the paid escape, restated at the code because it is the part that looks
-- like a loophole and is not: /portal/plan#topup is open to lapsed accounts on
-- purpose, so somebody whose trial ended can buy credits. Freezing credits they
-- have just paid for would be taking their money. `has paid` is the same
-- predicate start_free_trial() uses, so the schema has one answer to "has this
-- account ever paid" rather than two.
--
-- Why the zero-rate branch survives untouched: the rate is a row an admin edits
-- without a deploy, 0 still has to mean "included in the plan", and section 1
-- above only changes which value is in force. A rate of 1 now falls straight
-- past it and charges normally, which is the whole point of the reversal.
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
  v_plan    uuid;
  v_expires date;
  v_rate    numeric(10, 2);
  v_cost    numeric(12, 2);
  v_balance numeric(12, 2);
begin
  -- Three columns off one row rather than the one 0038 read. The plan and its
  -- end date are wanted by the trial test below, and reading them here costs
  -- nothing extra - it is the same row lookup, two more columns.
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
   * The trial has ended, so everything has ended.
   *
   * Above the free branch on purpose: "only free trial expire all" means a
   * dead trial cannot do a free action either, and putting this test second
   * would let a zero-rated action through on an expired trial.
   *
   * The date test is FIRST in the and-chain and plpgsql short-circuits, so an
   * account with a live plan or a null expiry - which is every paid customer
   * on the system today - never runs either subquery. The two of them only
   * execute for an account whose plan end date is already in the past, which
   * is the rare path.
   *
   * A paid plan that has lapsed falls straight through this and goes on
   * spending. That is the owner's rule and it is the important half: credits
   * are bought outright, they never expire, and a lapsed subscription stops
   * automatic checking (the worker's own filter) and nothing else.
   */
  if v_plan is not null
     and v_expires is not null
     and v_expires < public.ist_today()
     and exists (select 1 from public.plans where id = v_plan and is_trial)
     and not exists (
       select 1 from public.payments where user_id = p_user and status = 'paid'
     )
  then
    select credits into v_balance from public.profiles where id = p_user;
    return jsonb_build_object(
      'allowed', false, 'reason', 'trial_ended',
      'balance', v_balance, 'cost', 0);
  end if;

  /*
   * Included in the plan: allowed, costs nothing, changes no balance and
   * writes no ledger row. DORMANT as of 0041 - both rates are 1 - and kept
   * because the rate is the admin's, editable on the rate screen without a
   * deploy, and this is the only place that gives a zero any meaning.
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
end $fn$;

comment on function public.spend_credits(uuid, text, integer, text) is
  'Debits one action against the wallet, atomically. Refuses everything on a lapsed FREE TRIAL that has never paid - the trial''s credits end with it. A lapsed paid plan is not refused: credits never expire and only automatic checking stops. A credit_rates rate of zero or less still means included in the plan: allowed, charged nothing, no ledger row.';

-- The sweep 0025 applies to every security-definer function. Recreating one
-- resets its privileges to the schema default, and Supabase's default hands
-- anon and authenticated an EXECUTE grant - so a bare revoke from public would
-- leave a signed-in customer able to spend somebody else's balance. This repo
-- has been bitten by exactly that twice.
revoke all on function public.spend_credits(uuid, text, integer, text) from public;
revoke all on function public.spend_credits(uuid, text, integer, text) from anon, authenticated;
grant execute on function public.spend_credits(uuid, text, integer, text) to service_role;


-- ---------------------------------------------------------------------------
-- 6 · A note on the default plan, which is dead and should stay dead
-- ---------------------------------------------------------------------------
-- Checked while working out who holds what, and worth writing down because the
-- next person to see this setting will assume it does something.
--
-- app_settings.default_plan_name still says 'Basic' - a name 0035 renamed and
-- 0038 retired. NOTHING READS IT. Its only reader was assign_default_plan(), a
-- BEFORE INSERT trigger on profiles from 0008, and 0010 dropped both the
-- trigger and the function on purpose: "it is wrong now that anyone can sign
-- up, because it would give the plan away for free". Confirmed against the live
-- database - no such function, no such trigger.
--
-- So a new account arrives with no plan and no credits, and gets one of three
-- ways: the trial button (start_free_trial, the only path that writes an expiry
-- date and a claim row), a payment (settle_payment), or an admin assigning one
-- by hand. That is correct for the reversal above - a plan handed over by a
-- trigger would have a NULL expiry, which is the schema's word for never - so
-- this file changes none of it and only records that the setting is inert.
