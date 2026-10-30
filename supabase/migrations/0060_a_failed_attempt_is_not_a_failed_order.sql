-- 0060: a payment marked failed can still be paid.
--
-- THE BUG. Razorpay's checkout fires payment.failed for every failed ATTEMPT,
-- not for the order. The window stays open, the buyer retries (or the UPI app
-- answers late), and the next attempt on the SAME order is captured. But the
-- first attempt had already closed the row as 'failed' - through the browser
-- (reportCheckoutFailure) or the payment.failed webhook - and settle_payment()
-- only matched 'created'. So the webhook for the captured payment answered
-- "not_pending", the money sat in Razorpay, and the customer saw "failed".
--
-- Seen live: order_ToraMaKe0jgSW9 (17 Oct, attempt 1 timed out, attempt 2
-- captured ten minutes later, fixed by hand four days on) and
-- order_TtpWTcfF1nDX27 (29 Oct, UPI "delay in response" reported to the
-- browser, the same payment then captured).
--
-- THE FIX. settle_payment() settles a 'failed' row as well. Nothing calls it
-- without proof of capture - a signed webhook, a verified checkout signature,
-- or the reconcile sweep that asked Razorpay itself - so widening the match
-- cannot hand out anything that was not paid for. 'paid' is still excluded,
-- which is what keeps a settlement to exactly once. settle_coupon(.., true)
-- already re-applies a hold that the failure released.

CREATE OR REPLACE FUNCTION public.settle_payment(p_order_id text, p_payment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  /*
   * 'failed' is settled too, not only 'created'. See the header of 0060:
   * a failed ATTEMPT closes the row, but Razorpay lets the buyer retry on the
   * same order and a UPI "timeout" can still complete, so money can arrive on
   * a row we already called failed. Captured money is the authority; the
   * failure was only ever our guess.
   */
  update public.payments
  set status = 'paid',
      razorpay_payment_id = p_payment_id,
      paid_at = now(),
      failure_reason = null
  where razorpay_order_id = p_order_id
    and status in ('created', 'failed')
  returning id, user_id, credits, amount_inr, kind, plan_id, months, topup_credits
  into v_id, v_user, v_credits, v_amount, v_kind, v_plan, v_months, v_topup;

  /*
   * Nothing moved to 'paid', so this payment was settled
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
