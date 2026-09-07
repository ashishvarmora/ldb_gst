-- ===========================================================================
-- The price is the price of the PLAN, and the term is stated in months.
--
-- ---------------------------------------------------------------------------
-- 1 · WHAT IS ACTUALLY WRONG, AND WHAT IS NOT
--
-- The owner, in their own words:
--
--     "see here price per month or etc dont want - price per plan, and plan
--      expire after X month from start"
--
-- Nobody has ever been overcharged. plans.price_per_month has held the price of
-- the WHOLE plan since 0038, duration_months has been 1 on every paid row since
-- the same file, and pricePlan()'s price_per_month x duration_months therefore
-- charged Rs 999 once for ninety days rather than three times. The money is
-- right. THE NAME IS A LIE, and everything downstream of the name repeats it:
--
--   * the pricing page and the landing page printed "a month" under a figure
--     that buys three;
--   * the plan cards in the portal said "Runs for 1 month from the day you buy
--     it" on a 90-day plan, because they read duration_months;
--   * the offline receipt form offered a "Months" box that multiplied nothing;
--   * and the Razorpay order description had already been caught saying
--     "1 month" for a ninety-day plan once, in 0041's checkout comment.
--
-- So this file does not change a single charge. It renames the concept, and it
-- removes the multiplier that made the wrong name necessary.
--
-- ---------------------------------------------------------------------------
-- 2 · price_inr IS THE PRICE, AND THE OLD NAME BECOMES A MIRROR
--
-- price_inr is added and backfilled from price_per_month, which on this
-- database is a straight copy: measured before writing this file, every row has
-- duration_months = 1 except the two retired 0035 rows (Basic, Unlimited), and
-- those carry duration_months 12 against a duration_days of 30 - so 0038's
-- split had ALREADY made them charge a year's money for a month's access. They
-- are inactive, holderless and have never been paid for (verified live: 0 rows
-- in payments, 0 holders on every plan), so backfilling them from the price
-- rather than from the multiplication corrects that contradiction instead of
-- preserving it. Nobody's receipt moves, because there are no receipts.
--
-- price_per_month is KEPT, and kept correct by a trigger, rather than dropped.
-- Two reasons, and the first is the decisive one:
--
--   a) DROPPING IT WOULD BREAK `npm run migrate`. 0002, 0035, 0038 and 0041 all
--      write plans.price_per_month by name. A dropped - or generated - column
--      makes those statements fail at parse time, whether or not their WHERE
--      clause matches anything, so the chain would stop being re-runnable. That
--      is not a price worth paying for a column name.
--   b) The deployed build still reads it. Production is being switched onto
--      this database now and the code that removes the last reader deploys
--      after this migration runs; a dropped column takes the live pricing page
--      down in between.
--
-- A trigger rather than a comment saying "please keep these in step", because
-- that is the exact bug being fixed - two columns for one number, one of them
-- stale. price_inr is the source of truth and the trigger derives the other
-- from it on every write, so they cannot disagree and the old name cannot be
-- written to. Nothing in src/ reads it any more. It can be dropped outright
-- once the earlier files stop naming it, which is a tidy-up, not a fix.
--
-- ---------------------------------------------------------------------------
-- 3 · duration_months STOPS BEING A TERM
--
-- duration_days has been THE term since 0038 and settle_payment() reads it
-- first. duration_months survived only as pricePlan()'s multiplier and as
-- settle_payment()'s fallback for a row 0038 did not convert - and the admin
-- form offered it as a picker of 1, 3, 6 or 12 months while never writing
-- duration_days at all. That is how a 90-day plan came to show "1 month" in
-- its own editor: the picker and the term were two different columns.
--
-- With the multiplier gone the column has one job left, and the same trigger
-- pins it to it: 1 when there is a term, null when there is not. It carries no
-- length any more, so it cannot contradict duration_days, and
-- settle_payment()'s months fallback becomes unreachable by construction - it
-- is only consulted when duration_days is null, and duration_months is null in
-- exactly that case. The form now sets duration_days, in days, and the wording
-- ("1 month", "3 months", "7 days") is computed from it in one helper.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · The column that says what it is
-- ---------------------------------------------------------------------------
-- Guarded on the column's absence rather than written idempotently, because the
-- backfill must run exactly once: after the trigger below exists, price_inr is
-- the source and copying the mirror back over it would be the wrong direction.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans' and column_name = 'price_inr'
  ) then
    alter table public.plans add column price_inr numeric(10, 2) not null default 0;
    update public.plans set price_inr = price_per_month;
  end if;
end $$;

comment on column public.plans.price_inr is
  'What this plan costs, in rupees, in total and ONCE. Not a rate: the checkout charges exactly this figure, and duration_days says how long it buys. price_per_month is a deprecated mirror of it.';

-- The trial is free by constraint, which is what lets start_free_trial() hand it
-- over without a payment. Re-pointed at price_inr so a violation names the
-- column an admin actually edits; price_per_month is covered by the mirror.
alter table public.plans drop constraint if exists plans_trial_is_free;
alter table public.plans
  add constraint plans_trial_is_free check (not is_trial or price_inr = 0);


-- ---------------------------------------------------------------------------
-- 2 · One number, one source, no drift
-- ---------------------------------------------------------------------------
-- Not SECURITY DEFINER and not callable in any useful way: a plpgsql function
-- returning trigger raises if invoked outside a trigger, so there is nothing
-- here for a caller to reach. The grants below are the house rule anyway -
-- service_role is the role the admin client writes plans as, and postgres is
-- the role migrations run as, so both hold EXECUTE and the trigger fires
-- whichever of them does the write.
create or replace function public.plans_derive_mirrors()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  /*
   * price_per_month is the old name for price_inr and nothing more. Assigned
   * rather than checked, so a write that names only the deprecated column is
   * corrected instead of refused - a console edit typed into the wrong box
   * should not be able to leave two different prices on one row.
   */
  new.price_per_month := new.price_inr;

  /*
   * duration_months is no longer a length. 1 means "charged once", which is now
   * the only way anything is charged, and null means no expiry - the one state
   * settle_payment() still consults it for, where duration_days is null too and
   * both agree there is no end date.
   *
   * Deriving it from duration_days rather than trusting it is what makes the
   * two impossible to contradict: there is no value an admin, a form or a
   * console can put here that disagrees with the term.
   */
  new.duration_months := case when new.duration_days is null then null else 1 end;

  return new;
end $$;

comment on function public.plans_derive_mirrors() is
  'Keeps plans.price_per_month equal to price_inr and pins duration_months to 1-or-null from duration_days. Both are legacy names kept for readers that have not been rewritten; this is what stops them drifting.';

revoke all on function public.plans_derive_mirrors() from public;
revoke all on function public.plans_derive_mirrors() from anon, authenticated;
grant execute on function public.plans_derive_mirrors() to service_role;
grant execute on function public.plans_derive_mirrors() to postgres;

drop trigger if exists plans_derive_mirrors on public.plans;
create trigger plans_derive_mirrors
  before insert or update on public.plans
  for each row execute function public.plans_derive_mirrors();

-- Rows written before the trigger existed keep whatever they were given, so the
-- two derived columns are re-derived once, here. Only the two retired 0035 rows
-- move: Basic and Unlimited go from duration_months 12 to 1, which changes
-- nothing about them - both are inactive, neither has a holder, and 90-day Base
-- and Professional were already reading their term off duration_days.
update public.plans
set duration_months = case when duration_days is null then null else 1 end,
    price_per_month = price_inr
where duration_months is distinct from (case when duration_days is null then null else 1 end)
   or price_per_month is distinct from price_inr;

comment on column public.plans.price_per_month is
  'DEPRECATED - a mirror of price_inr, maintained by the plans_derive_mirrors trigger. It never held a monthly price: since 0038 it was the whole price of the plan under a name that said otherwise, which is the bug 0042 fixes. Write price_inr. Kept only because 0002, 0035, 0038 and 0041 name this column, so dropping it would stop the migration chain re-running, and because the build deployed when 0042 landed still read it.';

comment on column public.plans.duration_months is
  'NOT a length - derived, and pinned to 1 whenever duration_days is set and null when it is not. Nothing multiplies by it any more: the checkout charges price_inr once. It survives only as settle_payment()''s no-expiry fallback, which the derivation makes agree with duration_days by construction. Read duration_days for the term.';

comment on column public.plans.duration_days is
  'How many days access lasts once bought, counted from the purchase date - THE term, and the only one. settle_payment() adds it. Null means no expiry (the trial carries trial_days instead). 30 and 90 are sold as "1 month" and "3 months"; planTermLabel() in src/lib/credits.ts is the single place that wording is computed.';

comment on column public.payments.months is
  'Historical. It was the multiplier pricePlan() charged price_per_month by; since 0042 the checkout charges the plan price once and posts 1 here always. Never the length of anything - settle_payment() has read the plan''s own duration_days since 0038.';


-- ---------------------------------------------------------------------------
-- 3 · The overview learns the new name
-- ---------------------------------------------------------------------------
-- Read live with pg_get_viewdef before writing this, and confirmed identical to
-- 0041's file copy - no console drift. ONE column is appended and nothing else
-- moves, because create or replace view demands the existing columns unchanged
-- and in order; price_per_month therefore stays in the view beside it, which is
-- what keeps the build deployed at the moment this migration ran working.
-- security_invoker stays on: 0025 relies on these views running as the caller.
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
  coalesce(pl.is_trial, false) as plan_is_trial,
  -- Appended for 0042. The same figure as price_per_month above, under the name
  -- that describes it: the whole price of the plan, charged once. Both screens
  -- that print a customer's plan price read this one.
  pl.price_inr
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
  'One row per account: profile, plan, effective limits and usage. plan_active is the gate on automatic checking; plan_is_trial with plan_active false is the one state in which the wallet itself is frozen. price_inr is the plan''s whole price; price_per_month beside it is the deprecated mirror.';


-- ---------------------------------------------------------------------------
-- 4 · settle_payment stops describing arithmetic that no longer exists
-- ---------------------------------------------------------------------------
-- Rebuilt from the LIVE definition (pg_get_functiondef, read before writing
-- this file rather than copied from 0038's or 0041's version). NOT ONE
-- STATEMENT CHANGES - the only edit is the comment above the v_months note,
-- which described `price_per_month x months` as the sum being charged. Nothing
-- multiplies now, so that sentence would send the next reader looking for a
-- multiplier that had been deleted.
--
-- It is recreated rather than left alone because that comment is the last thing
-- in the database that explains the old name as if it were current, and this is
-- the file that removes the name. The behaviour is unchanged and was proved so:
-- the definitions were diffed with comments stripped before this was pushed.
create or replace function public.settle_payment(p_order_id text, p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

    -- v_months is deliberately not read here. It is a historical record of what
    -- the payment row was stamped with and has multiplied nothing since 0042 -
    -- the plan price is charged once - while the plan row is the authority on
    -- when access ends. Reading both would be two answers to one question.
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
end $function$;

-- Supabase's default grant on a function in public reopens this to anon and
-- authenticated the moment it is created, which has bitten this repo three
-- times. create or replace preserves the ACL, but the revoke is written out
-- anyway so a future rewrite that drops and recreates cannot inherit the hole.
revoke all on function public.settle_payment(text, text) from public;
revoke all on function public.settle_payment(text, text) from anon, authenticated;
grant execute on function public.settle_payment(text, text) to service_role;
