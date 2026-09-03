-- ===========================================================================
-- Referrals pay FIXED credits, on TWO events, once each.
--
-- 0037 paid percentages off the invitee's first payment - one event, one
-- payout each side. The owner's ask replaces both halves of that:
--
--   Event                       Invitee gets   Referrer gets
--   ------------------------    ------------   -------------
--   Their first PLAN purchase   +50 credits    +50 credits
--   Their first TOP-UP          +150 credits   +100 credits
--
-- Two things changed at once and the second is the point. Percentages are out
-- because a percentage of a 500 rupee plan is a reward nobody can picture
-- before they earn it - "you get 50 credits" is a promise a share button can
-- carry, "you get 10% of what they spend" is a calculation. And one event
-- became two because signing up and buying the cheapest plan was the whole
-- job under the old scheme: the owner wants the invited account to SPEND, so
-- the top-up event pays more than the plan event, and pays the invitee most of
-- all. The larger number is deliberately on the side of the person who has to
-- be talked into spending again.
--
-- WHY THE EVENT IS DERIVED HERE RATHER THAN PASSED IN
--
-- The obvious shape is a third argument - settle_payment already knows the
-- payment's kind, so reward_referral(user, amount, kind). It is refused for
-- two reasons.
--
--   * 0036 made one payment able to be BOTH. A plan payment may carry
--     topup_credits, which is exactly the "500 plan + 1500 top-up" checkout
--     the owner asked for; its kind is 'plan', and a kind-shaped argument
--     would pay the plan event and silently skip the top-up event on the one
--     order most likely to trigger both. Reading the payments table answers
--     "has this account bought a plan / topped up" directly, and a combined
--     first payment correctly fires both events in one call.
--
--   * settle_payment is being rewritten this session by another migration.
--     Changing its signature or its body from here would mean restating
--     someone else's plan-term logic from a copy, and the copy is how the
--     wrong version wins. This file does not touch settle_payment at all:
--     reward_referral(uuid, numeric) keeps its exact signature, and the call
--     site is left alone.
--
-- The payment rows are visible because settle_payment marks the payment 'paid'
-- before it calls this, in the same transaction.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1 · Two events need two records of having happened
-- ---------------------------------------------------------------------------
-- status ('pending' / 'rewarded') is one bit and there are now two events, so
-- it cannot say "the plan paid, the top-up has not". It is KEPT, and keeps
-- meaning "this referral has earned something": referral_summary counts on it,
-- the milestone counts on it, and every screen reads it. The two timestamps
-- below are the real once-each gate; status is the summary of them.
alter table public.referrals
  add column if not exists plan_rewarded_at    timestamptz,
  add column if not exists topup_rewarded_at   timestamptz,
  add column if not exists plan_referrer_credits  numeric(12, 2),
  add column if not exists plan_invitee_credits   numeric(12, 2),
  add column if not exists topup_referrer_credits numeric(12, 2),
  add column if not exists topup_invitee_credits  numeric(12, 2);

comment on column public.referrals.plan_rewarded_at is
  'When the plan-purchase event paid out. Null means it has not, and is the only test that stops it paying twice.';
comment on column public.referrals.topup_rewarded_at is
  'When the first-top-up event paid out. Null means it has not.';
comment on column public.referrals.plan_referrer_credits is
  'Credits the referrer got for the plan event. Null on referrals settled under the old percentage scheme, where the split between events is not knowable.';
comment on column public.referrals.plan_invitee_credits is
  'Credits the invitee got for the plan event.';
comment on column public.referrals.topup_referrer_credits is
  'Credits the referrer got for the first-top-up event.';
comment on column public.referrals.topup_invitee_credits is
  'Credits the invitee got for the first-top-up event.';

-- reward_credits and welcome_credits stay, and stay the RUNNING TOTAL per
-- side across both events. Not left behind as the old scheme's column: the
-- referral_summary view sums reward_credits, the portal's "credits earned"
-- reads it and the admin tab totals it, and a second place to add up what a
-- referral paid is a second place for it to be wrong.
comment on column public.referrals.reward_credits is
  'Everything this referral has paid the REFERRER, across both events. The per-event columns say which event paid what.';
comment on column public.referrals.welcome_credits is
  'Everything this referral has paid the INVITEE, across both events.';

/*
 * Referrals already settled are closed on BOTH events, not just the one they
 * were paid for.
 *
 * The alternative - leave the top-up event open, since it was never offered to
 * them - reads as fairer and is a retroactive liability nobody budgeted: every
 * invitee ever rewarded would earn their referrer 100 credits and themselves
 * 150 the next time they topped up, for an invite that closed months ago. The
 * scheme changes forward. Somebody rewarded yesterday got yesterday's deal.
 *
 * The four credit columns are left NULL rather than filled in, because the
 * percentage payout cannot honestly be attributed to one of two events that
 * did not exist when it was made. Null already means "predates this" on
 * welcome_credits, and the CSV already renders that as blank rather than 0.
 */
update public.referrals
set plan_rewarded_at  = coalesce(plan_rewarded_at, rewarded_at),
    topup_rewarded_at = coalesce(topup_rewarded_at, rewarded_at)
where status = 'rewarded'
  and rewarded_at is not null
  and (plan_rewarded_at is null or topup_rewarded_at is null);


-- ---------------------------------------------------------------------------
-- 2 · The four amounts, as settings
-- ---------------------------------------------------------------------------
-- Named referral_<event>_<side>_credits, all four the same shape, so the pair
-- for an event sorts together in app_settings and nobody has to remember which
-- of "invitee" and "welcome" this scheme calls the new customer.
--
-- The old referral_percent and referral_invitee_percent rows are deliberately
-- NOT deleted. Nothing computes a reward from them any more, but loadSettings
-- still reads them into a typed object owned elsewhere, and a settings loader
-- that finds a key missing is a bigger blast radius than a row nobody reads.
-- They are simply off every form.
insert into public.app_settings (key, value) values
  ('referral_plan_referrer_credits',  '50'::jsonb),
  ('referral_plan_invitee_credits',   '50'::jsonb),
  ('referral_topup_referrer_credits', '100'::jsonb),
  ('referral_topup_invitee_credits',  '150'::jsonb)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 3 · Both events, one qualifying rule
-- ---------------------------------------------------------------------------
-- Same signature as 0037's, so settle_payment's call site is untouched.
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
  v_plan_ref  numeric(12, 2) := 0;
  v_plan_inv  numeric(12, 2) := 0;
  v_top_ref   numeric(12, 2) := 0;
  v_top_inv   numeric(12, 2) := 0;
  v_referrer_total numeric(12, 2);
  v_invitee_total  numeric(12, 2);
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

  -- Nothing this payment completes. A plan-only account topping up nothing,
  -- or a second top-up after the first already paid.
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

  if v_pay_plan then
    select coalesce((value #>> '{}')::numeric, 0) into v_plan_ref
    from public.app_settings where key = 'referral_plan_referrer_credits';
    select coalesce((value #>> '{}')::numeric, 0) into v_plan_inv
    from public.app_settings where key = 'referral_plan_invitee_credits';
  end if;

  if v_pay_topup then
    select coalesce((value #>> '{}')::numeric, 0) into v_top_ref
    from public.app_settings where key = 'referral_topup_referrer_credits';
    select coalesce((value #>> '{}')::numeric, 0) into v_top_inv
    from public.app_settings where key = 'referral_topup_invitee_credits';
  end if;

  v_referrer_total := coalesce(v_plan_ref, 0) + coalesce(v_top_ref, 0);
  v_invitee_total  := coalesce(v_plan_inv, 0) + coalesce(v_top_inv, 0);

  /*
   * The row is stamped BEFORE the grants, and stamped even when the amount is
   * nought. The timestamp is the once-each gate, so an event configured to pay
   * zero must still close - otherwise setting an amount to 0 turns that event
   * into one that fires for ever, paying nothing until the day somebody raises
   * the setting and every old referral pays out at once.
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
   * One ledger row per side per event, so the credit economy report can price
   * the two events separately. The reasons are 0037's - 'referral' for the
   * inviter, 'referral_welcome' for the invited - because credit_source()
   * already classifies both as free and a new reason would land every reward
   * in its "other" bucket until somebody remembered to add it there.
   */
  if v_plan_ref > 0 then
    perform public.grant_credits(
      v_referrer, v_plan_ref, 'referral', null,
      'Referral reward - somebody you invited bought their first plan');
  end if;
  if v_top_ref > 0 then
    perform public.grant_credits(
      v_referrer, v_top_ref, 'referral', null,
      'Referral reward - somebody you invited topped up for the first time');
  end if;

  -- The invitee's profile row is already locked by this transaction's caller
  -- chain (settle_payment updated their payment and granted their purchase),
  -- so no second explicit lock: grant_credits' own UPDATE serialises the
  -- balance against anything else touching it.
  if v_plan_inv > 0 then
    perform public.grant_credits(
      p_user, v_plan_inv, 'referral_welcome', null,
      'Welcome bonus for your first plan - you joined on an invite');
  end if;
  if v_top_inv > 0 then
    perform public.grant_credits(
      p_user, v_top_inv, 'referral_welcome', null,
      'Welcome bonus for your first top-up - you joined on an invite');
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
    -- each side. On a combined first payment that is both events at once.
    'credits', v_referrer_total,
    'welcome_credits', v_invitee_total,
    'plan_event', v_pay_plan,
    'topup_event', v_pay_topup);
end $fn$;

comment on function public.reward_referral(uuid, numeric) is
  'Pays a referral''s two fixed-credit events - the invitee''s first plan, and their first top-up - once each, both sides, gated by referral_min_payment. Works out which event a payment completes from the payments table, so a combined plan-plus-top-up payment fires both.';


-- ---------------------------------------------------------------------------
-- 4 · The claims view says which event paid what
-- ---------------------------------------------------------------------------
drop view if exists public.referral_claim_detail;

create view public.referral_claim_detail
with (security_invoker = true)
as
select
  r.id,
  r.referrer_id,
  coalesce(rp.full_name, rp.email) as referrer,
  rp.email                         as referrer_email,
  r.referred_id,
  coalesce(dp.full_name, dp.email) as invitee,
  dp.email                         as invitee_email,
  r.status,
  r.reward_credits,
  r.welcome_credits,
  r.plan_rewarded_at,
  r.topup_rewarded_at,
  r.plan_referrer_credits,
  r.plan_invitee_credits,
  r.topup_referrer_credits,
  r.topup_invitee_credits,
  -- How far through the two events this referral is, as one word, so a report
  -- can filter and sort on it without four null tests per row.
  case
    when r.plan_rewarded_at is not null and r.topup_rewarded_at is not null then 'both'
    when r.plan_rewarded_at is not null then 'plan'
    when r.topup_rewarded_at is not null then 'topup'
    else 'none'
  end as events_paid,
  r.first_amount,
  case
    when r.rewarded_at is not null
      then extract(epoch from (r.rewarded_at - r.created_at)) / 86400.0
    else null
  end::numeric as days_to_reward,
  r.created_at,
  r.rewarded_at
from public.referrals r
left join public.profiles rp on rp.id = r.referrer_id
left join public.profiles dp on dp.id = r.referred_id;

comment on view public.referral_claim_detail is
  'One row per referral, both sides named, with what each side was paid on each of the two events and how many days the invitee took to pay.';


-- ---------------------------------------------------------------------------
-- 5 · Who may call it. Recreating a SECURITY DEFINER function resets its
--     grants to the schema default, and Supabase's default hands anon and
--     authenticated EXECUTE - the hole 0025 swept, reopened by any migration
--     that forgets this block. Proven live twice in this repo.
-- ---------------------------------------------------------------------------
revoke all on function public.reward_referral(uuid, numeric) from public;
revoke all on function public.reward_referral(uuid, numeric) from anon, authenticated;
grant execute on function public.reward_referral(uuid, numeric) to service_role;

revoke all on public.referral_claim_detail from public;
revoke all on public.referral_claim_detail from anon, authenticated;
grant select on public.referral_claim_detail to service_role;
