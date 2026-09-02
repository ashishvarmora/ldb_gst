-- ===========================================================================
-- Closing the last cheap way to manufacture credits.
--
-- A referral pays out on the referred person's FIRST PAYMENT, which is the
-- right rule: sign-ups are free to manufacture, payments are not. But "a
-- payment" has meant any payment at all, of any size, and the platform sells
-- coupons. A 90%-off code turns a 500-rupee pack into a 50-rupee one; a
-- deeper one turns it into small change.
--
-- So the arithmetic that was available to anybody with an email address:
--
--   register five throwaway accounts under your own referral code, buy the
--   cheapest thing on the price list on each with the loudest coupon running,
--   and collect five percentage rewards plus the milestone bonus - which is
--   500 credits by default - for a few rupees of real spend.
--
-- referral_min_payment is the floor. A payment below it settles completely
-- normally - the credits are granted, the plan is assigned - but it earns the
-- referrer nothing, and crucially it leaves the referral at 'pending' rather
-- than closing it. Somebody who genuinely starts with a small top-up and buys
-- properly a month later still earns their inviter the reward, on the real
-- payment. Only the manufactured version stops working.
--
-- The default is 0, which is exactly today's behaviour. Nothing changes for
-- anybody until an administrator sets a floor on the Rewards screen, because
-- silently withholding a reward somebody has already been promised is its own
-- kind of wrong.
--
-- The amount tested is amount_inr - what was actually charged, after the
-- discount. Testing the list price would let the coupon back in through the
-- front door, which is the whole hole being closed.
--
-- Run after 0025_security_hardening.sql.
-- ===========================================================================

insert into public.app_settings (key, value)
values ('referral_min_payment', '0'::jsonb)
on conflict (key) do nothing;

create or replace function public.reward_referral(p_user uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_referrer  uuid;
  v_percent   numeric;
  v_reward    numeric(12, 2);
  v_need      integer;
  v_bonus     numeric;
  v_minimum   numeric;
  v_qualified integer;
  v_paid      boolean;
  v_lock      uuid;
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

  /*
   * The floor, checked before anything is granted and before the referral is
   * closed. Returning early leaves the row at 'pending' on purpose: this
   * payment did not qualify, but the next one still can, so an honest customer
   * who happened to start small does not cost their inviter the reward.
   */
  select coalesce((value #>> '{}')::numeric, 0) into v_minimum
  from public.app_settings where key = 'referral_min_payment';

  if coalesce(v_minimum, 0) > 0 and coalesce(p_amount, 0) < v_minimum then
    return jsonb_build_object(
      'ok', true, 'rewarded', false, 'reason', 'below_minimum',
      'minimum', v_minimum, 'amount', p_amount);
  end if;

  /*
   * Everything below is about the referrer rather than about this one referral,
   * so this is where the transactions have to queue. Taken before the reward is
   * granted, not just before the milestone check, so that the count and the
   * "has it been paid" test below cannot straddle another transaction's commit.
   */
  select id into v_lock from public.profiles where id = v_referrer for update;

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
      /*
       * The unique index added in 0025 is the backstop, and it is caught rather
       * than allowed to propagate. A duplicate here means the bonus has already
       * been paid, which is not a reason to fail the payment that was being
       * settled - somebody's credits would go missing over a bonus they already
       * had.
       */
      begin
        perform public.grant_credits(
          v_referrer, v_bonus, 'referral_milestone', null,
          format('Milestone bonus for %s paid referrals', v_qualified));
      exception when unique_violation then
        null;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'rewarded', true, 'referrer', v_referrer, 'credits', v_reward);
end $fn$;

-- Same treatment as everything else in 0025: PUBLIC is not anon, and not
-- authenticated. Only the service role, and the settle path that runs as
-- definer, may reward anybody.
revoke all on function public.reward_referral(uuid, numeric) from public;
revoke all on function public.reward_referral(uuid, numeric) from anon, authenticated;
grant execute on function public.reward_referral(uuid, numeric) to service_role;
