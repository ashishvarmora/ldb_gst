-- ===========================================================================
-- One payment that buys the plan AND a credit top-up.
--
-- The owner's ask: "500 rupee PLAN + 1500 credit topup, so first payment
-- become 2000". The flow forces a plan first, so today a referred customer's
-- first payment is only ever the plan price, and the referral percentage is
-- computed on that small figure. Let the plan payment carry a top-up as well
-- and the referral maths fixes itself: reward_referral() already receives the
-- payment's amount_inr, so a combined first payment rewards the referrer on
-- the combined figure with no change to the referral code at all. (0037 is
-- rewriting reward_referral in parallel - this file deliberately does not
-- touch it, only keeps calling it exactly as 0035 did.)
--
-- HOW A COMBINED PAYMENT IS REPRESENTED, AND WHY THIS SHAPE
--
-- A new column, topup_credits, on payments: the credits bought ON TOP of the
-- plan, fixed at the moment the order opens. kind stays 'plan'; pack_id may
-- now name the pack the top-up was priced from.
--
-- Two shapes that were considered and refused:
--
--   * Reusing `credits` for the top-up. On every plan row that exists,
--     `credits` records the plan's INCLUDED credits - pricePlan() writes it,
--     and the receipt at /portal/payments renders it with the words "included
--     with the plan". Giving the same column a second meaning on some plan
--     rows is a dual reading per row shape, and this ledger has already been
--     bitten twice by branches over an open set (0030's 500-credit code read
--     as 500%). One column, one meaning.
--
--   * pack_id as the discriminator ("a plan payment with a pack is combined").
--     The admin's offline path has no pack - record_offline_payment() takes a
--     credit COUNT typed by hand, because a cash sale is negotiated, not
--     picked off the ladder. A discriminator only the online path can set
--     would leave the cash customer plan-only for a structural reason nobody
--     could defend at the counter.
--
-- The default of 0 is load-bearing: an order opened before this deploys and
-- settled after it reads topup_credits 0 and settles exactly as it was opened.
-- No backfill, no in-flight race.
--
-- WHAT SETTLEMENT DOES WITH IT
--
-- settle_payment() grants BOTH, as two ledger rows carrying the same
-- payment_id (0034's audit column): the plan's included credits as
-- 'plan_grant', then the top-up as 'purchase'. Two rows rather than one sum,
-- because the two figures have different sources of truth - included credits
-- are read from the PLAN ROW at settlement (the admin may have improved the
-- plan since the order opened, and the plan is the authority), while the
-- top-up is read from the PAYMENT ROW (it was priced from the ladder at order
-- time, and the ladder moving afterwards must not change what a paid order
-- delivers). One row would have to pick one source for both.
--
-- payment_credit_effect (0034) already sums rows per payment and takes
-- balance_before off the earliest row, balance_after off the latest - its
-- header says a plan purchase "can write more than one ledger line (its
-- included credits, and in future anything else bundled with it)". This is
-- that future. The returned balance pair below spans both grants the same
-- way: before from the first grant that ran, after from the last.
--
-- Run after 0035_real_prices_plan_terms_and_trial.sql, which owns the rest of
-- what settle_payment does - the plan-decides-its-term expiry logic is copied
-- from there unchanged, and that file's header explains it.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · The column
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists topup_credits numeric(12, 2) not null default 0;

comment on column public.payments.topup_credits is
  'Credits bought on top of a plan, in the same payment. Fixed when the order opens - the ladder moving later must not change what a paid order delivers. 0 on every credits-only payment and every plan-only one.';

-- kind itself has no check constraint (verified against the live catalogue
-- before writing this: payments carries method and status checks only), and
-- this file adds none - 'credits' and 'plan' are guarded where rows are made,
-- and a third kind is exactly what this design avoids: a combined payment IS
-- a plan payment, so every screen and function that branches on kind keeps
-- working without learning a new word.
comment on column public.payments.kind is
  'credits = a pack top-up. plan = buying a plan, which hands over that plan''s included credits - and, when topup_credits > 0, a credit top-up bought in the same payment.';

comment on column public.payments.pack_id is
  'The pack this payment was priced from. On a credits payment, the pack bought; on a plan payment, the pack a topup_credits figure came from - null when the top-up was typed by hand (an offline receipt) or there is none.';

-- A top-up belongs to a plan payment. On a credits payment the credits ARE the
-- purchase - a second figure would either double-grant or lie - so the column
-- is pinned to zero everywhere it has no meaning. Negative is nonsense anywhere.
alter table public.payments drop constraint if exists payments_topup_check;
alter table public.payments
  add constraint payments_topup_check
  check (topup_credits >= 0 and (kind = 'plan' or topup_credits = 0));


-- ---------------------------------------------------------------------------
-- 2 · Settlement grants both
-- ---------------------------------------------------------------------------
-- Rebuilt from 0035's version. Same signature, same returned keys plus three
-- additive ones (plan_credits, topup_credits, and a credits figure that now
-- means everything the payment granted), so the webhook and confirmCheckout
-- read what they always read. The expiry block is 0035's, unchanged.
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
   *
   * It returns the payment's id, so the caller can go and read what that
   * settlement actually delivered instead of telling the customer only that
   * their payment was "already recorded" - a sentence that is true and reads
   * exactly like "nothing happened".
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
    select included_credits, duration_months, is_trial, trial_days
    into v_plan_credits, v_term, v_trial, v_trial_days
    from public.plans where id = v_plan;

    -- v_months is deliberately not read here. It is still the record of the
    -- term that was CHARGED - price_per_month x months - and the portal posts
    -- the plan's own duration into it, so the two agree. But the plan row is
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
     * A trial row should never reach here - it is free, and pricePlan() refuses
     * a zero price - but record_offline_payment() takes any plan id an admin
     * types, and null months would then read as "no expiry". So a paid trial
     * gets the trial's own days rather than for ever.
     */
    v_expires := case
      when coalesce(v_trial, false) then v_from + coalesce(v_trial_days, 7)
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
     * same payment_id. 'purchase' rather than 'plan_grant', because that is
     * what it is - money exchanged for credits - and because the credit
     * economy report classifies 'purchase' as paid-for and 'plan_grant' as
     * part of the plan; folding the top-up into the plan's row would report
     * the giveaway and the sale as one figure.
     *
     * Read off the PAYMENT row, never re-priced: the ladder may have moved
     * between the order opening and the webhook arriving, and what was paid
     * for is what was quoted.
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
  -- v_amount is the whole charge, so a combined first payment rewards the
  -- referrer on the combined figure - which is the point of this file.
  v_referral := public.reward_referral(v_user, v_amount);

  return jsonb_build_object(
    'ok', true, 'granted', true, 'kind', coalesce(v_kind, 'credits'),
    -- Everything the payment put on the balance. confirmCheckout says "with N
    -- credits to spend", and on a combined payment N is both grants.
    'credits', case
      when v_kind = 'plan' then coalesce(v_plan_credits, 0) + coalesce(v_topup, 0)
      else v_credits
    end,
    -- The two halves, separately, for any caller that wants to itemise.
    'plan_credits', case when v_kind = 'plan' then coalesce(v_plan_credits, 0) end,
    'topup_credits', case when v_kind = 'plan' then coalesce(v_topup, 0) end,
    'user_id', v_user,
    'payment_id', v_id,
    -- Only meaningful when kind is 'plan'; on a credit top-up it is null
    -- because no expiry was touched, not because the plan has none.
    'plan_expires_on', v_expires,
    /*
     * The pair spans the WHOLE payment. Up to two grants ran above, in a fixed
     * order - plan credits, then top-up - and either may be absent (a plan can
     * include 0 credits; most payments carry no top-up). before is the first
     * grant that ran, after is the last: jsonb -> on a null jsonb is null, so
     * the coalesces pick the right ends whichever subset ran. This is the same
     * answer payment_credit_effect derives from the ledger rows.
     */
    'balance_before', coalesce(v_grant -> 'balance_before', v_topup_grant -> 'balance_before'),
    'balance_after', coalesce(v_topup_grant -> 'balance', v_grant -> 'balance'),
    'referral', v_referral);
end $fn$;

comment on function public.settle_payment(text, text) is
  'Hands over what a payment bought, exactly once. A plan payment grants the plan (term from plans.duration_months), its included credits, and - when topup_credits > 0 - the credit top-up bought in the same payment, as separate ledger rows sharing the payment_id.';

-- The sweep 0025 applies to every security-definer function. Recreating one
-- resets its privileges to the schema default and Supabase's default hands anon
-- and authenticated an EXECUTE grant, so a bare revoke from public would leave
-- a signed-in customer able to settle payments. Proven live twice in this repo.
revoke all on function public.settle_payment(text, text) from public;
revoke all on function public.settle_payment(text, text) from anon, authenticated;
grant execute on function public.settle_payment(text, text) to service_role;


-- ---------------------------------------------------------------------------
-- 3 · The offline path can sell the same thing
-- ---------------------------------------------------------------------------
-- A cash customer exists, and the whole reason record_offline_payment() routes
-- through settle_payment() is that an offline sale must do everything a
-- gateway one does. Same signature as 0024's version, so the console's action
-- keeps calling it unchanged; what is new is that p_credits now MEANS
-- something on a plan sale - the top-up sold alongside - where before it was
-- stored and ignored. There is no pack: a hand-negotiated top-up is a count
-- the admin types, which is exactly why topup_credits and not pack_id is the
-- discriminator settlement reads.
--
-- One deliberate change beside that: an offline PLAN receipt now records the
-- plan's included credits in payments.credits, the way pricePlan() does for a
-- gateway order. It used to store 0 there (the console always sent 0 for plan
-- sales), which left the receipt page unable to say what came with the plan.
-- Same meaning, both paths.
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
  v_order    text;
  v_included numeric(12, 2);
  v_result   jsonb;
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
  -- On a plan sale the credits are optional - zero is a plan-only receipt -
  -- but a negative top-up is a refund wearing the wrong form.
  if p_kind = 'plan' and coalesce(p_credits, 0) < 0 then
    return jsonb_build_object('ok', false, 'reason', 'credits_required');
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_user');
  end if;

  -- The record for the receipt: what comes with the plan, as it stands today.
  -- settle_payment() reads the plan row again itself, so this is a record
  -- rather than an instruction - the same division pricePlan() documents.
  if p_kind = 'plan' then
    select included_credits into v_included from public.plans where id = p_plan;
  end if;

  -- "off_" so it is obvious in a log that this never went near Razorpay, and
  -- a uuid so two administrators recording at the same second cannot clash.
  v_order := 'off_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.payments
    (user_id, razorpay_order_id, amount_inr, credits, topup_credits, status,
     kind, plan_id, months, method, recorded_by, note)
  values
    (p_user, v_order, p_amount,
     case when p_kind = 'plan' then coalesce(v_included, 0) else coalesce(p_credits, 0) end,
     case when p_kind = 'plan' then coalesce(p_credits, 0) else 0 end,
     'created', p_kind, p_plan, greatest(coalesce(p_months, 1), 1),
     p_method, p_actor, p_note);

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

comment on function public.record_offline_payment(uuid, numeric, text, text, numeric, uuid, integer, uuid, text, timestamptz) is
  'Writes a payment that arrived off the gateway and settles it through settle_payment(). For a plan sale, p_credits is an optional credit top-up sold in the same receipt - the offline twin of the portal''s combined checkout.';

revoke all on function public.record_offline_payment(uuid, numeric, text, text, numeric, uuid, integer, uuid, text, timestamptz) from public;
revoke all on function public.record_offline_payment(uuid, numeric, text, text, numeric, uuid, integer, uuid, text, timestamptz) from anon, authenticated;
grant execute on function public.record_offline_payment(uuid, numeric, text, text, numeric, uuid, integer, uuid, text, timestamptz) to service_role;
