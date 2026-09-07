-- ===========================================================================
-- Referrals pay a PERCENTAGE of the payment again - on both events.
--
-- 0040 replaced 0037's percentages with four fixed credit amounts (50/50 on a
-- plan, 100/150 on a top-up). The owner has reversed that. Their words:
--
--   ram refers shyam. Shyam buys a 999 rupee plan: X=20% -> 200 credits to
--   RAM, Y=10% -> 100 credits to SHYAM. Shyam's first 3000 rupee top-up:
--   20% -> 600 to RAM, 10% -> 300 to SHYAM.
--
-- So the TWO EVENTS survive intact - the invitee's first plan and their first
-- top-up, each paying once per referral, ever - and only the arithmetic
-- changes: X per cent of the payment to the inviter, Y per cent to the person
-- invited, on each of them. Defaults X = 20, Y = 10, both admin-editable.
--
-- The two-event plumbing 0040 added is REUSED as it stands. plan_rewarded_at
-- and topup_rewarded_at are still the once-each gate, the four amount columns
-- still record what each event paid whom, and referral_claim_detail is not
-- touched. This migration changes one thing: where the numbers come from.
--
-- WHY ROUND AND NOT FLOOR. 0037 floored, and credits_for_amount() floors, both
-- on the same honest principle - never hand over a fraction of a credit nobody
-- paid for. Flooring here would make the owner's own worked example wrong:
-- 20% of 999 is 199.8, and the number they quote, print on the page and expect
-- to see in the ledger is 200. Twenty paise of credit is not worth a scheme
-- whose advertised example does not add up, so this rounds to the nearest
-- whole credit. The floor stays where it belongs - on credits somebody buys.
--
-- WHY credits_per_rupee IS NOT IN THIS SUM. It reads like the platform's
-- rupees-to-credits rate and it is not: credits_for_amount() is the only thing
-- that touches it, and only for an OPEN-ENDED credit pack, where the buyer
-- names their own amount. Fixed packs carry their own credits column and a
-- plan carries its own included_credits. Multiplying it in here would mean two
-- settings control one payout, and the day somebody re-prices the open tier
-- every referral reward would move with it - silently, and for a reason
-- nobody would connect to referrals. So a percentage of the RUPEES is taken as
-- credits directly, which is 0037's arithmetic and, at the live rate of 1,
-- exactly the owner's example.
--
-- WHAT A COMBINED PAYMENT PAYS, which is the one case their example does not
-- cover. 0036 made one payment able to be both: a kind='plan' row carrying
-- topup_credits is the "plan plus credits in one checkout" the owner asked
-- for, and it closes BOTH events in a single call.
--
--   The payment is charged ONCE. Each side is paid its percentage of that
--   payment, both events are stamped, and the plan event's pair of
--   percentages is the pair applied.
--
-- Two reasons, and the first is arithmetic. A percentage is linear, so X% of
-- the plan share plus X% of the top-up share IS X% of the whole payment -
-- buying a plan and a top-up together therefore pays a referrer exactly what
-- buying them a fortnight apart would have paid, which is the only outcome
-- that leaves nobody with a reason to game the checkout. Paying each event its
-- own percentage of the whole instead would hand over 2X% of one payment -
-- 1,600 credits on the owner's 3,999 rupee basket against 800 for the same
-- money bought in two goes - and a bundle discount that pays the referrer
-- double is a bug wearing a promotion's clothes.
--
-- The second reason is that the rupee split is not knowable here. The row
-- records amount_inr for the whole basket and topup_credits for the top-up
-- half; the top-up's RUPEE share lives only in the Razorpay notes, and any
-- coupon came off whichever half it named. Reconstructing it from today's
-- plans.price_inr would be a second, wrong answer to a question the total does
-- not need asked.
--
-- The plan pair rather than the top-up pair because the plan event is the one
-- the invite converted on, and because the payment's own kind is 'plan' - the
-- top-up rode along on it. With both pairs at 20/10 by default the choice is
-- invisible; it only shows if an admin deliberately prices the two events
-- apart, and then it is written down here.
--
-- WHY THE EVENT IS STILL DERIVED FROM THE PAYMENTS TABLE. 0040's reasoning,
-- unchanged and worth restating: a kind-shaped third argument would pay the
-- plan event and silently skip the top-up event on the one order most likely
-- to trigger both. reward_referral(uuid, numeric) keeps its exact signature,
-- settle_payment() is not touched, and this file does not restate a line of
-- someone else's plan-term logic.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · Four percentages replace four fixed amounts
-- ---------------------------------------------------------------------------
-- Named referral_<event>_<side>_percent, all four the same shape, so the pair
-- for an event sorts together in app_settings and the suffix says what the
-- number means. referral_percent and referral_invitee_percent - 0037's
-- single-event pair - are deliberately left alone: loadSettings still reads
-- them into a typed object owned elsewhere, and nothing computes a reward from
-- them.
insert into public.app_settings (key, value) values
  ('referral_plan_referrer_percent',  '20'::jsonb),
  ('referral_plan_invitee_percent',   '10'::jsonb),
  ('referral_topup_referrer_percent', '20'::jsonb),
  ('referral_topup_invitee_percent',  '10'::jsonb)
on conflict (key) do nothing;

/*
 * 0040's four rows go, rather than being left behind the way 0037's
 * percentages were.
 *
 * Those were kept because a settings loader owned by another feature still
 * reads them, and a loader that finds a key missing is a bigger blast radius
 * than a row nobody reads. These four have no such reader - only the referral
 * screens ever looked at them, and every one of those now reads the _percent
 * keys. What is left if they stay is four rows called ..._credits holding
 * 50/50/100/150 sitting beside four called ..._percent holding 20/10/20/10,
 * which is an invitation to edit the wrong one.
 *
 * Their VALUES are not migrated, because there is no honest conversion: 50 was
 * a number of credits, and 50 per cent of a payment is a different offer by an
 * order of magnitude. The new rows carry the owner's defaults instead.
 */
delete from public.app_settings
where key in ('referral_plan_referrer_credits',
              'referral_plan_invitee_credits',
              'referral_topup_referrer_credits',
              'referral_topup_invitee_credits');


-- ---------------------------------------------------------------------------
-- 2 · What the amount columns now hold
-- ---------------------------------------------------------------------------
-- The columns themselves are 0040's and are not altered. Only what they mean
-- has moved, so only the comments do - and they now name the schemes by
-- migration number rather than by "the percentage scheme", which as of this
-- file describes two different things.
comment on column public.referrals.plan_referrer_credits is
  'Credits the referrer got for the plan event, a percentage of the payment that closed it. Null on referrals settled before 0040, where the split between the two events is not knowable.';
comment on column public.referrals.plan_invitee_credits is
  'Credits the invitee got for the plan event. Carries the whole payout when one payment closed both events - see 0043.';
comment on column public.referrals.topup_referrer_credits is
  'Credits the referrer got for the first-top-up event. 0 when a combined payment closed this event alongside the plan event, which is charged once.';
comment on column public.referrals.topup_invitee_credits is
  'Credits the invitee got for the first-top-up event. 0 when a combined payment closed it alongside the plan event.';


-- ---------------------------------------------------------------------------
-- 3 · Both events, one qualifying rule, one base per payment
-- ---------------------------------------------------------------------------
-- Same signature as 0040's and 0037's, so settle_payment's call site is
-- untouched.
create or replace function public.reward_referral(p_user uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_row       public.referrals%rowtype;
  v_referrer  uuid;
  v_minimum   numeric;
  v_has_plan  boolean;
  v_has_topup boolean;
  v_pay_plan  boolean;
  v_pay_topup boolean;
  v_ref_pct   numeric;
  v_inv_pct   numeric;
  v_referrer_total numeric(12, 2);
  v_invitee_total  numeric(12, 2);
  -- How the one payout is attributed across the two event columns. Both pairs
  -- start at nought and exactly one pair is filled - see the assignment below.
  v_plan_ref  numeric(12, 2) := 0;
  v_plan_inv  numeric(12, 2) := 0;
  v_top_ref   numeric(12, 2) := 0;
  v_top_inv   numeric(12, 2) := 0;
  v_what      text;
  v_shown     numeric;
  v_need      integer;
  v_bonus     numeric;
  v_qualified integer;
  v_paid      boolean;
  v_lock      uuid;
begin
  if coalesce((select (value #>> '{}')::boolean from public.app_settings
               where key = 'referral_enabled'), true) is not true then
    return jsonb_build_object('ok', true, 'rewarded', false, 'reason', 'disabled');
  end if;

  /*
   * The referral, locked while there is anything left to pay on it. The test
   * is the two timestamps rather than status = 'pending': after the plan event
   * pays, the row is 'rewarded' and still owes the top-up event, and a status
   * test would have stopped looking at it.
   */
  select * into v_row
  from public.referrals
  where referred_id = p_user
    and (plan_rewarded_at is null or topup_rewarded_at is null)
  for update;

  if v_row.id is null then
    return jsonb_build_object('ok', true, 'rewarded', false, 'reason', 'no_pending_referral');
  end if;
  v_referrer := v_row.referrer_id;

  /*
   * The floor, checked before anything is granted. Returning early records
   * nothing on purpose: this payment did not qualify, but a later one still
   * can, so an honest customer who happened to start small does not cost their
   * inviter the reward. One floor gates both events and both sides - a second
   * qualifying rule is how the two sides end up disagreeing about whether a
   * referral happened.
   */
  select coalesce((value #>> '{}')::numeric, 0) into v_minimum
  from public.app_settings where key = 'referral_min_payment';

  if coalesce(v_minimum, 0) > 0 and coalesce(p_amount, 0) < v_minimum then
    return jsonb_build_object(
      'ok', true, 'rewarded', false, 'reason', 'below_minimum',
      'minimum', v_minimum, 'amount', p_amount);
  end if;

  /*
   * What this account has now bought, read off the payments table rather than
   * off an argument - see this file's header. settle_payment has already moved
   * the payment being settled to 'paid' in this transaction, so it counts.
   *
   * A top-up is a credits payment OR the topup_credits half of a combined plan
   * payment (0036). coalesce on kind because the column carries no check
   * constraint and a null there must not read as "not a plan" by accident on
   * one branch and "is a top-up" on the other.
   */
  select
    exists (select 1 from public.payments
            where user_id = p_user and status = 'paid'
              and coalesce(kind, 'credits') = 'plan'),
    exists (select 1 from public.payments
            where user_id = p_user and status = 'paid'
              and (coalesce(kind, 'credits') <> 'plan'
                   or coalesce(topup_credits, 0) > 0))
  into v_has_plan, v_has_topup;

  v_pay_plan  := v_has_plan  and v_row.plan_rewarded_at  is null;
  v_pay_topup := v_has_topup and v_row.topup_rewarded_at is null;

  -- Nothing this payment completes. A plan-only account topping up nothing, a
  -- second plan, or a second top-up after the first already paid.
  if not v_pay_plan and not v_pay_topup then
    return jsonb_build_object(
      'ok', true, 'rewarded', false, 'reason', 'nothing_new_to_reward',
      'plan_done', v_row.plan_rewarded_at is not null,
      'topup_done', v_row.topup_rewarded_at is not null);
  end if;

  /*
   * Everything below is about the REFERRER rather than about this one
   * referral, so this is where transactions have to queue. Taken before any
   * grant, not just before the milestone check, so the count and the
   * has-it-been-paid test cannot straddle another transaction's commit.
   */
  select id into v_lock from public.profiles where id = v_referrer for update;

  /*
   * ONE PAIR OF PERCENTAGES, ONE BASE. The payment is charged once however
   * many events it closes - the header says why at length. The plan pair wins
   * a combined payment because the plan event is the one the invite converted
   * on and the payment's own kind is 'plan'; with both pairs at 20/10 the
   * choice is invisible, and an admin who prices the two events apart gets the
   * rule written down here.
   */
  if v_pay_plan then
    select coalesce((value #>> '{}')::numeric, 0) into v_ref_pct
    from public.app_settings where key = 'referral_plan_referrer_percent';
    select coalesce((value #>> '{}')::numeric, 0) into v_inv_pct
    from public.app_settings where key = 'referral_plan_invitee_percent';
  else
    select coalesce((value #>> '{}')::numeric, 0) into v_ref_pct
    from public.app_settings where key = 'referral_topup_referrer_percent';
    select coalesce((value #>> '{}')::numeric, 0) into v_inv_pct
    from public.app_settings where key = 'referral_topup_invitee_percent';
  end if;

  -- Nearest whole credit, not floored. See the header: 20% of 999 has to be
  -- the 200 the owner quotes, or the scheme's own worked example is a lie.
  v_referrer_total := round(coalesce(p_amount, 0) * coalesce(v_ref_pct, 0) / 100);
  v_invitee_total  := round(coalesce(p_amount, 0) * coalesce(v_inv_pct, 0) / 100);

  /*
   * Which event columns the payout lands in. Exactly one pair is filled: on a
   * combined payment the whole payout is attributed to the plan event and the
   * top-up event closes at nought, because the same rupees cannot be paid for
   * twice. A nought there means "closed by a payment already counted", not
   * "this event was worth nothing" - which is why the column comments say so.
   */
  if v_pay_plan then
    v_plan_ref := v_referrer_total;
    v_plan_inv := v_invitee_total;
  else
    v_top_ref := v_referrer_total;
    v_top_inv := v_invitee_total;
  end if;

  /*
   * The row is stamped BEFORE the grants, and stamped even when the amount is
   * nought. The timestamp is the once-each gate, so an event whose percentage
   * is 0 must still close - otherwise setting a percentage to 0 turns that
   * event into one that fires for ever, paying nothing until the day somebody
   * raises the setting and every old referral pays out at once.
   *
   * rewarded_at and first_amount are set once, by whichever event landed
   * first, so days_to_reward keeps meaning "how long until this referral was
   * worth something".
   */
  update public.referrals
  set status = 'rewarded',
      plan_rewarded_at  = case when v_pay_plan  then now() else plan_rewarded_at end,
      topup_rewarded_at = case when v_pay_topup then now() else topup_rewarded_at end,
      plan_referrer_credits  = case when v_pay_plan  then v_plan_ref else plan_referrer_credits end,
      plan_invitee_credits   = case when v_pay_plan  then v_plan_inv else plan_invitee_credits end,
      topup_referrer_credits = case when v_pay_topup then v_top_ref  else topup_referrer_credits end,
      topup_invitee_credits  = case when v_pay_topup then v_top_inv  else topup_invitee_credits end,
      reward_credits  = coalesce(reward_credits, 0)  + v_referrer_total,
      welcome_credits = coalesce(welcome_credits, 0) + v_invitee_total,
      first_amount = coalesce(first_amount, p_amount),
      rewarded_at  = coalesce(rewarded_at, now())
  where id = v_row.id;

  /*
   * ONE ledger row per side, not one per event, because there is now one
   * payout per payment rather than two fixed amounts that happened to arrive
   * together. What it was for is said in words instead, so the customer's
   * activity feed still explains a combined payment.
   *
   * trim_scale so a 999.00 rupee payment reads as 999. The reasons are 0037's
   * - 'referral' for the inviter, 'referral_welcome' for the invited -
   * because credit_source() already classifies both as free and a new reason
   * would land every reward in its "other" bucket until somebody remembered to
   * add it there.
   */
  v_what := case
    when v_pay_plan and v_pay_topup then 'first plan and top-up'
    when v_pay_plan then 'first plan'
    else 'first top-up'
  end;
  v_shown := trim_scale(coalesce(p_amount, 0));

  if v_referrer_total > 0 then
    perform public.grant_credits(
      v_referrer, v_referrer_total, 'referral', null,
      format('Referral reward - %s%% of the %s rupees somebody you invited paid for their %s',
             trim_scale(v_ref_pct), v_shown, v_what));
  end if;

  -- The invitee's profile row is already locked by this transaction's caller
  -- chain (settle_payment updated their payment and granted their purchase),
  -- so no second explicit lock: grant_credits' own UPDATE serialises the
  -- balance against anything else touching it.
  if v_invitee_total > 0 then
    perform public.grant_credits(
      p_user, v_invitee_total, 'referral_welcome', null,
      format('Welcome bonus - %s%% of the %s rupees you paid for your %s, because you joined on an invite',
             trim_scale(v_inv_pct), v_shown, v_what));
  end if;

  -- Milestone: paid once, the moment the count is reached. Unchanged - it
  -- counts REWARDED REFERRALS, not events, so a referral that fires both
  -- events still counts once.
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
       * The unique index added in 0025 is the backstop, and it is caught
       * rather than allowed to propagate. A duplicate here means the bonus has
       * already been paid, which is not a reason to fail the payment that was
       * being settled - somebody's credits would go missing over a bonus they
       * already had.
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
    'ok', true, 'rewarded', true, 'referrer', v_referrer,
    -- 'credits' and 'welcome_credits' keep 0037's meaning: what this CALL paid
    -- each side. The two percentages are returned alongside so a caller
    -- reading the jsonb can see which pair was applied.
    'credits', v_referrer_total,
    'welcome_credits', v_invitee_total,
    'referrer_percent', v_ref_pct,
    'invitee_percent', v_inv_pct,
    'plan_event', v_pay_plan,
    'topup_event', v_pay_topup);
end $fn$;

comment on function public.reward_referral(uuid, numeric) is
  'Pays a referral''s two events - the invitee''s first plan, and their first top-up - once each, both sides, as a percentage of the payment that closed the event and gated by referral_min_payment. Works out which event a payment completes from the payments table, so a combined plan-plus-top-up payment closes both and is charged once at the plan event''s percentages.';


-- ---------------------------------------------------------------------------
-- 4 · Who may call it. Recreating a SECURITY DEFINER function resets its
--     grants to the schema default, and Supabase's default hands anon and
--     authenticated EXECUTE - the hole 0025 swept, reopened by any migration
--     that forgets this block. Proven live three times in this repo.
-- ---------------------------------------------------------------------------
revoke all on function public.reward_referral(uuid, numeric) from public;
revoke all on function public.reward_referral(uuid, numeric) from anon, authenticated;
grant execute on function public.reward_referral(uuid, numeric) to service_role;
